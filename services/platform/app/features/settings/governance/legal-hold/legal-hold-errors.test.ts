import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAdapted } from '@/app/lib/backend/adapters';
import { settingsWriteAdapters } from '@/app/lib/backend/settings';
import type { LegalHoldErrorCode } from '@/backend/domains/legal_holds/service';
import { i18n } from '@/tests/utils/i18n-all-languages';

import { mapLegalHoldError } from './legal-hold-errors';

// #4840: the mapper knew the 0.4 codes (`forbidden`, `not_found`,
// `TARGET_NOT_IN_ORG`, `LEGAL_HOLD_RELEASE_NOT_PENDING`, …) while the 0.5
// doors answer others, so most refusals fell through to the door's English
// sentence, in every locale. Each refusal here takes the real lane — the
// door's envelope, the adapter row, `runAdapted` — into the mapper.

type LegalHoldWrite =
  | 'placeLegalHold'
  | 'requestLegalHoldRelease'
  | 'approveLegalHoldRelease'
  | 'rejectLegalHoldRelease'
  | 'upsertLegalMatter'
  | 'closeLegalMatter';

const ARGS: Record<LegalHoldWrite, Record<string, unknown>> = {
  placeLegalHold: {
    organizationId: 'org-a',
    targetType: 'userMembership',
    targetId: 'user-b',
    reason: 'Pending litigation',
  },
  requestLegalHoldRelease: {
    organizationId: 'org-a',
    holdId: 'hold-a',
    reason: 'Settled',
  },
  approveLegalHoldRelease: { organizationId: 'org-a', requestId: 'request-a' },
  rejectLegalHoldRelease: { organizationId: 'org-a', requestId: 'request-a' },
  upsertLegalMatter: { organizationId: 'org-a', name: 'Acme v. Example' },
  closeLegalMatter: { organizationId: 'org-a', matterId: 'matter-a' },
};

/** One door's answer: the write it refuses, its status, and the sentence it
 * writes for API clients (none for a bare code). */
interface Answer {
  write: LegalHoldWrite;
  status: number;
  message?: string;
  data?: Record<string, unknown>;
}

interface Refusal {
  answers: Answer[];
  /** What the person reads instead: a `governance` catalog key. */
  key: string;
  args?: Record<string, unknown>;
  /** Also shown beside the field the refusal is about. */
  inline?: true;
}

/**
 * Every code `LegalHoldError` carries, as the doors answer it, and the words a
 * person reads for it. Typed against the service's codes: a new code fails the
 * typecheck until it has a row here, and this suite until the mapper words it.
 * `LEGAL_HOLD_ACTIVE` is the delete guard other domains throw (deleting a
 * held document, product or organization); no legal-hold door answers it.
 */
