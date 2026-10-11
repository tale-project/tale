import { describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import { ConnectorError } from '../errors';
import { notifyNatives, type WorkflowNotifyStore } from './platform-notify';

const RUN_STEP = {
  kind: 'workflow',
  runId: 'run_7',
  nodeId: 'tell',
} as const;

/** A call as the executor makes it — by default, a step of run `run_7`;
 * `null` for a call that names no caller at all. */
function stepOf(
  caller: NativeConnectorContext['caller'] | null = RUN_STEP,
): NativeConnectorContext {
  return {
    organizationId: 'org_1',
    credentialId: 'platform',
    authMethod: 'platform',
    idempotencyKey: 'run_7/tell/0/0',
    ...(caller !== null && { caller }),
  } as NativeConnectorContext;
}

function notifyWith(
  answer: Awaited<ReturnType<WorkflowNotifyStore['notify']>>,
) {
  const notify = vi.fn<WorkflowNotifyStore['notify']>(() =>
    Promise.resolve(answer),
  );
  const native = notifyNatives({ notify })['notify.member'];
  return { notify, native };
}

const SENT = {
  ok: true as const,
  delivered: [{ to: 'ada@example.com', userId: 'usr_ada' }],
  skipped: [
    { to: 'usr_noah', userId: 'usr_noah', reason: 'preference' as const },
  ],
};

async function refusalOf(promise: Promise<unknown>): Promise<ConnectorError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ConnectorError);
  return caught as ConnectorError;
}

describe('notify.member', () => {
  it('sends as the run the step belongs to, and answers who got it [CONN-R25]', async () => {
    const { notify, native } = notifyWith(SENT);
    await expect(
      native(
        {
          to: ['ada@example.com', 'usr_noah'],
          title: '  Weekly report\n ready ',
          message: 'Revenue is up 4 %.',
          link: '/dashboard/org_1/documents/',
        },
        stepOf(),
      ),
    ).resolves.toEqual({ delivered: SENT.delivered, skipped: SENT.skipped });
    expect(notify).toHaveBeenCalledWith({
      organizationId: 'org_1',
      runId: 'run_7',
      // The execution's ledger key: a retry finds what this try sent.
      idempotencyKey: 'run_7/tell/0/0',
      to: ['ada@example.com', 'usr_noah'],
      // One line: the bell's heading and the email's subject.
      title: 'Weekly report ready',
      message: 'Revenue is up 4 %.',
      link: '/dashboard/org_1/documents',
    });
  });

  it('takes a blank message or link as none', async () => {
    const { notify, native } = notifyWith(SENT);
    await native(
      { to: ['run-starter'], title: 'Done', message: ' ', link: '' },
      stepOf(),
    );
    expect(notify.mock.calls[0]?.[0]).not.toHaveProperty('message');
    expect(notify.mock.calls[0]?.[0]).not.toHaveProperty('link');
  });

  it('keeps an https link as it is', async () => {
    const { notify, native } = notifyWith(SENT);
    await native(
      {
        to: ['ada@example.com'],
        title: 'Done',
        link: 'https://reports.example.com/weekly?week=41',
      },
      stepOf(),
    );
    expect(notify.mock.calls[0]?.[0].link).toBe(
      'https://reports.example.com/weekly?week=41',
    );
  });

  it.each([
    ['a plaintext address', 'http://reports.example.com/weekly'],
    ['another organization', '/dashboard/org_2/documents'],
    ['a script', 'javascript:alert(1)'],
  ])('refuses a link to %s before sending anything', async (_case, link) => {
    const { notify, native } = notifyWith(SENT);
    const error = await refusalOf(
      native({ to: ['ada@example.com'], title: 'Done', link }, stepOf()),
    );
    expect(error.code).toBe('INPUT_INVALID');
    expect(error.message).toContain('link');
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['nobody', { to: [], title: 'Done' }],
    [
      'more than 20 members',
      {
        to: Array.from({ length: 21 }, (_, at) => `m${at}@example.com`),
        title: 'Done',
      },
    ],
    ['a title over 120 characters', { to: ['a@b.c'], title: 'T'.repeat(121) }],
    ['a blank title', { to: ['a@b.c'], title: ' \n ' }],
    [
      'words over 2 000 characters',
      { to: ['a@b.c'], title: 'Done', message: 'w'.repeat(2001) },
    ],
    ['a field it does not know', { to: ['a@b.c'], title: 'Done', cc: [] }],
  ])('refuses a message to %s', async (_case, input) => {
    const { notify, native } = notifyWith(SENT);
    const error = await refusalOf(native(input, stepOf()));
    expect(error.code).toBe('INPUT_INVALID');
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuses a caller that is not a step of a run', async () => {
    const { notify, native } = notifyWith(SENT);
    const error = await refusalOf(
      native({ to: ['ada@example.com'], title: 'Done' }, stepOf(null)),
    );
    expect(error.code).toBe('CALLER_UNKNOWN');
    expect(notify).not.toHaveBeenCalled();
  });

  it('fails the step, naming who is not a member, when the store refuses one [CONN-R25]', async () => {
    const { native } = notifyWith({
      ok: false,
      refusal: {
        kind: 'not_a_member',
        recipients: ['noah@example.com', 'mia@example.com'],
      },
    });
    const error = await refusalOf(
      native({ to: ['noah@example.com'], title: 'Done' }, stepOf()),
    );
    expect(error.message).toContain('noah@example.com, mia@example.com');
    expect(error).toHaveProperty('failure', {
      reason: 'NOTIFY_NOT_A_MEMBER',
      params: { recipient: 'noah@example.com' },
    });
  });

  it('fails the step when the run would pass its cap [CONN-R26]', async () => {
    const { native } = notifyWith({
      ok: false,
      refusal: { kind: 'run_limit', limit: 100, sent: 99 },
    });
    const error = await refusalOf(
      native({ to: ['a@b.c', 'd@e.f'], title: 'Done' }, stepOf()),
    );
    expect(error.message).toContain('99 of its 100');
    expect(error).toHaveProperty('failure', {
      reason: 'NOTIFY_RUN_LIMIT',
      params: { limit: 100 },
    });
  });
});
