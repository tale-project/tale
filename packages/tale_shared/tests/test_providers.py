"""Tests for provider API-key resolution, incl. the env-var key source (#1711)."""

import json
import os
from pathlib import Path
from unittest.mock import patch

from tale_shared.config.providers import get_chat_model, load_providers

# Reserved prefix every env-var key source must carry (mirrors the platform).
PROVIDER_ENV = "TALE_PROVIDER_KEY_OPENROUTER"
MODEL_ENV = "TALE_PROVIDER_KEY_MODEL"
PROVIDER_ENV2 = "TALE_PROVIDER_KEY_PROVIDER"
# A name outside the reserved prefix — must never resolve.
NON_PREFIXED = "OPENROUTER_API_KEY"
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
    """No secrets file: a prefixed provider-level env var supplies the key."""
    _write_provider(tmp_path, provider_secrets_env=PROVIDER_ENV)
    with patch.dict(
        os.environ,
        {PROVIDER_ENV: "sk-env"},
        clear=True,
    ):
        base_url, api_key, model_id = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"
    assert model_id == "chat-model"
    assert base_url == "https://openrouter.example/v1"


def test_non_prefixed_falls_back_to_file(tmp_path: Path) -> None:
    """An env var that is set but NOT prefixed must not be used."""
    _write_provider(tmp_path, provider_secrets_env=NON_PREFIXED, file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {NON_PREFIXED: "sk-env"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-file"


def test_env_overrides_file(tmp_path: Path) -> None:
    _write_provider(tmp_path, provider_secrets_env=PROVIDER_ENV, file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {PROVIDER_ENV: "sk-env"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"


def test_empty_env_falls_back_to_file(tmp_path: Path) -> None:
    """Prefixed name but the env var is empty/unset → use the file key."""
    _write_provider(tmp_path, provider_secrets_env=PROVIDER_ENV, file_api_key="sk-file")
    with patch.dict(
        os.environ,
        {PROVIDER_ENV: "   "},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-file"


def test_env_value_is_trimmed(tmp_path: Path) -> None:
    _write_provider(tmp_path, provider_secrets_env=PROVIDER_ENV)
    with patch.dict(
        os.environ,
        {PROVIDER_ENV: "sk-env\n"},
        clear=True,
    ):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-env"


def test_model_env_beats_provider_env(tmp_path: Path) -> None:
    _write_provider(
        tmp_path,
        provider_secrets_env=PROVIDER_ENV2,
        model_secrets_env=MODEL_ENV,
    )
    with patch.dict(
        os.environ,
        {
            MODEL_ENV: "sk-model",
            PROVIDER_ENV2: "sk-provider",
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
        provider_secrets_env=PROVIDER_ENV2,
        model_secrets_env=MODEL_ENV,
    )
    with patch.dict(os.environ, {}, clear=True):
        providers = load_providers(ORG, config_dir=str(tmp_path))
    assert len(providers) == 1
    assert providers[0].secrets_env == PROVIDER_ENV2
    assert providers[0].models[0].secrets_env == MODEL_ENV


def test_non_string_secrets_env_degrades_to_file(tmp_path: Path) -> None:
    """A hand-edited non-string secretsEnv (e.g. an int) must degrade to the
    file key, not raise AttributeError from `.startswith` (mirrors the TS
    resolver, which rejects it at the zod boundary)."""
    providers_dir = tmp_path / ORG / "providers"
    providers_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "displayName": "OpenRouter",
        "baseUrl": "https://openrouter.example/v1",
        "secretsEnv": 123,  # non-string: hand-edited footgun
        "models": [
            {
                "id": "chat-model",
                "displayName": "Chat",
                "tags": ["chat"],
                "secretsEnv": ["nope"],  # non-string at the model level too
            }
        ],
    }
    (providers_dir / "openrouter.json").write_text(json.dumps(config))
    (providers_dir / "openrouter.secrets.json").write_text(json.dumps({"apiKey": "sk-file"}))
    with patch.dict(os.environ, {}, clear=True):
        _, api_key, _ = get_chat_model(ORG, config_dir=str(tmp_path))
    assert api_key == "sk-file"
