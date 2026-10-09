import { describe, expect, test } from 'bun:test';

import {
  MAX_PASTE_CHARS,
  chatPrompt,
  quoteFrom,
  threadTitle,
} from '../../src/data/chat.ts';
import {
  MAX_DOCUMENT_BYTES,
  MIN_DOCUMENT_BYTES,
  documentSize,
  generateDocument,
  knowledgeQuery,
} from '../../src/data/documents.ts';
import {
  DATA_LOCALES,
  type DataLocale,
  UserFaker,
  drawLocale,
} from '../../src/data/faker.ts';
import {
  HOSTILE_STRINGS,
  hostileString,
  oversized,
  wellFormed,
} from '../../src/data/hostile.ts';
import {
  PREDEFINED_LABELS,
  contactDraft,
  customInstructions,
  projectDraft,
  searchTerm,
  taskComment,
  taskDraft,
} from '../../src/data/work.ts';
import { mulberry32 } from '../../src/runner/assign.ts';

/** A user's generators: one random stream drives the choices and Faker. */
function userData(
  seed: number,
  locale?: DataLocale,
): {
  random: () => number;
  data: UserFaker;
} {
  const random = mulberry32(seed);
  return { random, data: new UserFaker(random, locale ?? drawLocale(random)) };
}

// The platform's own patterns (contacts `input-schema.ts`, shared
// `schemas/common.ts`), restated: a drift turns into a failing test here
// instead of a run full of 400s.
const CONTACT_PHONE_PATTERN = /^[+]?[\d\s().-]*\d[\d\s().-]*$/;
const CONTACT_LOCALE_PATTERN = /^[a-z]{2}(?:[-_][A-Za-z]{2,})?$/i;
const TASK_TITLE_MAX = 200;
const PROJECT_NAME_MAX = 80;

describe('per-user determinism', () => {
  test('the same seed generates the same user data, whatever ran between', () => {
    const run = (): string[] => {
      const { random, data } = userData(1234);
      return [
        chatPrompt(data, random).text,
        threadTitle(data, random),
        taskDraft(data, random, 0).title,
        projectDraft(data, random).name,
        contactDraft(data, random, 'x').email ?? '',
        generateDocument(data, random).body.slice(0, 200),
      ];
    };
    const first = run();
    // Another user borrowing the shared Faker in between must not change
    // this user's stream.
    const other = userData(99);
    chatPrompt(other.data, other.random);
    expect(run()).toEqual(first);
  });

  test('two users differ', () => {
    const a = userData(1, 'en');
    const b = userData(2, 'en');
    const left = Array.from({ length: 5 }, () => threadTitle(a.data, a.random));
    const right = Array.from({ length: 5 }, () =>
      threadTitle(b.data, b.random),
    );
    expect(left).not.toEqual(right);
  });

  test('locales are mixed across the population', () => {
    const seen = new Set<DataLocale>();
    for (let seed = 0; seed < 200; seed += 1) {
      seen.add(drawLocale(mulberry32(seed)));
    }
    expect([...seen].sort()).toEqual([...DATA_LOCALES].sort());
  });
});

