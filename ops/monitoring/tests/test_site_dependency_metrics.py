from __future__ import annotations

import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "monitor-site-dependencies.py"
SPEC = importlib.util.spec_from_file_location("sis_site_dependencies", MODULE_PATH)
assert SPEC and SPEC.loader
site_dependencies = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(site_dependencies)


class SiteDependencyMetricsTests(unittest.TestCase):
    def test_nginx_configuration_check_passes_only_on_zero_exit_and_discards_output(self) -> None:
        result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="nginx config is ok",
            stderr="sensitive local path should not be exported",
        )
        with patch.object(site_dependencies.subprocess, "run", return_value=result) as run:
            valid, duration = site_dependencies.nginx_configuration_check()

        self.assertTrue(valid)
        self.assertGreaterEqual(duration, 0)
        self.assertEqual(run.call_args.args[0], ["/usr/sbin/nginx", "-t", "-q"])
        self.assertTrue(run.call_args.kwargs["capture_output"])
        self.assertTrue(run.call_args.kwargs["check"] is False)

    def test_nginx_configuration_check_fails_closed_on_invalid_config_or_unavailable_binary(self) -> None:
        invalid = subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="private config path")
        with patch.object(site_dependencies.subprocess, "run", return_value=invalid):
            valid, _ = site_dependencies.nginx_configuration_check()
        self.assertFalse(valid)

        with patch.object(site_dependencies.subprocess, "run", side_effect=FileNotFoundError):
            valid, _ = site_dependencies.nginx_configuration_check()
        self.assertFalse(valid)

    def test_grade_queries_are_read_only_and_aggregate_fixed_source_categories(self) -> None:
        result = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="exercise_submission|moodle|3|42\ngrade_record|google forms|5|43\n",
            stderr="",
        )
        with patch.object(site_dependencies.subprocess, "run", return_value=result) as run:
            available, rows = site_dependencies.postgres_readonly_integration_metrics(
                "postgresql://monitor:private-password@127.0.0.1:5432/sis",
                True,
                "sis",
            )

        self.assertTrue(available)
        self.assertIn(("exercise_submission", "moodle", 3, 42), rows)
        self.assertIn(("grade_record", "google_forms", 5, 43), rows)
        self.assertIn(("grade_record", "other", 0, 0), rows)
        command = run.call_args.args[0]
        self.assertNotIn("private-password", " ".join(command))
        self.assertIn("SELECT", " ".join(command))
        self.assertIn("GROUP BY", " ".join(command))

    def test_grade_query_refuses_an_unexpected_database_before_connecting(self) -> None:
        with patch.object(site_dependencies.subprocess, "run") as run:
            available, rows = site_dependencies.postgres_readonly_integration_metrics(
                "postgresql://monitor:private-password@127.0.0.1:5432/sis-test",
                True,
                "sis",
            )

        self.assertFalse(available)
        self.assertEqual(rows, [])
        run.assert_not_called()

    def test_webhook_query_exports_only_aggregate_count_and_timestamp(self) -> None:
        result = subprocess.CompletedProcess(args=[], returncode=0, stdout="2|44\n", stderr="")
        with patch.object(site_dependencies.subprocess, "run", return_value=result) as run:
            observed = site_dependencies.postgres_readonly_webhook_metrics(
                "postgresql://monitor:private-password@127.0.0.1:5432/sis",
                True,
                "sis",
            )

        self.assertEqual(observed, (True, 2, 44))
        command = " ".join(run.call_args.args[0])
        self.assertIn("processedAt", command)
        self.assertIn("COUNT(*) FILTER", command)
        self.assertNotIn("UPDATE", command)
        self.assertNotIn("private-password", command)


if __name__ == "__main__":
    unittest.main()
