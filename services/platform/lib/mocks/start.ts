#!/usr/bin/env bun
/**
 * Gateway entrypoint. Started by the Playwright `webServer` config and by the
 * `api-mocks` service in `compose.test.yml`. `MOCKS_PORT` overrides the default
 * 4141 (kept in sync with the provider fixture `baseUrl` and `MOCK_LLM_PORT`).
 */

import { startGateway } from './gateway';

const port = process.env.MOCKS_PORT ? Number(process.env.MOCKS_PORT) : 4141;

await startGateway(port);