const SERVICE_REFUSALS = {
  FORBIDDEN: {
    answers: [
      {
        write: 'placeLegalHold',
        status: 403,
        message: 'Only org admins manage legal holds',
      },
      // The matters' doors check the role themselves and send the bare code.
      { write: 'upsertLegalMatter', status: 403 },
    ],
    key: 'legalHold.errors.forbidden',
  },
  REASON_REQUIRED: {
    answers: [
      { write: 'placeLegalHold', status: 400, message: 'A reason is required' },
    ],
    key: 'legalHold.errors.validation',
  },
  CROSS_ORG_TARGET: {
    answers: [
      {
        write: 'placeLegalHold',
        status: 403,
        message: 'An org hold must target the placing organization itself',
      },
    ],
    key: 'legalHold.errors.targetOrgMismatch',
  },
  TARGET_NOT_FOUND: {
    answers: [
      {
        write: 'placeLegalHold',
        status: 404,
        message: 'The user is not a member of this organization',
      },
    ],
    key: 'legalHold.errors.targetNotInOrg',
  },
  MATTER_NOT_FOUND: {
    answers: [
      {
        write: 'placeLegalHold',
        status: 404,
        message:
          'matterRef does not point at an existing matter in this organization.',
      },
      { write: 'closeLegalMatter', status: 404, message: 'Matter not found' },
    ],
    key: 'legalHold.errors.matterNotFound',
  },
  LEGAL_HOLD_ALREADY_ACTIVE: {
    answers: [
      {
        write: 'placeLegalHold',
        status: 409,
        message: 'An active hold already exists for this target',
      },
    ],
    key: 'legalHold.errors.alreadyActive',
  },
  HOLD_NOT_FOUND: {
    answers: [
      {
        write: 'requestLegalHoldRelease',
        status: 404,
        message: 'Hold not found',
      },
    ],
    key: 'legalHold.errors.holdNotFound',
  },
  LEGAL_HOLD_ALREADY_RELEASED: {
    answers: [
      {
        write: 'requestLegalHoldRelease',
        status: 409,
        message: 'This hold is already released',
      },
    ],
    key: 'legalHold.errors.alreadyReleased',
  },
  LEGAL_HOLD_RELEASE_ALREADY_PENDING: {
    answers: [
      {
        write: 'requestLegalHoldRelease',
        status: 409,
        message:
          'A release request is already pending for this hold. Approve or reject it first.',
      },
    ],
    key: 'legalHold.errors.releaseAlreadyPending',
  },
  REQUEST_NOT_FOUND: {
    answers: [
      {
        write: 'approveLegalHoldRelease',
        status: 404,
        message: 'Request not found',
      },
    ],
    key: 'legalHold.errors.requestNotFound',
  },
  // Another admin decided the release request first.
  REQUEST_NOT_PENDING: {
    answers: [
      {
        write: 'approveLegalHoldRelease',
        status: 409,
        message: 'This request was already decided',
      },
      {
        write: 'rejectLegalHoldRelease',
        status: 409,
        message: 'Request not found or already decided',
      },
    ],
    key: 'legalHold.errors.releaseNotPending',
  },
  SELF_APPROVAL_BLOCKED: {
    answers: [
      {
        write: 'approveLegalHoldRelease',
        status: 403,
        message:
          'A different admin must approve the release. Set TALE_LEGAL_HOLD_SINGLE_ADMIN_OK=true to allow self-approval in single-admin orgs.',
      },
    ],
    key: 'legalHold.errors.selfApprovalBlocked',
    inline: true,
  },
  APPROVAL_TOO_SOON: {
    answers: [
      {
        write: 'approveLegalHoldRelease',
        status: 409,
        message: 'Approval requires at least 5 min after the request.',
        data: { remainingMs: 241_200 },
      },
    ],
    key: 'legalHold.errors.approvalTooSoon',
    args: { countdown: '4m 02s' },
    inline: true,
  },
  REQUESTER_NO_LONGER_ADMIN: {
    answers: [
      {
        write: 'approveLegalHoldRelease',
        status: 409,
        message:
          'The original requester is no longer an admin of this org. Reject this request and have a current admin file a fresh one.',
      },
    ],
    key: 'legalHold.errors.requesterNoLongerAdmin',
    inline: true,
  },
} satisfies Record<Exclude<LegalHoldErrorCode, 'LEGAL_HOLD_ACTIVE'>, Refusal>;

/** The matters' own codes (`backend/domains/governance/settings-tail.ts`)
 * and a body a door's schema refused. */
const OTHER_REFUSALS = {
  'invalid body': {
    answers: [
      {
        write: 'placeLegalHold',
        status: 400,
        message: 'reason: Too big: expected string to have <=2000 characters',
        data: {
          issues: [
            {
              path: 'reason',
              message: 'Too big: expected string to have <=2000 characters',
            },
          ],
        },
      },
    ],
    key: 'legalHold.errors.validation',
  },
  MATTER_NAME_INVALID: {
    answers: [
      { write: 'upsertLegalMatter', status: 400, message: 'Invalid name' },
    ],
    key: 'legalHold.errors.validation',
  },
  // Nothing the admin can change: the generic line.
  MATTER_CREATE_FAILED: {
    answers: [
      { write: 'upsertLegalMatter', status: 400, message: 'Insert failed' },
    ],
    key: 'legalHold.errors.generic.description',
  },
} satisfies Record<string, Refusal>;

