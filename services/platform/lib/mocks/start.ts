#!/usr/bin/env bun
/**
 * Gateway entrypoint. Started by the Playwright `webServer` config, by the
 * manual test setup (`tests/manual/setup.md`) and by the docs screenshot runbook
 * and its workflow. `MOCKS_PORT` overrides the default 4141 (kept in sync with
 * the provider fixture `baseUrl` and `MOCK_LLM_PORT`); the screenshot capture's
 * preflight probes the same port.
 */

import { startGateway } from './gateway';

const port = process.env.MOCKS_PORT ? Number(process.env.MOCKS_PORT) : 4141;

await startGateway(port);
