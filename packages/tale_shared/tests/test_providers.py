"""Tests for provider API-key resolution, incl. the env-var key source (#1711)."""

import json
import os
from pathlib import Path
from unittest.mock import patch

from tale_shared.config.providers import get_chat_model, load_providers

ALLOWLIST = "TALE_PROVIDER_SECRET_ENV_ALLOWLIST"
ORG = "default"


def _write_provider(
    config_dir: Path,
    *,
    provider_secrets_env: str | None = None,
    model_secrets_env: str | None = None,
    file_api_key: str | None = None,
    name: str = "openrouter",
) -> None:
    """Write a minimal chat provider (+ optional secrets file) under config_dir."""
    providers_dir = config_dir / ORG / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)

    model: dict = {"id": "chat-model", "displayName": "Chat", "tags": ["chat"]}
    if model_secrets_env is not None:
        model["secretsEnv"] = model_secrets_env

    config: dict = {
        "displayName": "OpenRouter",
        "baseUrl": "https://openrouter.example/v1",
        "models": [model],
    }
    if provider_secrets_env is not None:
        config["secretsEnv"] = provider_secrets_env

    (providers_dir / f"{name}.json").write_text(json.dumps(config))
    if file_api_key is not None:
        (providers_dir / f"{name}.secrets.json").write_text(json.dumps({"apiKey": file_api_key}))


def test_env_only_provider_resolves(tmp_path: Path) -> None:
    """No secrets file: an allowlisted provider-level env var supplies the key."""
    _write_provider(tmp_path, provider_secrets_env="OPENROUTER_API_KEY")
    with patch.dict(
        os.environ,
        {ALLOWLIST: "OPENROUTER_API_KEY", "OPENROUTER_API_KEY": "sk-env"},
        clear=True,
    ):
        base_url, api_key, model_id = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"
    assert model_id == "chat-model"
    assert base_url == "https://openrouter.example/v1"


def test_allowlist_locked_falls_back_to_file(tmp_path: Path) -> None:
    """An env var that is set but NOT allowlisted must not be used."""
    _write_provider(tmp_path, provider_secrets_env="OPENROUTER_API_KEY", file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {ALLOWLIST: "", "OPENROUTER_API_KEY": "sk-env"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-file"


def test_env_overrides_file(tmp_path: Path) -> None:
    _write_provider(tmp_path, provider_secrets_env="OPENROUTER_API_KEY", file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {ALLOWLIST: "OPENROUTER_API_KEY", "OPENROUTER_API_KEY": "sk-env"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"


def test_empty_env_falls_back_to_file(tmp_path: Path) -> None:
    """Allowlisted name but the env var is empty/unset → use the file key."""
    _write_provider(tmp_path, provider_secrets_env="OPENROUTER_API_KEY", file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {ALLOWLIST: "OPENROUTER_API_KEY", "OPENROUTER_API_KEY": "   "},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-file"


def test_env_value_is_trimmed(tmp_path: Path) -> None:
    _write_provider(tmp_path, provider_secrets_env="OPENROUTER_API_KEY")
    with patch.dict(
        os.environ,
        {ALLOWLIST: "OPENROUTER_API_KEY", "OPENROUTER_API_KEY": "sk-env\n"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"


def test_model_env_beats_provider_env(tmp_path: Path) -> None:
    _write_provider(
        tmp_path,
        provider_secrets_env="PROVIDER_KEY",
        model_secrets_env="MODEL_KEY",
    )
    with patch.dict(
        os.environ,
        {
            ALLOWLIST: "MODEL_KEY,PROVIDER_KEY",
            "MODEL_KEY": "sk-model",
            "PROVIDER_KEY": "sk-provider",
        },
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-model"


def test_no_key_returns_empty_string(tmp_path: Path) -> None:
    """No secretsEnv and no file key → "" (never None / never raises on key)."""
    _write_provider(tmp_path)
    with patch.dict(os.environ, {}, clear=True):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == ""


def test_secrets_env_parsed_onto_dataclasses(tmp_path: Path) -> None:
    _write_provider(
        tmp_path,
        provider_secrets_env="PROVIDER_KEY",
        model_secrets_env="MODEL_KEY",
    )
    with patch.dict(os.environ, {}, clear=True):
        providers = load_providers(ORG, config_dir=str(tmp_path))
    assert len(providers) == 1
    assert providers[0].secrets_env == "PROVIDER_KEY"
    assert providers[0].models[0].secrets_env == "MODEL_KEY"