describe('chat prompts', () => {
  test('cover every kind, stay non-empty and within the paste cap', () => {
    const { random, data } = userData(7, 'en');
    const kinds = new Set<string>();
    for (let i = 0; i < 600; i += 1) {
      const prompt = chatPrompt(data, random);
      kinds.add(prompt.kind);
      expect(prompt.text.trim().length).toBeGreaterThan(0);
      // The intro line of a paste rides on top of the cap.
      expect(prompt.text.length).toBeLessThanOrEqual(MAX_PASTE_CHARS + 200);
    }
    for (const kind of [
      'question',
      'instruction',
      'list',
      'code',
      'paste',
      'emoji',
      'foreign',
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  test('follow-ups quote the previous reply', () => {
    const { random, data } = userData(8, 'en');
    const reply =
      'The churn numbers improved in March. Retention was driven by onboarding calls. Pricing stayed flat.';
    let quoted = 0;
    for (let i = 0; i < 100; i += 1) {
      const prompt = chatPrompt(data, random, reply);
      if (prompt.kind !== 'follow-up') continue;
      if (
        ['churn', 'Retention', 'Pricing'].some((w) => prompt.text.includes(w))
      ) {
        quoted += 1;
      }
    }
    expect(quoted).toBeGreaterThan(10);
  });

  test('quoteFrom cuts at a word boundary and skips fragments', () => {
    const random = mulberry32(1);
    expect(quoteFrom('ok. no.', random)).toBeNull();
    const long = `${'word '.repeat(40)}end.`;
    const quote = quoteFrom(long, random) ?? '';
    expect(quote.length).toBeLessThanOrEqual(80);
    expect(quote.endsWith(' ')).toBe(false);
  });

  test('thread titles fit the create cap', () => {
    const { random, data } = userData(3);
    for (let i = 0; i < 200; i += 1) {
      const title = threadTitle(data, random);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('work items', () => {
  test('task drafts respect the board schema', () => {
    const { random, data } = userData(5);
    const now = 1_800_000_000_000;
    for (let i = 0; i < 300; i += 1) {
      const draft = taskDraft(data, random, now);
      expect(draft.title.trim().length).toBeGreaterThan(0);
      expect(draft.title.length).toBeLessThanOrEqual(TASK_TITLE_MAX);
      expect(['p0', 'p1', 'p2', 'p3']).toContain(draft.priority);
      for (const label of draft.labels) {
        expect<readonly string[]>(PREDEFINED_LABELS).toContain(label);
      }
      if (draft.dueDate !== undefined) {
        expect(draft.dueDate).toBeGreaterThan(now);
      }
    }
  });

  test('project names fit the 80-character cap', () => {
    const { random, data } = userData(6);
    for (let i = 0; i < 200; i += 1) {
      const draft = projectDraft(data, random);
      expect(draft.name.trim().length).toBeGreaterThan(0);
      expect(draft.name.length).toBeLessThanOrEqual(PROJECT_NAME_MAX);
    }
  });

  test('contacts pass the contact field patterns', () => {
    for (const locale of DATA_LOCALES) {
      const { random, data } = userData(10, locale);
      for (let i = 0; i < 100; i += 1) {
        const contact = contactDraft(data, random, `run${i}`);
        expect(contact.source).toBe('manual_import');
        expect(contact.name.length).toBeLessThanOrEqual(300);
        expect(contact.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
        expect(contact.email?.endsWith('.')).toBe(false);
        expect(contact.phone).toMatch(CONTACT_PHONE_PATTERN);
        expect(contact.locale).toMatch(CONTACT_LOCALE_PATTERN);
        expect((contact.tags ?? []).length).toBeLessThanOrEqual(50);
      }
    }
  });

  test('comments, searches and instructions are bounded', () => {
    const { random, data } = userData(12);
    for (let i = 0; i < 100; i += 1) {
      expect(taskComment(data, random).length).toBeLessThanOrEqual(2_000);
      expect(searchTerm(data, random).length).toBeLessThanOrEqual(60);
      expect(customInstructions(data, random).length).toBeLessThanOrEqual(
        20_000,
      );
    }
  });
});

describe('documents', () => {
  test('sizes stay within 1–200 KB and centre on a few KB', () => {
    const random = mulberry32(4);
    const sizes = Array.from({ length: 2_000 }, () => documentSize(random));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(MIN_DOCUMENT_BYTES);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    const sorted = sizes.sort((a, b) => a - b);
    const median = sorted[sorted.length / 2] ?? 0;
    expect(median).toBeGreaterThan(4 * 1_024);
    expect(median).toBeLessThan(16 * 1_024);
  });

  test('every kind has its content type, a file name and its keywords', () => {
    const { random, data } = userData(13, 'en');
    const types = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const doc = generateDocument(data, random);
      types.add(doc.contentType);
      expect(doc.body.length).toBeGreaterThanOrEqual(MIN_DOCUMENT_BYTES);
      expect(doc.body.length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
      expect(doc.fileName).toMatch(/^[A-Za-z0-9-]+\.(txt|md|csv|json)$/);
      if (doc.kind === 'json') expect(() => JSON.parse(doc.body)).not.toThrow();
      expect(doc.keywords.length).toBeGreaterThan(0);
      const mentioned = doc.keywords.filter((word) => doc.body.includes(word));
      expect(mentioned.length).toBeGreaterThan(0);
    }
    expect([...types].sort()).toEqual([
      'application/json',
      'text/csv',
      'text/markdown',
      'text/plain',
    ]);
  });

  test('knowledge queries ask about uploaded keywords when there are some', () => {
    const random = mulberry32(2);
    expect(knowledgeQuery(random, [], 'fallback')).toBe('fallback');
    for (let i = 0; i < 20; i += 1) {
      expect(knowledgeQuery(random, ['Zurich Widgets'], 'x')).toContain(
        'Zurich Widgets',
      );
    }
  });
});

describe('hostile input', () => {
  test('oversized strings hit their length exactly', () => {
    const random = mulberry32(1);
    for (const length of [1, 201, 5_001]) {
      expect(oversized(random, length).length).toBe(length);
    }
  });

  test('hostile strings include markup, SQL, bidi and emoji', () => {
    const all = HOSTILE_STRINGS.join('\n');
    expect(all).toContain('<script>');
    expect(all).toContain('DROP TABLE');
    expect(all).toContain('‮');
    expect(all).toContain('👩');
    const random = mulberry32(3);
    for (let i = 0; i < 50; i += 1) {
      expect(typeof hostileString(random)).toBe('string');
    }
  });

  test('wellFormed makes lone surrogates encodable', () => {
    expect(() => encodeURIComponent('\uD800')).toThrow();
    expect(() => encodeURIComponent(wellFormed('a\uD800b'))).not.toThrow();
  });
});
