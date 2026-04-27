# tale-telemetry

Prometheus telemetry for Tale's FastAPI services.

## Overview

One call wires up `/metrics`, request counters, request-duration histograms, and the standard process / GC collectors. HTTP metrics are labelled by FastAPI route template (not raw path), so cardinality stays bounded.

## Interface

Public functions:

- `init_telemetry(app: FastAPI)` — adds `GET /metrics` and registers the default collectors
- `shutdown_telemetry()` — releases collectors on app shutdown

```python
from fastapi import FastAPI
from tale_telemetry import init_telemetry, shutdown_telemetry

app = FastAPI()
init_telemetry(app)

# In your lifespan / shutdown handler:
shutdown_telemetry()
```

## Configuration

Consumed as a path dependency:

```toml
[project]
dependencies = ["tale-telemetry"]

[tool.uv.sources]
tale-telemetry = { path = "../../packages/tale_telemetry" }
```

## Development

```bash
bun run lint   --filter=@tale/telemetry   # ruff check
bun run format --filter=@tale/telemetry   # ruff format
```

## Layout

- `src/tale_telemetry/` — package source
- `tests/` — pytest suite
