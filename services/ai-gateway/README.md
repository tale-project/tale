# @tale/ai-gateway

Multi-provider AI subscription credential gateway

```bash
bun run --filter @tale/ai-gateway dev       # Vite dev server on :3004
bun run --filter @tale/ai-gateway build     # Production bundle
bun run --filter @tale/ai-gateway typecheck
bun run --filter @tale/ai-gateway test
```

The app uses Vite, React, TanStack Router, and the shared `@tale/ui` stylesheet and components.
Run commands from the repository root after installing dependencies. Use `app/` for routes and
components, and keep every shipped locale under `messages/` aligned.

For UI changes, check keyboard access, focus, and narrow layouts in the browser. Follow the
[manual test guide](tests/manual/readme.md) and the repository's design and translation contracts.
Run the workspace lint and type checks as well as tests before submitting a change.
