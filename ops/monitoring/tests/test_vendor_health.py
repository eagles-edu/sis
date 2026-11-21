from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "monitor-vendor-health.py"
SPEC = importlib.util.spec_from_file_location("sis_vendor_health", MODULE_PATH)
assert SPEC and SPEC.loader
vendor_health = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vendor_health)


class VendorHealthTests(unittest.TestCase):
    def test_environment_reader_returns_only_required_vendor_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text(
                'BREVO_API_KEY="private-value"\n'
                "DATABASE_URL=postgresql://must-not-be-read\n"
                "MOODLE_URL='https://moodle.example.test'\n",
                encoding="utf-8",
            )
            values = vendor_health.read_environment(env_path)

        self.assertEqual(values, {
            "BREVO_API_KEY": "private-value",
            "MOODLE_URL": "https://moodle.example.test",
        })

    def test_unconfigured_vendor_is_not_reported_as_down(self) -> None:
        rendered = vendor_health.render_metrics(
            [("test", "brevo_api", 0, 0, 0.0, 0)],
            123,
        )

        self.assertIn('sis_external_service_configured{environment="test",service="brevo_api"} 0', rendered)
        self.assertNotIn("sis_external_service_available{", rendered)
        self.assertNotIn("private-value", rendered)

    def test_secret_configuration_flags_are_not_reported_as_endpoint_failures(self) -> None:
        checks = [
            ("live", "google_forms_grade_secret", 1, 0, 0.0, 0),
            ("live", "moodle_provisioning_secret", 1, 0, 0.0, 0),
        ]
        rendered = vendor_health.render_metrics(checks, 123)

        self.assertIn('sis_external_service_configured{environment="live",service="google_forms_grade_secret"} 1', rendered)
        self.assertNotIn('sis_external_service_available{environment="live",service="google_forms_grade_secret"}', rendered)
        self.assertTrue(vendor_health.environment_monitor_success(True, [
            (vendor, configured, available, duration, status)
            for _, vendor, configured, available, duration, status in checks
        ]))

    def test_configured_vendor_failure_includes_only_bounded_http_status(self) -> None:
        rendered = vendor_health.render_metrics(
            [("test", "google_forms_discovery", 1, 0, 0.125, 403)],
            123,
        )

        self.assertIn('sis_external_service_available{environment="test",service="google_forms_discovery"} 0', rendered)
        self.assertIn('sis_external_service_http_status{environment="test",service="google_forms_discovery"} 403', rendered)
        self.assertNotIn("api-key", rendered)

    def test_brevo_check_uses_read_only_account_request(self) -> None:
        with patch.object(vendor_health, "http_get", return_value=(True, 0.25, 200)) as request:
            result = vendor_health.check_brevo({"BREVO_API_KEY": "private-value"})

        self.assertEqual(result, (1, 1, 0.25, 200))
        request.assert_called_once_with(
            "https://api.brevo.com/v3/account",
            {"api-key": "private-value"},
        )

    def test_unconfigured_google_forms_returns_a_complete_unconfigured_result(self) -> None:
        with patch.object(vendor_health, "http_get") as request:
            result = vendor_health.check_google_forms({})

        self.assertEqual(result, (0, 0, 0.0, 0))
        request.assert_not_called()

    def test_optional_endpoint_fails_closed_for_plain_http(self) -> None:
        with patch.object(vendor_health, "http_get") as request:
            result = vendor_health.check_optional_endpoint(
                {"MEGS_HEALTH_URL": "http://127.0.0.1:8789/healthz"},
                "MEGS_HEALTH_URL",
            )

        self.assertEqual(result, (1, 0, 0.0, 0))
        request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
