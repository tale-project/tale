"""Unit tests for the deployment vector-store config reader."""

import json

import pytest
from tale_shared.config.org_slug import ORG_SLUG_RE

from app.services.vector_store import config_reader as cr
from app.services.vector_store.config_reader import (
    DEPLOYMENT_DIR,
    load_vectordb_config,
)


@pytest.fixture
def config_root(tmp_path, monkeypatch):
    """Point the reader at a temp config root (`.system/` under it)."""
    monkeypatch.delenv("TALE_PLATFORM_SHARED_CONFIG_DIR", raising=False)
    monkeypatch.setenv("TALE_CONFIG_DIR", str(tmp_path))
    sysdir = tmp_path / DEPLOYMENT_DIR
    sysdir.mkdir()
    return sysdir


def _write(sysdir, config: dict, secrets: dict | None = None):
    (sysdir / "vectordb.json").write_text(json.dumps(config))
    if secrets is not None:
        (sysdir / "vectordb.secrets.json").write_text(json.dumps(secrets))


def test_deployment_dir_is_not_a_valid_org_slug():
    # The collision guard the whole design rests on: `.system/` can never
    # be mistaken for an org directory.
    assert not ORG_SLUG_RE.fullmatch(DEPLOYMENT_DIR)


def test_absent_file_defaults_to_pgvector(config_root):
    cfg = load_vectordb_config()
    assert cfg.backend == "pgvector"
    assert cfg.qdrant_url is None


def test_explicit_pgvector(config_root):
    _write(config_root, {"backend": "pgvector"})
    cfg = load_vectordb_config()
    assert cfg.backend == "pgvector"


def test_qdrant_config_parsed(config_root):
    _write(
        config_root,
        {"backend": "qdrant", "qdrant": {"url": "http://qdrant:6333", "collection": "kb", "preferGrpc": True}},
        secrets={"apiKey": "secret-token"},
    )
    cfg = load_vectordb_config()
    assert cfg.backend == "qdrant"
    assert cfg.qdrant_url == "http://qdrant:6333"
    assert cfg.collection == "kb"
    assert cfg.prefer_grpc is True
    assert cfg.api_key == "secret-token"


def test_qdrant_uses_default_collection_when_omitted(config_root):
    _write(config_root, {"backend": "qdrant", "qdrant": {"url": "http://qdrant:6333"}})
    cfg = load_vectordb_config()
    assert cfg.collection == cr.DEFAULT_COLLECTION
    assert cfg.api_key is None  # no secrets file


def test_unknown_backend_falls_back_to_pgvector(config_root):
    _write(config_root, {"backend": "pinecone"})
    assert load_vectordb_config().backend == "pgvector"


def test_qdrant_without_url_falls_back_to_pgvector(config_root):
    _write(config_root, {"backend": "qdrant", "qdrant": {"collection": "kb"}})
    assert load_vectordb_config().backend == "pgvector"


def test_malformed_json_falls_back_to_pgvector(config_root):
    (config_root / "vectordb.json").write_text("{not json")
    assert load_vectordb_config().backend == "pgvector"


@pytest.mark.parametrize("payload", ["null", "[]", "42", '"a string"'])
def test_non_object_json_falls_back_to_pgvector(config_root, payload):
    # Valid JSON that isn't an object would raise AttributeError on .get();
    # the reader must stay fail-safe.
    (config_root / "vectordb.json").write_text(payload)
    assert load_vectordb_config().backend == "pgvector"


def test_qdrant_section_non_dict_falls_back_to_pgvector(config_root):
    # A truthy non-dict `qdrant` (here a string) must not raise on .get("url").
    _write(config_root, {"backend": "qdrant", "qdrant": "oops"})
    assert load_vectordb_config().backend == "pgvector"


def test_undecryptable_secret_falls_back_to_pgvector(config_root, monkeypatch):
    # A secret file that exists but can't be decrypted must NOT silently
    # connect to Qdrant unauthenticated — fail safe to pgvector.
    _write(
        config_root,
        {"backend": "qdrant", "qdrant": {"url": "http://qdrant:6333"}},
        secrets={"apiKey": "x"},
    )

    def _boom(_path):
        raise RuntimeError("no SOPS key available")

    monkeypatch.setattr(cr, "decrypt_secrets_file", _boom)
    assert load_vectordb_config().backend == "pgvector"


def test_pgvector_external_parsed_with_password(config_root):
    _write(
        config_root,
        {
            "backend": "pgvector_external",
            "pgvectorExternal": {
                "host": "db.example.com",
                "port": 6543,
                "database": "tale",
                "user": "tale_rw",
                "sslmode": "verify-full",
                "table": "kb_vectors",
            },
        },
        secrets={"password": "s3cret"},
    )
    cfg = load_vectordb_config()
    assert cfg.backend == "pgvector_external"
    assert cfg.pg_host == "db.example.com"
    assert cfg.pg_port == 6543
    assert cfg.pg_database == "tale"
    assert cfg.pg_user == "tale_rw"
    assert cfg.pg_sslmode == "verify-full"
    assert cfg.pg_table == "kb_vectors"
    assert cfg.pg_password == "s3cret"


def test_pgvector_external_defaults_when_omitted(config_root):
    # No secret file (trust/cert auth) and minimal config: defaults applied.
    _write(
        config_root,
        {
            "backend": "pgvector_external",
            "pgvectorExternal": {"host": "h", "database": "d", "user": "u"},
        },
    )
    cfg = load_vectordb_config()
    assert cfg.backend == "pgvector_external"
    assert cfg.pg_port == cr.DEFAULT_PG_PORT
    assert cfg.pg_sslmode == cr.DEFAULT_PG_SSLMODE
    assert cfg.pg_table == cr.DEFAULT_PG_TABLE
    assert cfg.pg_password is None


def test_pgvector_external_incomplete_falls_back_to_pgvector(config_root):
    # Missing user -> incomplete connection -> fail safe to built-in pgvector.
    _write(
        config_root,
        {"backend": "pgvector_external", "pgvectorExternal": {"host": "h", "database": "d"}},
    )
    assert load_vectordb_config().backend == "pgvector"


def test_pgvector_external_section_non_dict_falls_back_to_pgvector(config_root):
    _write(config_root, {"backend": "pgvector_external", "pgvectorExternal": "oops"})
    assert load_vectordb_config().backend == "pgvector"


def test_pgvector_external_undecryptable_secret_falls_back_to_pgvector(config_root, monkeypatch):
    _write(
        config_root,
        {
            "backend": "pgvector_external",
            "pgvectorExternal": {"host": "h", "database": "d", "user": "u"},
        },
        secrets={"password": "x"},
    )

    def _boom(_path):
        raise RuntimeError("no SOPS key available")

    monkeypatch.setattr(cr, "decrypt_secrets_file", _boom)
    assert load_vectordb_config().backend == "pgvector"


def test_pgvector_external_in_valid_backends():
    assert "pgvector_external" in cr.VALID_BACKENDS
