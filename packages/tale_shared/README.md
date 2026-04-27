# tale-shared

Generic infrastructure utilities shared by every Tale Python service.

## Overview

Cross-cutting plumbing only — no domain logic. Provides settings, DB helpers, error types, logging, hashing, and SOPS secret loading.

## Interface

Public modules:

- `config` — `BaseServiceSettings` (pydantic-settings) and `providers` loader (`get_chat_model`, `get_embedding_model`, `get_vision_model`)
- `db` — `asyncpg` retry helpers (`acquire_with_retry`, `transact_with_retry`)
- `errors` — base error types
- `logging` — loguru setup, `suppress_health_check_logs`
- `utils` — `hashing`, `model_list`, `sops` (SOPS secret loading)

## Configuration

Consumed as a path dependency:

```toml
[project]
dependencies = ["tale-shared"]

[tool.uv.sources]
tale-shared = { path = "../../packages/tale_shared" }
```

## Development

```bash
bun run lint   --filter=@tale/shared   # ruff check
bun run format --filter=@tale/shared   # ruff format
```

Tests run via the consuming service's `uv run pytest`.

## Layout

- `src/tale_shared/` — package source (`config/`, `db/`, `errors/`, `logging/`, `utils/`)
- `tests/` — pytest suite
