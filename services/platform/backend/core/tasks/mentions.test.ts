import { describe, expect, it } from 'vitest';

import {
  agentMentionEntry,
  automationMentionEntry,
  buildMentionHandleIndex,
  memberMentionEntry,
} from '../../../lib/shared/mention-handles';
import {
  addedMentions,
  cutTaskText,
  descriptionMentionMode,
  editIntroducesMentions,
  findTaskMentions,
  normalizeMentionText,
  relabelTaskMentions,
  taskMentionPlainText,
} from './mentions';

const alice = memberMentionEntry({
  id: 'user-alice',
  name: 'Alice Smith',
  email: 'alice@example.com',
});
const bob = memberMentionEntry({
  id: 'user-bob',
  name: 'Bob',
  email: 'bob@example.com',
});
const vat = automationMentionEntry({
  slug: 'vat-return-desk',
  name: 'Swiss VAT return desk',
});
const opus = agentMentionEntry({
  id: '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40',
  name: 'My Opus Agent #3',
  handle: 'my-opus-agent-3',
  legacyHandles: [],
});
const index = buildMentionHandleIndex([alice, bob, vat, opus]);

const ALICE = '[@Alice Smith](mention:user/user-alice)';
const OPUS = `[@My Opus Agent #3](mention:agent/${opus.id})`;

const full = (
  body: string,
  extra: Partial<Parameters<typeof normalizeMentionText>[0]> = {},
) => normalizeMentionText({ body, index, cap: 10_000, mode: 'full', ...extra });

/** The typed handles a text holds, in order. */
const typedHandles = (body: string) =>
  findTaskMentions(body).flatMap((occurrence) =>
    occurrence.type === 'plain' ? [occurrence.handle] : [],
  );

describe('findTaskMentions', () => {
  it('reads typed handles after whitespace or at the start, lowercased', () => {
    expect(typedHandles('@alice hello @bob @Alice')).toEqual([
      'alice',
      'bob',
      'alice',
    ]);
    expect(typedHandles('hi @alice.smith and @re-searcher_1')).toEqual([
      'alice.smith',
      're-searcher_1',
    ]);
    expect(
      typedHandles('请继续 @github/create-pull-requests/pr-creator 再试'),
    ).toEqual(['github/create-pull-requests/pr-creator']);
  });

  it('reads no handle in an email address, in code or in a token', () => {
    expect(typedHandles('contact me at user@example.com')).toEqual([]);
    expect(typedHandles('`@alice` and\n\n```\n@bob\n```')).toEqual([]);
    expect(typedHandles(`${ALICE} please`)).toEqual([]);
  });
});

describe('a mention is saved as whom it names [COLLAB-R10]', () => {
  it('turns a resolved handle into a token with the current name', () => {
    expect(full('@alice please review, cc @my-opus-agent-3.')).toEqual({
      text: `${ALICE} please review, cc ${OPUS}.`,
      mentions: [
        { type: 'user', id: 'user-alice' },
        { type: 'agent', id: opus.id },
      ],
      unresolvedMentionTokens: [],
      invalidTokens: [],
    });
  });

  it('resolves a handle by any form: the id, the email name, the older name forms', () => {
    const result = full(
      `@${opus.id} and @alice.smith and @vat-return-desk and @swiss.vat.return.desk`,
    );
    expect(result.mentions).toEqual([
      { type: 'agent', id: opus.id },
      { type: 'user', id: 'user-alice' },
      { type: 'automation', id: 'vat-return-desk' },
    ]);
    expect(result.text).toContain(
      '[@Swiss VAT return desk](mention:automation/vat-return-desk)',
    );
  });

  it('gives an existing token the current name, whatever label it carries', () => {
    expect(full('[@Old Name](mention:user/user-alice) hi').text).toBe(
      `${ALICE} hi`,
    );
  });

  it('leaves a handle in code, math or a link as text, and notifies nobody', () => {
    const body = '`@alice` and ``@bob`` and $$@alice$$ and [@bob](https://x.y)';
    expect(full(body)).toEqual({
      text: body,
      mentions: [],
      unresolvedMentionTokens: [],
      invalidTokens: [],
    });
  });

  it('keeps a handle nobody answers to as typed and reports it', () => {
    const result = full('@nobody and @alice');
    expect(result.text).toBe(`@nobody and ${ALICE}`);
    expect(result.unresolvedMentionTokens).toEqual(['nobody']);
  });

  it('never makes a text longer than its limit: a growing rewrite is skipped, a shrinking one applies', () => {
    const body = `@alice ${'x'.repeat(30)} [@Someone Else](mention:user/user-gone)`;
    const result = normalizeMentionText({
      body,
      index,
      cap: body.length,
      mode: 'full',
    });
    // The token naming nobody shrinks to text; the handle stays as typed,
    // still naming Alice.
    expect(result.text).toBe(`@alice ${'x'.repeat(30)} \\@Someone Else`);
    expect(result.mentions).toEqual([{ type: 'user', id: 'user-alice' }]);
    expect(result.text.length).toBeLessThanOrEqual(body.length);
  });

  it('rewrites only the occurrences an edit adds', () => {
    const result = full('@alice owns it; @alice and @bob review', {
      previousPlain: new Map([['alice', 1]]),
    });
    expect(result.text).toBe(
      `@alice owns it; ${ALICE} and [@Bob](mention:user/user-bob) review`,
    );
  });

  it('settles a handle two people answer to by whom the text was saved naming', () => {
    const twins = buildMentionHandleIndex([
      memberMentionEntry({ id: 'u1', name: 'Ada', email: null }),
      memberMentionEntry({ id: 'u2', name: 'Ada', email: null }),
    ]);
    const prefer = new Set(['user:u1']);
    const preferred = normalizeMentionText({
      body: '@ada',
      index: twins,
      cap: 100,
      mode: 'full',
      prefer,
    });
    expect(preferred.mentions).toEqual([{ type: 'user', id: 'u1' }]);
  });

  it('checks only tokens in an imported text, and rewrites nothing in the verbatim lane', () => {
    const body = `@alice and [@X](mention:user/user-alice)`;
    expect(
      normalizeMentionText({ body, index, cap: 10_000, mode: 'tokens' }).text,
    ).toBe(`@alice and ${ALICE}`);
    expect(
      normalizeMentionText({ body, index, cap: 10_000, mode: 'verbatim' }).text,
    ).toBe(body);
  });
});