const REFUSALS: Record<string, Refusal> = {
  ...SERVICE_REFUSALS,
  ...OTHER_REFUSALS,
};

const CASES = Object.entries(REFUSALS).flatMap(([code, refusal]) =>
  refusal.answers.map((answer) => ({ code, answer, refusal })),
);

const LOCALES = ['en', 'de', 'fr'] as const;

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

/** What `write` throws when its door answers `status` with `body`. */
async function thrownBy(
  write: LegalHoldWrite,
  status: number,
  body: Record<string, unknown>,
): Promise<unknown> {
  vi.spyOn(window, 'fetch').mockResolvedValue(Response.json(body, { status }));
  const adapter = settingsWriteAdapters[`governance/legal_hold:${write}`];
  if (adapter === undefined) throw new Error(`No adapter row for ${write}`);
  return runAdapted(() => adapter.run(ARGS[write], {})).then(
    () => {
      throw new Error(`${write} resolved`);
    },
    (error: unknown) => error,
  );
}

function bodyOf(code: string, answer: Answer): Record<string, unknown> {
  return {
    error: code,
    ...(answer.message !== undefined ? { message: answer.message } : {}),
    ...(answer.data !== undefined ? { data: answer.data } : {}),
  };
}

describe('mapLegalHoldError', () => {
  it.each(CASES)(
    'words $code from $answer.write in the reader’s language',
    async ({ code, answer, refusal }) => {
      const error = await thrownBy(
        answer.write,
        answer.status,
        bodyOf(code, answer),
      );

      for (const locale of LOCALES) {
        const t = i18n.getFixedT(locale, 'governance');
        const words = t(refusal.key, refusal.args);
        // The catalog has the text: i18next answers a missing key with itself.
        expect(words, `${locale}: ${refusal.key}`).not.toBe(refusal.key);

        const mapped = mapLegalHoldError(error, t);
        expect(mapped.title).toBe(t('legalHold.errors.generic.title'));
        expect(mapped.description, locale).toBe(words);
        if (answer.message !== undefined) {
          expect(mapped.description).not.toContain(answer.message);
        }
        expect(mapped.fieldError).toBe(
          refusal.inline === true ? words : undefined,
        );
      }
    },
  );

  it('keeps the countdown an early approval waits for', async () => {
    const answer = SERVICE_REFUSALS.APPROVAL_TOO_SOON.answers[0]!;
    const error = await thrownBy(
      answer.write,
      answer.status,
      bodyOf('APPROVAL_TOO_SOON', answer),
    );

    expect(
      mapLegalHoldError(error, i18n.getFixedT('en', 'governance')),
    ).toMatchObject({
      remainingMs: 241_200,
      fieldError: 'Approval is allowed in 4m 02s.',
    });
  });

  it('reads a code it does not know as the generic line, never the door’s sentence', async () => {
    const error = await thrownBy('placeLegalHold', 409, {
      error: 'LEGAL_HOLD_SOMETHING_NEW',
      message: 'A sentence written for API clients',
    });

    for (const locale of LOCALES) {
      const t = i18n.getFixedT(locale, 'governance');
      expect(mapLegalHoldError(error, t)).toEqual({
        title: t('legalHold.errors.generic.title'),
        description: t('legalHold.errors.generic.description'),
      });
    }
  });

  it('tells a person whose session lapsed to sign in again', async () => {
    const error = await thrownBy('approveLegalHoldRelease', 401, {
      error: 'UNAUTHORIZED',
      message: 'Unauthorized: send an API key to the REST API',
    });

    expect(
      mapLegalHoldError(error, i18n.getFixedT('en', 'governance')).description,
    ).toBe('Your session has ended. Sign in again.');
  });

  it('reads a fault as the generic line', async () => {
    const error = await thrownBy('placeLegalHold', 500, {
      error: 'INTERNAL',
      message: 'relation "app.legal_holds" does not exist',
    });

    const t = i18n.getFixedT('en', 'governance');
    expect(mapLegalHoldError(error, t).description).toBe(
      t('legalHold.errors.generic.description'),
    );
  });
});
