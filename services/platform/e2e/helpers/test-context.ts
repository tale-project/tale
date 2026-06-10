import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run context shared between the auth setup project and the specs: the setup
 * writes the owner identity + organization id to `e2e/.auth/context.json`,
 * the specs read it back. Mirrors Playwright's storageState pattern
 * (`e2e/.auth/owner.json`) for non-cookie state.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const AUTH_DIR = path.join(dirname, '..', '.auth');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'owner.json');
export const CONTEXT_PATH = path.join(AUTH_DIR, 'context.json');

export interface E2ERunContext {
  organizationId: string;
  ownerEmail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRunContext(value: unknown): value is E2ERunContext {
  return (
    isRecord(value) &&
    typeof value.organizationId === 'string' &&
    typeof value.ownerEmail === 'string'
  );
}

export function readRunContext(): E2ERunContext {
  const parsed: unknown = JSON.parse(readFileSync(CONTEXT_PATH, 'utf8'));
  if (!isRunContext(parsed)) {
    throw new Error(
      `Invalid ${CONTEXT_PATH} — re-run the auth setup project (delete e2e/.auth to force it).`,
    );
  }
  return parsed;
}

/** Mock-LLM mode is the default; E2E_MOCK_LLM=0 targets a live stack. */
export function isMockLlmMode(): boolean {
  return process.env.E2E_MOCK_LLM !== '0';
}
