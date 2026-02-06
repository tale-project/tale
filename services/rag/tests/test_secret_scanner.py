"""Tests for the pre-ingestion secret scanner."""

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

    @pytest.mark.parametrize(
        "label, content",
        [
            ("API_KEY=", b"API_KEY=sk-1234567890abcdef"),
            ("api-key:", b"api-key: sk-1234567890abcdef"),
            ("PASSWORD=", b"DB_PASSWORD=super_secret_123"),
            ("password:", b"password: hunter2"),
            ("SECRET=", b"SECRET=my_secret_value_here"),
            ("TOKEN=", b"AUTH_TOKEN=abc123xyz789"),
            ("PRIVATE_KEY=", b"PRIVATE_KEY=some_key_material"),
            ("private-key:", b"private-key: key_material_here"),
        ],
    )
    def test_rejects_key_value_assignments(self, label, content):
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True, f"Expected rejection for {label}"
        assert reason is not None

    def test_rejects_bearer_token(self):
        content = b"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "Bearer token" in reason

    @pytest.mark.parametrize(
        "label, content",
        [
            ("mongodb", b"mongodb://user:pass@host:27017/db"),
            ("postgres", b"postgres://admin:secret@db.example.com:5432/mydb"),
            ("mysql", b"mysql://root:pass@localhost/test"),
            ("redis", b"redis://default:pass@redis.cloud:6379"),
        ],
    )
    def test_rejects_connection_strings(self, label, content):
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True, f"Expected rejection for {label} connection string"
        assert "Connection string" in reason

    def test_rejects_aws_access_key(self):
        content = b"aws_key=AKIAIOSFODNN7EXAMPLE"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "AWS access key" in reason

    def test_rejects_pem_private_key(self):
        content = b"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "PEM private key" in reason

    def test_rejects_openssh_private_key(self):
        content = b"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnN...\n-----END OPENSSH PRIVATE KEY-----"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True
        assert "PEM private key" in reason

    def test_rejects_hex_token(self):
        hex_token = "a" * 40
        content = f"key= {hex_token}".encode()
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True

    def test_rejects_base64_token(self):
        b64_token = "A" * 40 + "=="
        content = f"token= {b64_token}".encode()
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True

    def test_rejects_env_file_content(self):
        content = b"DATABASE_PASSWORD=production_secret_123\nAPP_SECRET=another_secret"
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is True

    def test_binary_file_passes(self):
        content = bytes(range(256)) * 10
        rejected, reason = scan_file_for_secrets(content)
        assert rejected is False
        assert reason is None

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
