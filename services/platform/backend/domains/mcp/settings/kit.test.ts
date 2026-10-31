// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mintCursorFor } from '../../../core/lib/signed_cursor.ts';
import type { McpCaller } from '../caller.ts';
import { refusalFromThrown } from '../refusals.ts';
import {
  droppedMembers,
  identifySingle,
  identityOf,
  type KeysetPosition,
  PAGE_CONFIG_CHARS,
  pageOf,
  pageOfKeyset,
  pageOfRead,
  parseSettingsArgs,
  parseSettingsConfig,
  SettingsRefusalError,
} from './kit.ts';
import type { SettingsContext } from './registry.ts';

function refused(run: () => unknown): SettingsRefusalError {
  try {
    run();
  } catch (error) {
    if (error instanceof SettingsRefusalError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('a handler refusal', () => {
  it('reaches the agent as a refusal with its code, sentence, hint and data', () => {
    expect(
      refusalFromThrown(
        new SettingsRefusalError('SETTINGS_TALE_ONLY', 'made in Tale', {
          hint: 'open Settings',
          data: { area: 'branding' },
        }),
      ),
    ).toEqual({
      error: 'made in Tale',
      code: 'SETTINGS_TALE_ONLY',
      hint: 'open Settings',
      data: { area: 'branding' },
    });
  });
});

describe('reading a change through its kind', () => {
  const policy = z.object({
    minLength: z.number().int().min(8),
    rules: z.array(z.object({ name: z.string() })).default([]),
  });

  it('answers what the writer would store, defaults included', () => {
    expect(
      parseSettingsConfig(policy, { minLength: 12 }, 'the policy'),
    ).toEqual({ minLength: 12, rules: [] });
  });

  it('names every problem by where it is, never by what was sent', () => {
    const error = refused(() =>
      parseSettingsConfig(
        policy,
        { minLength: 'sk-not-a-number', rules: [{ name: 4 }] },
        'the policy',
      ),
    );
    expect(error.code).toBe('SETTINGS_INVALID');
    expect(error.data?.issues).toEqual([
      {
        path: '/config/minLength',
        code: 'invalid_type',
        message: expect.any(String),
      },
      {
        path: '/config/rules/0/name',
        code: 'invalid_type',
        message: expect.any(String),
      },
    ]);
    expect(JSON.stringify(error.data)).not.toContain('sk-not-a-number');
    expect(error.message).toMatch(
      /^the policy is not valid: \/config\/minLength /,
    );
  });

  it('refuses a field the setting does not have instead of dropping it', () => {
    const error = refused(() =>
      parseSettingsConfig(
        policy,
        { minLength: 12, minLenght: 14, rules: [{ name: 'a', nmae: 'b' }] },
        'the policy',
      ),
    );
    expect(error.data?.issues).toEqual([
      {
        path: '/config/minLenght',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
      {
        path: '/config/rules/0/nmae',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
  });

  it('reads what an act takes the same way, pointing at its arguments', () => {
    const args = z.object({ types: z.array(z.string().min(3)).min(1) });
    expect(parseSettingsArgs(args, { types: ['a.b'] }, 'the grant')).toEqual({
      types: ['a.b'],
    });
    const error = refused(() =>
      parseSettingsArgs(args, { types: ['x'], extra: 1 }, 'the grant'),
    );
    expect(error.code).toBe('SETTINGS_INVALID');
    expect(error.data?.issues).toEqual([
      {
        path: '/args/types/0',
        code: 'too_small',
        message: expect.any(String),
      },
    ]);
    // A field the act does not take is named, not dropped.
    expect(
      refused(() =>
        parseSettingsArgs(args, { types: ['a.b'], extra: 1 }, 'the grant'),
      ).data?.issues,
    ).toEqual([
      {
        path: '/args/extra',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
    expect(droppedMembers({ a: 1 }, {}, [], '/args')).toEqual([
      {
        path: '/args/a',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
  });

  it('escapes a member name in its pointer', () => {
    expect(droppedMembers({ 'a/b~c': 1 }, {})).toEqual([
      {
        path: '/config/a~1b~0c',
        code: 'unrecognized_key',
        message: 'is not a field of this setting',
      },
    ]);
  });
});

describe('the identity of a resource', () => {
  it('takes no id for a kind with one resource', () => {
    expect(identifySingle('branding')({ kind: 'branding', op: 'set' })).toBe(
      null,
    );
    expect(
      refused(() =>
        identifySingle('branding')({ kind: 'branding', id: 'x', op: 'set' }),
      ).code,
    ).toBe('SETTINGS_ID_INVALID');
  });

  it('takes the id named, the one the config carries, or both when they agree', () => {
    expect(identityOf('provider', 'vendor', undefined, 'its name')).toBe(
      'vendor',
    );
    expect(identityOf('provider', undefined, 'vendor', 'its name')).toBe(
      'vendor',
    );
    expect(identityOf('provider', 'vendor', 'vendor', 'its name')).toBe(
      'vendor',
    );
    expect(
      refused(() => identityOf('provider', 'vendor', 'other', 'its name')).code,
    ).toBe('SETTINGS_ID_INVALID');
    expect(
      refused(() => identityOf('provider', undefined, undefined, 'its name'))
        .code,
    ).toBe('SETTINGS_ID_REQUIRED');
  });
});

describe('pages of a listing', () => {
  const items = Array.from({ length: 5 }, (_, index) => index);

  it('walks a listing page by page with the cursor each page answers', () => {
    const first = pageOf(items, undefined, 2);
    expect(first).toEqual({ items: [0, 1], nextCursor: 'p2' });
    const second = pageOf(items, first.nextCursor ?? undefined, 2);
    expect(second).toEqual({ items: [2, 3], nextCursor: 'p4' });
    expect(pageOf(items, second.nextCursor ?? undefined, 2)).toEqual({
      items: [4],
      nextCursor: null,
    });
  });

  it.each(['', '2', 'p0', 'p-1', 'p01', 'pp2'])(
    'refuses the cursor %j, which no page answered',
    (cursor) => {
      expect(refused(() => pageOf(items, cursor, 2)).code).toBe(
        'INVALID_CURSOR',
      );
    },
  );
});

describe('pages of a listing read one resource at a time', () => {
  const resourceOf = (id: number, chars: number) => ({
    id: String(id),
    hash: `h${id}`,
    config: { text: 'x'.repeat(chars) },
  });
  /** What a page of them holds, as ids, and the cursor it answered. */
  async function walk(
    ids: readonly number[],
    size: number,
    chars: (id: number) => number,
  ) {
    const pages: string[][] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await pageOfRead(ids, cursor, size, async (id) =>
        resourceOf(id, chars(id)),
      );
      pages.push(page.items.map((item) => item.id ?? ''));
      if (page.nextCursor === null) return pages;
      cursor = page.nextCursor;
    }
  }
  const ids = Array.from({ length: 25 }, (_, index) => index);

  it('cuts a page at the number of resources it may hold [MCP-R35]', async () => {
    const pages = await walk(ids, 10, () => 10);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(ids.map(String));
  });

  it('cuts a page once what it read takes the room an answer has, however few that is [MCP-R35]', async () => {
    // Each configuration is about a tenth of the room: ten make a page.
    const tenth = PAGE_CONFIG_CHARS / 10;
    const pages = await walk(ids, 50, () => tenth);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(ids.map(String));
  });

  it('holds at least one resource on a page, even one that takes all the room [MCP-R35]', async () => {
    const pages = await walk([0, 1, 2], 50, () => PAGE_CONFIG_CHARS * 2);
    expect(pages).toEqual([['0'], ['1'], ['2']]);
  });

  it('starts where the cursor says, and refuses one no page answered', async () => {
    const page = await pageOfRead(ids, 'p20', 10, async (id) =>
      resourceOf(id, 1),
    );
    expect(page.items.map((item) => item.id)).toEqual([
      '20',
      '21',
      '22',
      '23',
      '24',
    ]);
    expect(page.nextCursor).toBeNull();
    await expect(
      pageOfRead(ids, 'x20', 10, async (id) => resourceOf(id, 1)),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('reads nothing past the page it answers', async () => {
    const read: number[] = [];
    await pageOfRead(ids, undefined, 3, async (id) => {
      read.push(id);
      return resourceOf(id, 1);
    });
    expect(read).toEqual([0, 1, 2]);
  });
});

describe('pages of a listing its store pages on a keyset', () => {
  function contextIn(organizationId: string): SettingsContext {
    const caller: McpCaller = {
      organizationId,
      orgSlug: 'acme',
      userId: 'user-1',
      role: 'member',
      credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the pager reads no database
    return { sql: {} as unknown as Sql, caller };
  }
  const ctx = contextIn('org-1');
  /** Rows newest first, as the store orders them: row `n` stands at
   * `1000 - n`, so a later row has an older position. */
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `row-${String(index).padStart(2, '0')}`,
    at: 1000 - index,
    chars: 10,
  }));
  type Row = (typeof rows)[number];
  /** The store: up to `limit` rows after `after`, and whether more follow. */
  function store(of: readonly Row[], reads: (KeysetPosition | null)[] = []) {
    return async (after: KeysetPosition | null, limit: number) => {
      reads.push(after);
      const rest = of.filter(
        (row) =>
          after === null ||
          row.at < after.at ||
          (row.at === after.at && row.id < after.id),
      );
      return {
        rows: rest.slice(0, limit),
        hasMore: rest.length > limit,
      };
    };
  }
  const resourceOf = (row: Row) => ({
    id: row.id,
    hash: `h-${row.id}`,
    config: { text: 'x'.repeat(row.chars) },
  });
  const positionOf = (row: Row) => ({ at: row.at, id: row.id });
  async function walk(of: readonly Row[], size: number) {
    const pages: string[][] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await pageOfKeyset(
        ctx,
        'project-instructions',
        cursor,
        size,
        store(of),
        resourceOf,
        positionOf,
      );
      pages.push(page.items.map((item) => item.id ?? ''));
      if (page.nextCursor === null) return pages;
      cursor = page.nextCursor;
    }
  }

  it('walks the listing page by page from the last resource each page holds [MCP-R35]', async () => {
    const pages = await walk(rows, 10);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(rows.map((row) => row.id));
  });

  it('answers no cursor once the store has nothing more', async () => {
    const page = await pageOfKeyset(
      ctx,
      'project-instructions',
      undefined,
      10,
      store(rows.slice(0, 10)),
      resourceOf,
      positionOf,
    );
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
  });

  it('cuts a page once its configurations take the room an answer has, and goes on after the last one it holds [MCP-R35]', async () => {
    const tenth = PAGE_CONFIG_CHARS / 10;
    const heavy = rows.map((row) => ({ ...row, chars: tenth }));
    const pages = await walk(heavy, 50);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 5]);
    expect(pages.flat()).toEqual(rows.map((row) => row.id));
  });

  it('holds at least one resource on a page, even one that takes all the room [MCP-R35]', async () => {
    const huge = rows.slice(0, 3).map(({ id, at }) => ({
      id,
      at,
      chars: PAGE_CONFIG_CHARS * 2,
    }));
    expect(await walk(huge, 50)).toEqual([['row-00'], ['row-01'], ['row-02']]);
  });

  it('asks the store for one page after the position the cursor signs', async () => {
    const reads: (KeysetPosition | null)[] = [];
    const first = await pageOfKeyset(
      ctx,
      'project-instructions',
      undefined,
      3,
      store(rows, reads),
      resourceOf,
      positionOf,
    );
    await pageOfKeyset(
      ctx,
      'project-instructions',
      first.nextCursor ?? undefined,
      3,
      store(rows, reads),
      resourceOf,
      positionOf,
    );
    expect(reads).toEqual([null, { at: 998, id: 'row-02' }]);
  });

  it.each([
    ['an offset cursor of the listing before it', 'p50'],
    ['an unsigned position', '998:row-02'],
    ['a made-up signature', '998:row-02.AAAAAAAAAAAAAAAAAAAAAA'],
    [
      "another kind's cursor",
      mintCursorFor('org-1', 'mcp-settings:agent-tools', '998:row-02'),
    ],
    [
      "another organization's cursor",
      mintCursorFor('org-2', 'mcp-settings:project-instructions', '998:row-02'),
    ],
    [
      'a signed token that is no position',
      mintCursorFor('org-1', 'mcp-settings:project-instructions', 'p50'),
    ],
  ])('refuses %s, and reads nothing', async (_, cursor) => {
    const reads: (KeysetPosition | null)[] = [];
    await expect(
      pageOfKeyset(
        ctx,
        'project-instructions',
        cursor,
        10,
        store(rows, reads),
        resourceOf,
        positionOf,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(reads).toEqual([]);
  });
});
