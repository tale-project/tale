/**
 * The environment the dev orchestrator starts its backend with
 * (`dev-engine.ts`), as a pure function so what the backend is told can be
 * tested without booting anything.
 *
 * The backend is the entry the container runs, in role `all` (the API and a
 * worker in one process), on the API's own port. It serves no web tier
 * (`APP_PORT=off`, read by `webTierOff` in `server.ts`): Vite serves the app
 * on the app's port, its plugins standing in for the web tier's own doors. A
 * web tier of the backend's own took that port before Vite, whose
 * `--strictPort` then failed and shut the orchestrator down, and it served
 * whatever `dist/` an earlier build had left. Set here over anything the
 * environment carries, as the port is: the repository-root `.env` serves
 * docker compose too, and an `APP_PORT` meant for a container must not give
 * this backend a web tier of its own.
 *
 * node-only by location; pure (no I/O).
 */
export function devBackendEnv(
  env: NodeJS.ProcessEnv,
  backendPort: number,
): NodeJS.ProcessEnv {
  return {
    ...env,
    TALE_ROLE: 'all',
    PORT: String(backendPort),
    APP_PORT: 'off',
  };
}
