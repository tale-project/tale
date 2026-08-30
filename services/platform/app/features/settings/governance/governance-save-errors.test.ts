import { describe, expect, it } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

import { mapGovernanceSaveError } from './governance-save-errors';

// Identity translator: returns the key so assertions can check which
// message branch was taken without depending on the locale bundle.
const t = (key: string) => key;

describe('mapGovernanceSaveError', () => {
  it('returns the localized fallback for a `validation` BackendError instead of the raw message', () => {
    // Mirrors `saveGovernancePolicy` rejecting a bad config. The Convex
    // client re-throws this as an Error whose `.message` is a dev-facing
    // hybrid stacktrace — that must NEVER reach the toast.
    const err = new BackendError({
      code: 'validation',
      message: 'Invalid budgets configuration: <zod text>',
    });

    expect(mapGovernanceSaveError(err, t, 'budgets.saveFailed')).toBe(
      'budgets.saveFailed',
    );
  });

  it('does not surface the raw `.message` even when the error is an Error instance', () => {
    // The old `error instanceof Error ? error.message` guard always took
    // the `.message` branch here; the fix must ignore `.message`.
    const err = new Error(
      '[CONVEX A(governance/file_actions:saveGovernancePolicy)] {"code":"validation","message":"..."}\n  Called by client',
    );

    const result = mapGovernanceSaveError(err, t, 'pii.saveFailed');
    expect(result).toBe('pii.saveFailed');
    expect(result).not.toContain('CONVEX');
  });

  it('maps the `ORG_FORBIDDEN` code to the forbidden message', () => {
    const err = new BackendError({
      code: 'ORG_FORBIDDEN',
      message: 'Role "member" cannot modify governance policies.',
    });

    expect(mapGovernanceSaveError(err, t, 'contentSafety.saveFailed')).toBe(
      'errors.saveForbidden',
    );
  });

  it('falls back for an unknown code', () => {
    const err = new BackendError({ code: 'use_special_action', message: 'x' });
    expect(
      mapGovernanceSaveError(err, t, 'moderationProvider.saveFailed'),
    ).toBe('moderationProvider.saveFailed');
  });

  it('falls back for a non-Convex/plain value', () => {
    expect(mapGovernanceSaveError('boom', t, 'pii.saveFailed')).toBe(
      'pii.saveFailed',
    );
    expect(mapGovernanceSaveError(undefined, t, 'pii.saveFailed')).toBe(
      'pii.saveFailed',
    );
  });
});
