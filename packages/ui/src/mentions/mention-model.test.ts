import { describe, expect, it } from 'vitest';

import {
  addMentionRanges,
  applyTextChange,
  type MentionDoc,
  MentionHistory,
  mentionAfter,
  mentionBefore,
  parseMentionDoc,
  serializeMentionDoc,
  settleMentionDoc,
  sliceMentionDoc,
  widenToMentions,
} from './mention-model';

const KINDS = ['user', 'agent', 'automation'] as const;
type Kind = (typeof KINDS)[number];

const ADA = '[@Ada Lovelace](mention:user/u-ada)';
const BOT = '[@Research Bot](mention:agent/a-bot)';

const names: Record<string, string> = {
  'user:u-ada': 'Ada Lovelace',
  'agent:a-bot': 'QA Bot',
};

function parse(value: string, withPlain = false) {
  return parseMentionDoc<Kind>(value, {
    kinds: KINDS,
    nameOf: (ref) => names[`${ref.kind}:${ref.id}`],
    ...(withPlain
      ? {
          resolvePlain: (handle: string) =>
            handle === 'research.bot'
              ? { kind: 'agent' as const, id: 'a-bot', name: 'QA Bot' }
              : null,
        }
      : {}),
  });
}

describe('reading a stored text into a field', () => {
  it('shows each token as @ and the current name', () => {
    const doc = parse(`Hi ${ADA}, ask ${BOT}.`);
    expect(doc.text).toBe('Hi @Ada Lovelace, ask @QA Bot.');
    expect(doc.ranges).toEqual([
      { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', start: 3, end: 16 },
      { kind: 'agent', id: 'a-bot', name: 'QA Bot', start: 22, end: 29 },
    ]);
  });

  it('falls back to the label for someone it cannot name', () => {
    const doc = parse('[@Old Name](mention:agent/gone) left');
    expect(doc.text).toBe('@Old Name left');
    expect(doc.ranges[0]?.name).toBe('Old Name');
  });

  it('keeps tokens in code as written', () => {
    const value = `\`${ADA}\` and ${ADA}`;
    const doc = parse(value);
    expect(doc.text).toBe(`\`${ADA}\` and @Ada Lovelace`);
    expect(doc.ranges).toHaveLength(1);
  });

  it('names a typed handle it can resolve, and leaves the rest as text', () => {
    const doc = parse('@research.bot and @nobody', true);
    expect(doc.text).toBe('@QA Bot and @nobody');
    expect(doc.ranges).toEqual([
      {
        kind: 'agent',
        id: 'a-bot',
        name: 'QA Bot',
        start: 0,
        end: 7,
        written: '@research.bot',
      },
    ]);
  });

  it('writes a typed handle back as typed, never as a token', () => {
    const value = 'cc @Research.Bot on the crash';
    const doc = parse(value, true);
    expect(doc.text).toBe('cc @QA Bot on the crash');
    expect(serializeMentionDoc(doc)).toBe(value);
    // An edit elsewhere leaves the handle as it was typed.
    const edited = applyTextChange(doc, 'cc @QA Bot on the crash!', 24).doc;
    expect(serializeMentionDoc(edited)).toBe(`${value}!`);
    expect(settleMentionDoc(edited, KINDS)).toBe(edited);
    // A copy carries it as a token, as a pick would place it.
    expect(serializeMentionDoc(doc, { tokens: true })).toBe(
      'cc [@QA Bot](mention:agent/a-bot) on the crash',
    );
  });

  it('writes back what it read, with the current names', () => {
    const doc = parse(`Hi ${ADA}, ask ${BOT}.`);
    expect(serializeMentionDoc(doc)).toBe(
      `Hi ${ADA}, ask [@QA Bot](mention:agent/a-bot).`,
    );
    expect(parse(serializeMentionDoc(doc))).toEqual(doc);
  });

  it('escapes a name that would read as markdown', () => {
    const doc: MentionDoc<Kind> = {
      text: '@A*B_C',
      ranges: [{ kind: 'user', id: 'u', name: 'A*B_C', start: 0, end: 6 }],
    };
    expect(serializeMentionDoc(doc)).toBe('[@A\\*B\\_C](mention:user/u)');
    expect(
      parseMentionDoc(serializeMentionDoc(doc), {
        kinds: KINDS,
      }),
    ).toEqual(doc);
  });
});

describe('editing around mentions', () => {
  const doc = parse(`Hi ${ADA} there`);
  // "Hi @Ada Lovelace there": the mention spans 3..16.

  it('moves mentions after an insertion and keeps those before it', () => {
    const next = applyTextChange(doc, 'Hi you @Ada Lovelace there', 7);
    expect(next.doc.ranges[0]).toMatchObject({ start: 7, end: 20 });
    expect(next.cut).toEqual([]);
  });

  it('leaves a mention whole when typing right at its end or start', () => {
    const after = applyTextChange(doc, 'Hi @Ada Lovelacex there', 17);
    expect(after.doc.ranges[0]).toMatchObject({ start: 3, end: 16 });
    const before = applyTextChange(doc, 'Hi x@Ada Lovelace there', 4);
    expect(before.doc.ranges[0]).toMatchObject({ start: 4, end: 17 });
  });

  it('turns a name into text when typing inside it', () => {
    const next = applyTextChange(doc, 'Hi @Ada XLovelace there', 9);
    expect(next.doc.ranges).toEqual([]);
    expect(next.cut).toHaveLength(1);
  });

  it('reads a repeated letter as typed at the caret', () => {
    const repeated = parse(`aa ${ADA}`);
    const next = applyTextChange(repeated, `aaa @Ada Lovelace`, 1);
    expect(next.from).toBe(0);
    expect(next.doc.ranges[0]).toMatchObject({ start: 4 });
  });

  it('places picked or pasted mentions where their text is', () => {
    const text = applyTextChange(doc, 'Hi @Ada Lovelace there @QA Bot', 30);
    const placed = addMentionRanges(text.doc, [
      { kind: 'agent', id: 'a-bot', name: 'QA Bot', start: 23, end: 30 },
      // Not what the text says there: left out.
      { kind: 'agent', id: 'x', name: 'Nope', start: 0, end: 5 },
    ]);
    expect(placed.ranges.map((range) => range.id)).toEqual(['u-ada', 'a-bot']);
  });

  it('widens a span to whole mentions', () => {
    expect(widenToMentions(doc, 5, 18)).toEqual({ start: 3, end: 18 });
    expect(widenToMentions(doc, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it('finds the mention a deletion would bite into', () => {
    expect(mentionBefore(doc, 16)?.id).toBe('u-ada');
    expect(mentionBefore(doc, 3)).toBeNull();
    expect(mentionAfter(doc, 3)?.id).toBe('u-ada');
    expect(mentionAfter(doc, 16)).toBeNull();
  });

  it('copies the mentions wholly inside a slice', () => {
    expect(sliceMentionDoc(doc, 3, 22)).toEqual({
      text: '@Ada Lovelace there',
      ranges: [
        { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', start: 0, end: 13 },
      ],
    });
    expect(sliceMentionDoc(doc, 5, 22).ranges).toEqual([]);
  });
});

describe('mentions that would not survive being stored', () => {
  it('lets go of a mention that ended up in code, or after ! or \\', () => {
    const doc = parse(`a ${ADA} b ${BOT}`);
    const inCode = applyTextChange(doc, 'a `@Ada Lovelace` b @QA Bot', 3).doc;
    // The edit added a backtick on each side: rebuild the ranges by hand,
    // as a field that typed them one at a time would hold them.
    const typed: MentionDoc<Kind> = {
      text: inCode.text,
      ranges: [
        { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', start: 3, end: 16 },
        ...inCode.ranges,
      ],
    };
    expect(settleMentionDoc(typed, KINDS).ranges.map((r) => r.id)).toEqual([
      'a-bot',
    ]);

    const bang: MentionDoc<Kind> = {
      text: 'Hi!@Ada Lovelace',
      ranges: [
        { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', start: 3, end: 16 },
      ],
    };
    expect(settleMentionDoc(bang, KINDS).ranges).toEqual([]);
    const slash: MentionDoc<Kind> = { ...bang, text: 'Hi\\@Ada Lovelace' };
    expect(settleMentionDoc(slash, KINDS).ranges).toEqual([]);
  });

  it('lets go of a typed handle that what was typed after it changed', () => {
    const doc = parse('ask @research.bot', true);
    // "ask @QA Bot" + "s" would store `@research.bots`: another handle.
    const longer = applyTextChange(doc, 'ask @QA Bots', 12).doc;
    expect(longer.ranges).toHaveLength(1);
    expect(settleMentionDoc(longer, KINDS).ranges).toEqual([]);
    // A full stop ends a sentence, not the handle.
    const stop = applyTextChange(doc, 'ask @QA Bot.', 12).doc;
    expect(settleMentionDoc(stop, KINDS)).toBe(stop);
    expect(serializeMentionDoc(stop)).toBe('ask @research.bot.');
  });

  it('keeps the same doc when every mention survives', () => {
    const doc = parse(`Hi ${ADA}`);
    expect(settleMentionDoc(doc, KINDS)).toBe(doc);
  });
});

describe('mention history', () => {
  it('brings back the mentions of a text an undo restores', () => {
    const history = new MentionHistory<Kind>();
    const doc = parse(`Hi ${ADA}`);
    history.record(doc);
    history.record(applyTextChange(doc, 'Hi ', 3).doc);
    expect(history.recall('Hi @Ada Lovelace')).toBe(doc);
    expect(history.recall('never typed')).toBeNull();
  });
});