describe('a mention of someone who cannot be mentioned is saved as plain text [COLLAB-R12]', () => {
  it('writes an escaped @ and the name, so it is not read as a handle again', () => {
    const result = full('Ping [@Ada \\*L\\*](mention:user/outsider) now');
    expect(result.text).toBe('Ping \\@Ada \\*L\\* now');
    expect(findTaskMentions(result.text)).toEqual([]);
    // Read as plain text, it is `@` and the name.
    expect(taskMentionPlainText(result.text)).toBe('Ping @Ada \\*L\\* now');
    expect(result.unresolvedMentionTokens).toEqual(['Ada *L*']);
    expect(result.invalidTokens).toEqual([{ type: 'user', id: 'outsider' }]);
  });

  it('keeps a token the edited text already had', () => {
    const token = '[@Ada](mention:user/outsider)';
    const result = full(`${token} again`, {
      keepRefs: new Set(['user:outsider']),
    });
    expect(result.text).toBe(`${token} again`);
    expect(result.invalidTokens).toEqual([]);
  });
});

describe('addedMentions — the edit diff [COLLAB-R4]', () => {
  it('returns only mentions not already present', () => {
    expect(
      addedMentions(
        [{ type: 'user', id: 'user-alice' }],
        [
          { type: 'user', id: 'user-alice' },
          { type: 'user', id: 'user-bob' },
        ],
      ),
    ).toEqual([{ type: 'user', id: 'user-bob' }]);
    expect(addedMentions([], [])).toEqual([]);
  });

  it('tells an edit that names someone new from one that does not', () => {
    expect(editIntroducesMentions('@alice and @bob', '@alice')).toBe(true);
    expect(editIntroducesMentions('Reworded, @alice', '@alice owns it')).toBe(
      false,
    );
    expect(editIntroducesMentions(`${ALICE} ${ALICE}`, ALICE)).toBe(false);
    expect(editIntroducesMentions(OPUS, ALICE)).toBe(true);
    expect(editIntroducesMentions('@alice @alice', '@alice')).toBe(true);
    expect(editIntroducesMentions('no names', '@alice')).toBe(false);
  });
});

describe('reading task text', () => {
  const names = new Map([['user:user-alice', 'Alice King']]);

  it('reads tokens as @ and the current name for plain readers', () => {
    expect(
      taskMentionPlainText(`${ALICE} and [@Gone](mention:user/x)`, names),
    ).toBe('@Alice King and @Gone');
  });

  it('gives an agent the stored form with today’s names', () => {
    expect(relabelTaskMentions(`${ALICE} please`, names)).toBe(
      '[@Alice King](mention:user/user-alice) please',
    );
    expect(relabelTaskMentions(`${ALICE} please`)).toBe(`${ALICE} please`);
  });

  it('cuts a text without leaving half a token', () => {
    expect(cutTaskText(`See ${ALICE}`, 12)).toBe('See');
  });

  it('keeps an issue tracker’s typed names as typed', () => {
    expect(descriptionMentionMode('github')).toBe('tokens');
    expect(descriptionMentionMode('GlitchTip')).toBe('tokens');
    expect(descriptionMentionMode('terminal')).toBe('full');
    expect(descriptionMentionMode(null)).toBe('full');
  });
});
