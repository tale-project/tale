import { describe, it, expect } from 'vitest';

import {
  ERASURE_REASON_CODES,
  ERASURE_WATCHDOG_TIMEOUT_MESSAGE,
} from '../../core/governance/erasure_constants';
import { isValidErasureReasonCode } from './service';

/**
 * The reason-code vocabulary has exactly ONE source of truth —
 * `core/governance/erasure_constants.ts`, the list the file-request
 * picker, the i18n labels, and the docs speak. The service once carried a
 * divergent local copy (`child_consent` instead of `child`), so the
 * documented "child subject" ground could never be filed; these tests pin
 * the live validator to the shared list. The full filing arc (including
 * `child` over HTTP) runs in the integration check.
 */

describe('isValidErasureReasonCode', () => {
  it('accepts every code the constants module (and the picker) offers', () => {
    for (const code of ERASURE_REASON_CODES) {
      expect(isValidErasureReasonCode(code)).toBe(true);
    }
  });

  it("accepts the documented Art 17(1)(f) ground 'child'", () => {
    expect(isValidErasureReasonCode('child')).toBe(true);
  });

  it("rejects the retired divergent copy's 'child_consent'", () => {
    // Stored rows with the old code were folded into 'child' by migration
    // 0062; the filing door speaks only the documented vocabulary.
    expect(isValidErasureReasonCode('child_consent')).toBe(false);
  });

  it('rejects unknown codes', () => {
    expect(isValidErasureReasonCode('')).toBe(false);
    expect(isValidErasureReasonCode('gdpr')).toBe(false);
  });
});

describe('ERASURE_WATCHDOG_TIMEOUT_MESSAGE', () => {
  it('stays the exact persisted sentinel — stored receipts match on it', () => {
    // The watchdog WRITES this string onto failed receipts and
    // `retryErasure` refuses receipts carrying it. Changing the value
    // orphans every already-written row (their retry guard silently stops
    // matching), so a change requires a data migration — this pin makes
    // that explicit.
    expect(ERASURE_WATCHDOG_TIMEOUT_MESSAGE).toBe(
      'Erasure timed out and was stopped by the watchdog. File a new request.',
    );
  });
});
