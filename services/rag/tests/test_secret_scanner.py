"""Tests for the pre-ingestion secret scanner (detect-secrets wrapper)."""

import pytest

from app.secret_scanner import scan_file_for_secrets


class TestScanFileForSecrets:
    def test_clean_file_passes(self):
        content = b"This is a normal document with no secrets."
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is False
        assert reason is None

    def test_clean_code_file_passes(self):
        content = b"const x = 42;\nfunction hello() { return 'world'; }\n"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is False
        assert reason is None

    def test_rejects_real_api_key_assignment(self):
        # Long, high-entropy secret literal assigned to a key-shaped name.
        content = b'const API_KEY = "sk-1234567890abcdef1234567890"'
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert reason is not None

    def test_rejects_env_file_with_real_values(self):
        content = (
            b"DATABASE_PASSWORD=prod_db_secret_abcdef1234567890\n"
            b"APP_SECRET=some_long_high_entropy_literal_value_xyz789\n"
        )
        rejected, _ = scan_file_for_secrets(content)
        assert rejected is True

    # -- False-positive avoidance -------------------------------------------

    @pytest.mark.parametrize(
        "label, content",
        [
            # The exact shape that triggered the original regression: a TS
            # source file assigning an identifier reference to an apiKey field.
            (
                "typescript identifier ref",
                b"export class Connector {\n"
                b"  async call() {\n"
                b"    return fetch(this.url, {\n"
                b"      headers: { 'x-api-key': this.config.apiKey },\n"
                b"    });\n"
                b"  }\n"
                b"}\n",
            ),
            ("config ref assignment", b"apiKey: config.apiKey"),
            ("this ref assignment", b"const apiKey = this.apiKey"),
            ("process.env ref", b"API_KEY = process.env.API_KEY"),
            # Placeholder conventions detect-secrets doesn't catch on its own.
            ("redacted value", b"password = REDACTED"),
            ("your-api-key placeholder", b'API_KEY="your-api-key-here"'),
            ("sample token placeholder", b"token: sample-token-goes-here"),
            # Null / empty / templated.
            ("null value", b"secret: null"),
            ("empty string", b'token = ""'),
            ("star-mask", b'password: "********"'),
            ("template string", b"token: `${env.TOKEN}`"),
            ("ts-env-dollar", b"const k = ${process.env.KEY}"),
            # URLs without embedded credentials.
            ("postgres no creds", b"postgres://localhost:5432/mydb"),
            ("mongodb no creds", b"mongodb://db.internal/production"),
        ],
    )
    def test_allows_non_secrets(self, label, content):
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is False, f"Expected allow for {label}, got reason={reason!r}"

    # -- Specific-provider detectors ----------------------------------------

    def test_rejects_aws_access_key(self):
        content = b"aws_key=AKIAIOSFODNN7EXAMPLE"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "AWS" in reason

    def test_rejects_pem_private_key(self):
        content = b"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "Private Key" in reason

    def test_rejects_openssh_private_key(self):
        content = b"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnN...\n-----END OPENSSH PRIVATE KEY-----"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "Private Key" in reason

    def test_rejects_jwt(self):
        content = (
            b"Authorization: Bearer "
            b"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            b"eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0."
            b"dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
        )
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "JSON Web Token" in reason or "JWT" in reason

    def test_rejects_hex_token_assigned_to_key(self):
        hex_token = "a1b2c3d4e5f6" * 4  # 48 chars, high enough entropy
        content = f'API_KEY="{hex_token}"'.encode()
        rejected, _ = scan_file_for_secrets(content)
        assert rejected is True

    # -- Fail-open behavior -------------------------------------------------

    def test_binary_file_does_not_error(self):
        # Binary content is a best-effort UTF-8 decode then scan; detector
        # may or may not flag depending on byte patterns, but it must not
        # raise or hard-fail.
        content = bytes(range(256)) * 10
        rejected, _ = scan_file_for_secrets(content)
        assert rejected in (True, False)

    def test_empty_file_passes(self):
        rejected, reason = scan_file_for_secrets(b"")
        assert rejected is False
        assert reason is None


class TestSupportedExtensions:
    """Verify .env and .log are no longer in SUPPORTED_EXTENSIONS."""

    @staticmethod
    def _read_documents_source() -> str:
        from pathlib import Path

        source_path = Path(__file__).resolve().parent.parent / "app" / "routers" / "documents.py"
        return source_path.read_text()

    def test_env_not_in_supported_extensions(self):
        source = self._read_documents_source()
        assert '".env"' not in source, ".env should not be in SUPPORTED_EXTENSIONS"

    def test_log_not_in_supported_extensions(self):
        source = self._read_documents_source()
        assert '".log"' not in source, ".log should not be in SUPPORTED_EXTENSIONS"
