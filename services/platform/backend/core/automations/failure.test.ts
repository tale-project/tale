// @vitest-environment node

/**
 * Unit lock for which failures count toward a trigger's failure streak
 * (`trigger-failures.ts`): exactly the codes the next occurrence would
 * repeat. A transient code that counted would pause every schedule through
 * a provider's rate limit or outage; a permanent one that did not would let
 * a broken schedule fire forever (#3092). Also locks which run code an
 * agent step's own failure code reports as.
 */

import { describe, expect, it } from 'vitest';

import {
  agentFailureCodeOf,
  isPermanentFailureCode,
  PERMANENT_FAILURE_CODES,
  PERMANENT_FAILURES_BEFORE_PAUSE,
  RUN_FAILURE_CODES,
} from './failure.ts';

describe('isPermanentFailureCode', () => {
  it.each([
    'node_error',
    'connector_error',
    'llm_output_invalid',
    'auth_error',
    'missing_api_key',
    'credit_exhausted',
    'model_not_found',
  ])('counts %s', (code) => {
    expect(isPermanentFailureCode(code)).toBe(true);
  });

  it.each([
    'rate_limited',
    'provider_unreachable',
    'provider_error',
    'budget_exceeded',
    'approval_rejected',
    'execution_limit',
    'automation_deleted',
    'turn_crashed',
    'deadline',
    'harness_error',
  ])('leaves %s out', (code) => {
    expect(isPermanentFailureCode(code)).toBe(false);
  });

  it('leaves out a failure no site classified, and an unknown code', () => {
    expect(isPermanentFailureCode(null)).toBe(false);
    expect(isPermanentFailureCode(undefined)).toBe(false);
    expect(isPermanentFailureCode('')).toBe(false);
    expect(isPermanentFailureCode('something_new')).toBe(false);
  });

  it('names only codes a run can carry', () => {
    for (const code of PERMANENT_FAILURE_CODES) {
      expect(RUN_FAILURE_CODES).toContain(code);
    }
  });
});

describe('agentFailureCodeOf', () => {
  it.each([
    'harness_error',
    'turn_crashed',
    'session_gone',
    'start_failed',
    'resume_failed',
    'deadline',
    'budget_exceeded',
  ])('keeps the agent code %s on the wire', (code) => {
    expect(agentFailureCodeOf(code)).toBe(code);
  });

  it('reports a retry-only code as the code it refines, so the OpenAPI enum does not move', () => {
    // Every account of the broker was cooling down: the turn never started,
    // as `start_failed` said before the code was told apart.
    expect(agentFailureCodeOf('credential_cooldown')).toBe('start_failed');
    // The broker refreshed the account under the turn: a harness error, as
    // it was before.
    expect(agentFailureCodeOf('credential_rotated')).toBe('harness_error');
    expect(RUN_FAILURE_CODES).not.toContain('credential_cooldown');
    expect(RUN_FAILURE_CODES).not.toContain('credential_rotated');
  });

  it('files anything else, or nothing, under the harness', () => {
    expect(agentFailureCodeOf(undefined)).toBe('harness_error');
    expect(agentFailureCodeOf(null)).toBe('harness_error');
    expect(agentFailureCodeOf('something_new')).toBe('harness_error');
    // Not an own key of the alias table either.
    expect(agentFailureCodeOf('toString')).toBe('harness_error');
  });
});

describe('PERMANENT_FAILURES_BEFORE_PAUSE', () => {
  it('asks for a streak, never a single failure', () => {
    // The copy that names it ("{failures} runs in a row") reads as plural,
    // and one failure is no pattern.
    expect(PERMANENT_FAILURES_BEFORE_PAUSE).toBeGreaterThanOrEqual(2);
  });
});
