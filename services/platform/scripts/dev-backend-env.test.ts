import { describe, expect, it } from 'vitest';

import { webTierOff } from '../server';
import { devBackendEnv } from './dev-backend-env';

describe('the backend the dev orchestrator starts', () => {
  it('serves the API alone, on its own port: Vite serves the app', () => {
    const env = devBackendEnv({ PORT: '3000' }, 3005);
    expect(env.TALE_ROLE).toBe('all');
    expect(env.PORT).toBe('3005');
    // Read as `backend/main.ts` reads it: no web tier, so nothing of the
    // backend's takes the port Vite binds with --strictPort.
    expect(webTierOff(env.APP_PORT)).toBe(true);
  });

  it('starts no web tier when the environment names an app port', () => {
    // The repository-root `.env` is docker compose's env_file as well.
    const env = devBackendEnv({ APP_PORT: '3000' }, 3005);
    expect(webTierOff(env.APP_PORT)).toBe(true);
  });

  it('hands the rest of the environment on as it is', () => {
    const env = devBackendEnv(
      { DATABASE_URL: 'postgresql://db', SITE_URL: 'http://localhost:3000' },
      3005,
    );
    expect(env.DATABASE_URL).toBe('postgresql://db');
    expect(env.SITE_URL).toBe('http://localhost:3000');
  });
});
