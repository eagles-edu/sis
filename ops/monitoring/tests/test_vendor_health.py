from __future__ import annotations

import importlib.util
import tempfile
import unittest
import smtplib
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
                'EMAIL_PROVIDER="brevo"\n'
                'SMTP_HOST="smtp.example.test"\n'
                'SMTP_PORT="465"\n'
                "DATABASE_URL=postgresql://must-not-be-read\n"
                'STUDENT_ADMIN_PASS="admin-password"\n'
                "MEGS_HEALTH_URL='https://megs.example.test/healthz'\n",
                encoding="utf-8",
            )
            values = vendor_health.read_environment(env_path)

        self.assertEqual(values, {
            "BREVO_API_KEY": "private-value",
            "EMAIL_PROVIDER": "brevo",
            "SMTP_HOST": "smtp.example.test",
            "SMTP_PORT": "465",
            "MEGS_HEALTH_URL": "https://megs.example.test/healthz",
            "STUDENT_ADMIN_PASS": "admin-password",
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

    def test_google_forms_vendor_state_is_the_sis_endpoint_key_not_public_discovery(self) -> None:
        with patch.object(vendor_health, "check_moodle_endpoint", return_value=(1, 1, 0.1, 200)), patch.object(
            vendor_health,
            "check_optional_endpoint",
            return_value=(0, 0, 0.0, 0),
        ):
            checks = vendor_health.vendor_checks(
                "test",
                {"GOOGLE_FORMS_GRADES_SECRET": "configured-without-reading-value"},
                Path("/nonexistent/test-runtime"),
            )

        services = {service for service, *_ in checks}
        self.assertIn("google_forms_grade_secret", services)
        self.assertNotIn("google_forms_discovery", services)
        self.assertEqual(
            next(check for check in checks if check[0] == "google_forms_grade_secret"),
            ("google_forms_grade_secret", 1, 0, 0.0, 0),
        )

    def test_moodle_health_probe_accepts_the_staging_basic_auth_gate(self) -> None:
        with patch.object(vendor_health, "http_get", return_value=(False, 0.1, 401)) as request:
            result = vendor_health.check_moodle_endpoint("test")

        self.assertEqual(result, (1, 1, 0.1, 401))
        request.assert_called_once_with("https://staged.eagles.edu.vn/")

    def test_live_moodle_health_probe_requires_a_success_response(self) -> None:
        with patch.object(vendor_health, "http_get", return_value=(False, 0.1, 403)) as request:
            result = vendor_health.check_moodle_endpoint("live")

        self.assertEqual(result, (1, 0, 0.1, 403))
        request.assert_called_once_with("https://moodle.eagles.edu.vn/")

    def test_smtp_relay_probe_connects_without_authentication_or_message_delivery(self) -> None:
        class SmtpProbe:
            def __init__(self, host, port, timeout):
                self.args = (host, port, timeout)
                self.logged_in = False
                self.sent = False

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def ehlo(self):
                return 250, b"ready"

            def has_extn(self, _):
                return False

            def noop(self):
                return 250, b"ok"

            def login(self, *_):
                self.logged_in = True

            def sendmail(self, *_):
                self.sent = True

        with patch.object(vendor_health.smtplib, "SMTP_SSL", side_effect=lambda *args, **kwargs: SmtpProbe(*args, **kwargs)) as connect:
            result = vendor_health.check_smtp_relay({"SMTP_HOST": "smtp.example.test", "SMTP_PORT": "465"})

        self.assertEqual(result[:2], (1, 1))
        self.assertEqual(result[3], 250)
        connect.assert_called_once_with("smtp.example.test", 465, timeout=vendor_health.REQUEST_TIMEOUT_SECONDS)

    def test_optional_endpoint_fails_closed_for_plain_http(self) -> None:
        with patch.object(vendor_health, "http_get") as request:
            result = vendor_health.check_optional_endpoint(
                {"MEGS_HEALTH_URL": "http://127.0.0.1:8789/healthz"},
                "MEGS_HEALTH_URL",
            )

        self.assertEqual(result, (1, 0, 0.0, 0))
        request.assert_not_called()

    def test_dictionary_builder_preview_summarizes_fixed_provider_ids_without_payload_data(self) -> None:
        result = vendor_health.summarize_dictionary_builder_preview({
            "sources": [
                None,
                "unexpected non-object source",
                {"provider": "merriam_webster", "datumStatus": {"definition": {"status": "available"}}},
                {"provider": "ldoce", "datumStatus": {"definition": {"status": "unavailable"}}},
                {"provider": "wiktionary", "datumStatus": {"definition": {"status": "not_offered"}}},
                {"provider": "unexpected", "datumStatus": {"definition": {"status": "available"}}},
            ],
        })

        self.assertEqual(len(result), 12)
        self.assertEqual(result["merriam_webster_scrape"], {"checked": 1, "available": 1})
        self.assertEqual(result["ldoce"], {"checked": 1, "available": 0})
        self.assertEqual(result["wiktionary"], {"checked": 0, "available": 0})
        self.assertEqual(result["cambridge"], {"checked": 0, "available": 0})

    def test_live_monitor_fails_when_dictionary_builder_preview_fails(self) -> None:
        checks = [("merriam_webster_collegiate", 1, 1, 0.1, 200)]

        self.assertTrue(vendor_health.live_monitor_success(True, checks, True))
        self.assertFalse(vendor_health.live_monitor_success(True, checks, False))

    def test_live_dictionary_builder_metrics_emit_all_provider_ids_without_sensitive_payload(self) -> None:
        availability = {
            provider: {"checked": int(provider == "ldoce"), "available": int(provider == "ldoce")}
            for provider in vendor_health.DICTIONARY_BUILDER_PROVIDER_IDS
        }
        rendered = vendor_health.render_metrics([], 123, dictionary_builder_probe=(True, 0.5, availability))

        self.assertEqual(rendered.count('sis_live_dictionary_builder_provider_checked{environment="live"'), 12)
        self.assertIn('sis_live_dictionary_builder_provider_available{environment="live",provider="ldoce"} 1', rendered)
        self.assertIn('sis_live_dictionary_builder_definition_providers_checked{environment="live"} 1', rendered)
        self.assertIn('sis_live_dictionary_builder_definition_providers_available{environment="live"} 1', rendered)
        self.assertIn('sis_live_library_dictionary_builder_check_success{environment="live"} 1', rendered)
        self.assertNotIn("admin-password", rendered)
        self.assertNotIn("monitor sample definition", rendered)

    def test_live_dictionary_builder_preview_requires_owned_admin_credentials(self) -> None:
        with patch.object(vendor_health, "post_json") as request:
            success, duration, availability = vendor_health.check_live_dictionary_builder_preview({})

        self.assertFalse(success)
        self.assertGreaterEqual(duration, 0)
        self.assertEqual(len(availability), 12)
        self.assertTrue(all(item == {"checked": 0, "available": 0} for item in availability.values()))
        request.assert_not_called()

    def test_live_dictionary_builder_preview_uses_admin_cookie_flow_and_fixed_word(self) -> None:
        preview = {
            "ok": True,
            "sources": [{"provider": "ldoce", "datumStatus": {"definition": {"status": "available"}}}],
        }
        with patch.object(vendor_health, "build_opener", return_value=object()), patch.object(
            vendor_health,
            "post_json",
            side_effect=[(200, {"authenticated": True}), (200, preview)],
        ) as request:
            success, duration, availability = vendor_health.check_live_dictionary_builder_preview({
                "STUDENT_ADMIN_USER": "monitor-admin",
                "STUDENT_ADMIN_PASS": "private-password",
            })

        self.assertTrue(success)
        self.assertGreaterEqual(duration, 0)
        self.assertEqual(availability["ldoce"], {"checked": 1, "available": 1})
        self.assertEqual(request.call_count, 2)
        self.assertTrue(request.call_args_list[0].args[1].endswith("/api/admin/auth/login"))
        self.assertEqual(request.call_args_list[1].args[2], {"entry": {"english": "monitor", "partOfSpeech": "noun"}})


if __name__ == "__main__":
    unittest.main()
