// Shared SessionConfig fixture for unit tests that construct a SpawnerConfig
// literal. Kept in src/ (not a .test.ts) so multiple test files can import it
// without a barrel. Mirrors loadConfig()'s env defaults; not used by
// production code.

import type { SessionConfig } from '../types.ts';

export const TEST_SESSION_CONFIG: SessionConfig = {
  maxSessions: 10,
  maxSessionsPerOrg: 2,
  maxLifetimeMs: 86_400_000,
  maxIdleMs: 1_800_000,
  execDefaultTimeoutMs: 600_000,
  execMaxTimeoutMs: 7_200_000,
  createHealthTimeoutMs: 180_000,
  agentProfile: {
    cpus: 2,
    memory: '4g',
    pidsLimit: 512,
    nofileSoft: 4096,
    nofileHard: 8192,
    fsizeBytes: 536_870_912,
    tmpfsSize: '512m',
    shmSize: '512m',
    user: '10001:10001',
  },
};
