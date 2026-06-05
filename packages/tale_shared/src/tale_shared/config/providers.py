"""Provider configuration reader for file-based LLM provider config."""

import json
import logging
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from tale_shared.config.org_slug import validate_org_slug
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
    dimensions: int | None = None
    # Optional per-model env-var name holding the API key (issue #1711).
    secrets_env: str | None = None


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
    defaults: dict[str, str] = field(default_factory=dict)
    # Optional provider-level env-var name holding the API key (issue #1711).
    secrets_env: str | None = None


# Deployment allowlist (empty = locked) gating which env-var names may source a
# provider API key. Mirrors the platform's `TALE_PROVIDER_SECRET_ENV_ALLOWLIST`
# so the platform and the Python services resolve the same effective key. See
# `services/platform/convex/providers/secret_resolver.ts`.
_ALLOWLIST_ENV = "TALE_PROVIDER_SECRET_ENV_ALLOWLIST"


def _env_secret(name: str | None) -> str | None:
    """Resolve an env-var name to its trimmed value, honoring the allowlist.

    Returns None when the name is missing, not allowlisted, or the env var is
    empty/whitespace. Trailing-newline normalization (a common Vault/k8s
    injection footgun) is applied to env values here.
    """
    if not name:
        return None
    raw = os.environ.get(_ALLOWLIST_ENV, "")
    allowlist = {n.strip() for n in raw.split(",") if n.strip()}
    if name not in allowlist:
        logger.warning(
            "secretsEnv %r is not in %s (empty allowlist disables the env key "
            "source) — falling back to the secrets file",
            name,
            _ALLOWLIST_ENV,
        )
        return None
    value = os.environ.get(name, "").strip()
    if not value:
        logger.warning(
            "secretsEnv %r is set but the env var is empty/unset — falling back to the secrets file",
            name,
        )
        return None
    return value


def _resolve_api_key(provider: "ProviderConfig", model: "ModelConfig") -> str:
    """Resolve the effective API key for a model (issue #1711).

    Order: model env -> provider env -> provider file key. The Python loader has
    no per-model file-key tier (only `apiKey`), so this is 3-tier. Returns ""
    (never None) when nothing resolves, preserving the previous
    ``provider.api_key or ""`` contract and the config-equality used by the
    rag/crawler per-org client caches.
    """
    for name in (model.secrets_env, provider.secrets_env):
        value = _env_secret(name)
        if value:
            return value
    return provider.api_key or ""


def load_providers(
    org_slug: str,
    config_dir: str | None = None,
) -> list[ProviderConfig]:
    """Read all provider JSON files from {config_dir}/{org_slug}/providers/.

    Under the org-first config layout, each org owns its own provider
    catalog at `<root>/<org_slug>/providers/`. `org_slug` is required —
    pinning RAG/crawler globally to the `default` org's providers would
    quietly serve the wrong models to other orgs.

    Reads *.json (excluding *.secrets.json) and decrypts matching
    *.secrets.json files via SOPS.
    """
    # Defense in depth: the FastAPI deps in RAG / crawler already gate
    # `X-Tale-Org` against the same regex at request boundary, but
    # internal callers in long-running tasks (e.g. crawler scheduler,
    # vision hot paths) reach this function with a slug taken from
    # `get_active_org()` or other module state. A `.` or `/etc` slipping
    # in here would silently route to `<base>/providers` or `/etc/
    # providers` via Path()'s "absolute resets" / "dot is a no-op"
    # semantics — exactly the legacy-flat-layout class the org-first
    # refactor exists to retire. Validate at the boundary, not just on
    # the way in. (Round-2 P1-30.)
    validate_org_slug(org_slug)

    shared_config = os.environ.get("TALE_PLATFORM_SHARED_CONFIG_DIR")
    if shared_config:
        base = Path(shared_config)
    else:
        base = Path(config_dir or os.environ.get("TALE_CONFIG_DIR") or os.environ.get("CONFIG_DIR", DEFAULT_CONFIG_DIR))
    providers_dir = base / org_slug / "providers"

    if not providers_dir.is_dir():
        logger.warning(
            "Providers directory not found for org '%s': %s",
            org_slug,
            providers_dir,
        )
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
                    dimensions=m.get("dimensions"),
                    secrets_env=m.get("secretsEnv"),
                )
            )

        # Read defaults map, migrating legacy per-model default if needed
        defaults: dict[str, str] = {}
        if "defaults" in data and isinstance(data["defaults"], dict):
            defaults = {k: v for k, v in data["defaults"].items() if isinstance(k, str) and isinstance(v, str)}
        else:
            # Migrate legacy format: model-level default: true
            for m in data.get("models", []):
                if m.get("default") is True:
                    for tag in m.get("tags", []):
                        if tag not in defaults:
                            defaults[tag] = m["id"]

        providers.append(
            ProviderConfig(
                name=provider_name,
                display_name=data.get("displayName", provider_name),
                base_url=data.get("baseUrl", ""),
                models=models,
                description=data.get("description", ""),
                supports_structured_outputs=data.get("supportsStructuredOutputs", False),
                api_key=api_key,
                defaults=defaults,
                secrets_env=data.get("secretsEnv"),
            )
        )

    return providers


def _find_model(
    providers: list[ProviderConfig], tag: str, *, prefer_default: bool = False
) -> tuple[ProviderConfig, ModelConfig] | None:
    """Find a model by tag across all providers.

    If prefer_default is True, check the provider-level defaults map first,
    falling back to the first model with the tag.
    """
    if prefer_default:
        for provider in providers:
            default_model_id = provider.defaults.get(tag)
            if default_model_id:
                for model in provider.models:
                    if model.id == default_model_id:
                        return (provider, model)

    for provider in providers:
        for model in provider.models:
            if tag in model.tags:
                return (provider, model)

    return None


def get_chat_model(
    org_slug: str,
    config_dir: str | None = None,
) -> tuple[str, str, str]:
    """Return (base_url, api_key, model_id) for the org's default chat model.

    Finds the first model marked default that has a "chat" tag,
    or falls back to the first model with a "chat" tag.
    """
    providers = load_providers(org_slug, config_dir)
    match = _find_model(providers, "chat", prefer_default=True)
    if match is None:
        raise ValueError(f"No chat model found in provider configuration files for org '{org_slug}'.")

    provider, model = match
    api_key = _resolve_api_key(provider, model)
    return (provider.base_url, api_key, model.id)


def get_embedding_model(
    org_slug: str,
    config_dir: str | None = None,
) -> tuple[str, str, str, int]:
    """Return (base_url, api_key, model_id, dimensions) for the org's embedding model."""
    providers = load_providers(org_slug, config_dir)
    match = _find_model(providers, "embedding", prefer_default=True)
    if match is None:
        raise ValueError(f"No embedding model found in provider configuration files for org '{org_slug}'.")

    provider, model = match
    api_key = _resolve_api_key(provider, model)
    dims = model.dimensions
    if dims is None:
        raise ValueError(
            f"Embedding model {model.id} does not specify dimensions. Add a 'dimensions' field to the model definition."
        )
    return (provider.base_url, api_key, model.id, dims)


def get_vision_model(
    org_slug: str,
    config_dir: str | None = None,
) -> tuple[str, str, str]:
    """Return (base_url, api_key, model_id) for the org's vision model."""
    providers = load_providers(org_slug, config_dir)
    match = _find_model(providers, "vision", prefer_default=True)
    if match is None:
        raise ValueError(f"No vision model found in provider configuration files for org '{org_slug}'.")

    provider, model = match
    api_key = _resolve_api_key(provider, model)
    return (provider.base_url, api_key, model.id)
