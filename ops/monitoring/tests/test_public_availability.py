import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "ops/monitoring/monitor-public-availability.py"
SPEC = importlib.util.spec_from_file_location("public_availability", MODULE_PATH)
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return json.dumps(self.payload).encode()


class PublicAvailabilityTests(unittest.TestCase):
    def test_every_configured_public_domain_has_three_external_locations(self):
        self.assertEqual(
            [site[0] for site in MONITOR.SITES],
            ["eagles.edu.vn", "admin.eagles.edu.vn", "test.eagles.edu.vn", "ltd.eagles.vn", "ielts.eagles.edu.vn", "thuvien.eagles.edu.vn", "moodle.eagles.edu.vn"],
        )
        self.assertEqual(MONITOR.COUNTRIES, ("VN", "US", "GB"))

    def test_two_of_three_2xx_or_3xx_results_pass(self):
        start = {"id": "testMeasurement01", "status": "in-progress"}
        finished = {
            "id": "testMeasurement01",
            "status": "finished",
            "results": [
                {"probe": {"location": {"country": country}}, "result": {"status": "finished", "statusCode": status, "timings": {"total": 0.25}}}
                for country, status in (("VN", 200), ("US", 302), ("GB", 503))
            ],
        }
        with patch.object(MONITOR, "_request_json", side_effect=[start, finished]):
            result = MONITOR._probe_site(MONITOR.SITES[0])
        self.assertEqual(result["state"], "passed")
        self.assertEqual(result["success"], 1)
        self.assertEqual(result["probes"]["GB"]["success"], 0)

    def test_pending_or_missing_locations_are_inconclusive_and_not_successful(self):
        start = {"id": "testMeasurement02", "status": "in-progress"}
        pending = {
            "id": "testMeasurement02",
            "status": "in-progress",
            "results": [{"probe": {"location": {"country": "VN"}}, "result": {"status": "finished", "statusCode": 200}}],
        }
        with patch.object(MONITOR, "_request_json", side_effect=[start, pending]), patch.object(MONITOR.time, "monotonic", side_effect=[0, 36]):
            result = MONITOR._probe_site(MONITOR.SITES[1])
        self.assertEqual(result["state"], "inconclusive")
        self.assertEqual(result["success"], 0)

    def test_metrics_are_complete_fixed_label_atomic_textfile_content(self):
        results = [{
            "domain": "eagles.edu.vn", "site": "naked", "success": 1, "state": "passed",
            "probes": {country: {"success": 1, "state": 1, "status": 200, "duration_ms": 40} for country in MONITOR.COUNTRIES},
        }]
        content = MONITOR.render_metrics(results, 1_800_000_000)
        self.assertIn('eagles_external_public_site_success{domain="eagles.edu.vn",site="naked",provider="globalping"} 1', content)
        self.assertIn('country="VN"', content)
        self.assertIn("eagles_external_public_site_state", content)
        self.assertNotIn("rawOutput", content)
        self.assertNotIn("statusCodeName", content)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "public-availability.prom"
            MONITOR.write_metrics(output, content)
            self.assertEqual(output.read_text(), content)
            self.assertFalse(list(Path(directory).glob(".*.prom")))


if __name__ == "__main__":
    unittest.main()
