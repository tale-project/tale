"""Provider configuration reader for file-based LLM provider config."""

import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from tale_shared.utils.sops import decrypt_secrets_file

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_DIR = "/app/data"


@dataclass
class ModelConfig:
    """A single model definition within a provider."""

    id: str
    display_name: str
    tags: list[str]
    description: str = ""
    default: bool = False
    dimensions: int | None = None


@dataclass
class ProviderConfig:
    """A provider loaded from a JSON file, with optional decrypted secrets."""

    name: str
    display_name: str
    base_url: str
    models: list[ModelConfig] = field(default_factory=list)
    description: str = ""
    supports_structured_outputs: bool = False
    api_key: str | None = None


def load_providers(config_dir: str | None = None) -> list[ProviderConfig]:
    """Read all provider JSON files from {config_dir}/providers/.

    Reads *.json (excluding *.secrets.json) and decrypts matching
    *.secrets.json files via SOPS.
    """
    shared_config = os.environ.get("TALE_PLATFORM_SHARED_CONFIG_DIR")
    if shared_config:
        base = Path(shared_config)
    else:
        base = Path(
            config_dir
            or os.environ.get("TALE_CONFIG_DIR")
            or os.environ.get("CONFIG_DIR", DEFAULT_CONFIG_DIR)
        )
    providers_dir = base / "providers"

    if not providers_dir.is_dir():
        logger.warning("Providers directory not found: %s", providers_dir)
        return []

    providers: list[ProviderConfig] = []

    for json_file in sorted(providers_dir.glob("*.json")):
        if json_file.name.endswith(".secrets.json"):
            continue

        try:
            with open(json_file) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("Failed to read provider file %s: %s", json_file, exc)
            continue

        provider_name = json_file.stem

        # Load secrets if present
        api_key: str | None = None
        secrets_file = json_file.with_suffix("").with_suffix(".secrets.json")
        if secrets_file.exists():
            try:
                secrets = decrypt_secrets_file(secrets_file)
                api_key = secrets.get("apiKey")
            except (RuntimeError, OSError, subprocess.TimeoutExpired) as exc:
                logger.error("Failed to decrypt secrets for %s: %s", provider_name, exc)

        models = []
        for m in data.get("models", []):
            models.append(
                ModelConfig(
                    id=m["id"],
                    display_name=m.get("displayName", m["id"]),
                    tags=m.get("tags", []),
                    description=m.get("description", ""),
                    default=m.get("default", False),
                    dimensions=m.get("dimensions"),
                )
            )

        providers.append(
            ProviderConfig(
                name=provider_name,
                display_name=data.get("displayName", provider_name),
                base_url=data.get("baseUrl", ""),
                models=models,
                description=data.get("description", ""),
                supports_structured_outputs=data.get(
                    "supportsStructuredOutputs", False
                ),
                api_key=api_key,
            )
        )

    return providers


def _find_model(
    providers: list[ProviderConfig], tag: str, *, prefer_default: bool = False
) -> tuple[ProviderConfig, ModelConfig] | None:
    """Find a model by tag across all providers.

    If prefer_default is True, return the first model marked default that
    also has the given tag, falling back to the first model with the tag.
    """
    first_match: tuple[ProviderConfig, ModelConfig] | None = None

    for provider in providers:
        for model in provider.models:
            if tag in model.tags:
                if first_match is None:
                    first_match = (provider, model)
                if prefer_default and model.default:
                    return (provider, model)
                if not prefer_default and first_match is not None:
                    return first_match

    return first_match


def get_chat_model(
    config_dir: str | None = None,
) -> tuple[str, str, str]:
    """Return (base_url, api_key, model_id) for the default chat model.

    Finds the first model marked default that has a "chat" tag,
    or falls back to the first model with a "chat" tag.
    """
    providers = load_providers(config_dir)
    match = _find_model(providers, "chat", prefer_default=True)
    if match is None:
        raise ValueError("No chat model found in provider configuration files.")

    provider, model = match
    api_key = provider.api_key or ""
    return (provider.base_url, api_key, model.id)


def get_embedding_model(
    config_dir: str | None = None,
) -> tuple[str, str, str, int]:
    """Return (base_url, api_key, model_id, dimensions) for the embedding model."""
    providers = load_providers(config_dir)
    match = _find_model(providers, "embedding")
    if match is None:
        raise ValueError("No embedding model found in provider configuration files.")

    provider, model = match
    api_key = provider.api_key or ""
    dims = model.dimensions
    if dims is None:
        raise ValueError(
            f"Embedding model {model.id} does not specify dimensions. "
            "Add a 'dimensions' field to the model definition."
        )
    return (provider.base_url, api_key, model.id, dims)


def get_vision_model(
    config_dir: str | None = None,
) -> tuple[str, str, str]:
    """Return (base_url, api_key, model_id) for the vision model."""
    providers = load_providers(config_dir)
    match = _find_model(providers, "vision")
    if match is None:
        raise ValueError("No vision model found in provider configuration files.")

    provider, model = match
    api_key = provider.api_key or ""
    return (provider.base_url, api_key, model.id)
