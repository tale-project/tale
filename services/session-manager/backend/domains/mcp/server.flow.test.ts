// AI access, used the way an assistant uses it: through a real HTTP server
// (the app with its security checks, and `/mcp` mounted), the real manager and
// the fake browser. Port of the old app's `tests/test_mcp.py`; the client is a
// small JSON-RPC client over `fetch` (`testing/mcp-client.ts`).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApp } from '../../app.ts';
import { eventually } from '../../testing/eventually.ts';
import type { FakeRemote } from '../../testing/fake-browser.ts';
import {
  addProxy,
  createTestManager,
  waitForChecks,
} from '../../testing/harness.ts';
import type { TestManager } from '../../testing/harness.ts';
import {
  McpClient,
  rpcReplySchema,
  textOf,
  unframed,
} from '../../testing/mcp-client.ts';
import { KIND_KEYS } from '../secrets/vault.ts';
import { createMcpEndpoint } from './server.ts';
import { MCP_TOOL_NAMES } from './tools.ts';

let harness: TestManager;
let server: ReturnType<typeof Bun.serve>;
let ai: McpClient;
let origin: string;

beforeEach(() => {
  harness = createTestManager();
  harness.manager.updateSettings({ mcpEnabled: true });
  const allowedHosts = new Set<string>();
  const mcp = createMcpEndpoint({
    manager: harness.manager,
    serverInfo: { name: 'session-manager', version: 'test' },
    waitScale: 0.01, // the polling and the page's time to react are for people
  });
  const app = createApp({
    manager: harness.manager,
    config: { allowedHosts },
    mcp,
  });
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => app.fetch(request),
  });
  origin = `http://127.0.0.1:${server.port}`;
  allowedHosts.add(`127.0.0.1:${server.port}`);
  ai = new McpClient(`${origin}/mcp`);
});

afterEach(async () => {
  await server.stop(true);
  await harness.close();
});

const sessionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    status: z.string(),
    ip: z.string().nullable(),
    country: z.string().nullable(),
    tabs: z.number().optional(),
    location: z.record(z.string(), z.unknown()).nullable(),
  })
  .loose();
const sessionsSchema = z.array(sessionSchema);

const secretsSchema = z.array(
  z.object({
    id: z.number(),
    kind: z.string(),
    title: z.string(),
    scope: z.string(),
    preview: z.string(),
  }),
);

/** Adds a proxy for the first session (unless there are some), then creates it with the tool. */
async function startSession(
  proxy: string | null = '192.0.2.1:8080',
): Promise<FakeRemote> {
  if (proxy !== null) addProxy(harness.manager, proxy);
  const session = await ai.parsed(sessionSchema, 'create_session');
  expect([session.name, session.status, session.tabs]).toEqual([
    '0001',
    'running',
    1,
  ]);
  return harness.backend.latest().remote;
}

async function nameOf(tool: string, args: Record<string, unknown> = {}) {
  const sessions = await ai.parsed(sessionsSchema, tool, args);
  return sessions.map((session) => session.name);
}

describe('the door', () => {
  it('is shut until the user turns AI access on, and shut again when it is turned off', async () => {
    harness.manager.updateSettings({ mcpEnabled: false });
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const refused = await ai.post(ping);
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({
      error: 'ai_access_off',
      message: 'AI access is off. Turn it on in Settings.',
    });

    harness.manager.updateSettings({ mcpEnabled: true });
    await ai.initialize();
    expect(await ai.value('get_settings')).toMatchObject({
      start_page: 'https://www.google.com',
    });

    harness.manager.updateSettings({ mcpEnabled: false }); // switched off while connected
    expect((await ai.post({ ...ping, id: 2 })).status).toBe(403);
  });

  it('stops a batch that is under way when AI access is switched off: the wait ends and nothing after it runs', async () => {
    await startSession();
    // The endpoint looks at the switch when the request comes and before each
    // message: two looks mean the first message, a wait of 30 seconds, is running.
    const looks = vi.spyOn(harness.manager, 'settings');
    const call = (id: number, name: string, args: unknown) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const pending = ai.post([
      call(1, 'wait', { seconds: 30 }),
      call(2, 'rename_session', { session: '0001', name: 'renamed' }),
      call(3, 'export_proxies', {}),
    ]);
    await eventually(() => looks.mock.calls.length >= 2);

    harness.manager.updateSettings({ mcpEnabled: false }); // the person

    // A request that comes now is refused...
    expect(
      (await ai.post({ jsonrpc: '2.0', id: 9, method: 'ping' })).status,
    ).toBe(403);
    // ...and the batch ends at once instead of after 30 seconds, with the error of the switch for each message.
    const answer = await pending;
    expect(answer.status).toBe(200);
    const replies = z.array(rpcReplySchema).parse(answer.body);
    expect(replies.map((reply) => reply.error?.code)).toEqual([
      -32001, -32001, -32001,
    ]);
    expect(replies[0]?.error?.data).toEqual({ error: 'ai_access_off' });
    expect(
      harness.manager.listSessions().map((session) => session.name),
    ).toEqual(['0001']);
  });

  it('is shut to other websites', async () => {
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const attacks: Record<string, string>[] = [
      { Origin: 'http://evil.example' }, // a page in the user's browser
      { Host: 'evil.example:80' }, // DNS rebinding
      { 'Content-Type': 'text/plain' }, // a form post, which needs no preflight
    ];
    for (const headers of attacks) {
      const response = await fetch(`${origin}/mcp`, {
        method: 'POST',
        body: ping,
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/^forbidden_/),
      });
    }
  });

  it('takes POST only', async () => {
    const response = await fetch(`${origin}/mcp`);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('answers a client that opens the way clients do', async () => {
    const opened = await ai.initialize('2025-11-25');
    expect(opened.protocolVersion).toBe('2025-11-25');
    expect(opened.serverInfo).toMatchObject({
      name: 'session-manager',
      version: 'test',
    });
    expect(opened.capabilities).toEqual({ tools: { listChanged: false } });
    const tools = await ai.tools();
    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES]);
  });

  it('answers a batch with an array', async () => {
    const { status, body } = await ai.post([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_settings' },
      },
    ]);
    expect(status).toBe(200);
    expect(
      z
        .array(z.object({ id: z.number() }).loose())
        .parse(body)
        .map((r) => r.id),
    ).toEqual([1, 2]);
  });
});

describe('the tools', () => {
  it('are all listed, with a description, the hints and the kinds of secrets of the vault', async () => {
    const tools = await ai.tools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(new Set(byName.keys())).toEqual(new Set(MCP_TOOL_NAMES));
    expect(tools.every((tool) => tool.description.length > 0)).toBe(true);
    expect(byName.get('list_sessions')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('delete_secret')?.annotations?.destructiveHint).toBe(
      true,
    );
    const properties = z
      .object({ kind: z.object({ enum: z.array(z.string()) }) })
      .parse(byName.get('create_secret')?.inputSchema.properties);
    expect(properties.kind.enum).toEqual([...KIND_KEYS]);
  });
});

describe('sessions', () => {
  it('are created, listed, renamed, stopped, started, rotated and deleted', async () => {
    expect(await ai.value('list_sessions')).toEqual([]);
    expect((await ai.failure('create_session')).toLowerCase()).toContain(
      'no free proxy',
    );
    await startSession();

    const [session] = await ai.parsed(sessionsSchema, 'list_sessions');
    expect([
      session?.name,
      session?.status,
      session?.ip,
      session?.country,
    ]).toEqual(['0001', 'running', '203.0.113.1', 'US']);
    expect(session?.location).toEqual({
      ip: '203.0.113.1',
      country: 'US',
      latitude: 40.71,
      longitude: -74,
      matches_ip: true,
    });

    const detail = await ai.value('get_session', { session: '0001' });
    expect(detail).toMatchObject({
      fingerprint: { user_agent: 'FakeAgent/1' },
    });
    expect(detail).toHaveProperty('created_at');
    expect(await nameOf('list_sessions', { status: 'running' })).toEqual([
      '0001',
    ]);
    expect(await nameOf('list_sessions', { status: 'stopped' })).toEqual([]);

    expect(
      await ai.value('rename_session', { session: '0001', name: 'shop' }),
    ).toMatchObject({
      name: 'shop',
    });
    expect(await ai.value('stop_session', { session: 'shop' })).toMatchObject({
      status: 'stopped',
    });
    expect(await ai.value('start_session', { session: 1 })).toMatchObject({
      status: 'running',
      tabs: 1,
    }); // by id

    const unknown = await ai.failure('start_session', { session: 'nope' });
    expect(unknown).toContain('There is no session “nope”');
    expect(unknown).toContain('shop');

    addProxy(harness.manager, '192.0.2.2:8080');
    expect(
      await ai.value('rotate_session_ip', { session: 'shop' }),
    ).toMatchObject({
      ip: '203.0.113.2',
    });
    expect(await ai.text('delete_session', { session: 'shop' })).toContain(
      'Deleted',
    );
    expect(await ai.value('list_sessions')).toEqual([]);
  });

  it('are found again when the proxy no longer exits where the session says it is, and restarted', async () => {
    await startSession();
    const first = await ai.value('check_session_ip', { session: '0001' });
    expect(first).toMatchObject({ location: { matches_ip: true } });

    harness.checker.setIp('192.0.2.1:8080', '203.0.113.50'); // the proxy now exits elsewhere
    const checked = await ai.value('check_session_ip', { session: '0001' });
    expect(checked).toMatchObject({
      ip: '203.0.113.50',
      location: { ip: '203.0.113.1', matches_ip: false },
    });

    const restarted = await ai.value('restart_session', { session: '0001' });
    expect(restarted).toMatchObject({
      status: 'running',
      location: { ip: '203.0.113.50', matches_ip: true },
    });
    expect(harness.backend.launches).toHaveLength(2);
    expect(harness.backend.launches[0]?.closed).toBe(true);

    await ai.call('stop_session', { session: '0001' });
    expect(await ai.failure('restart_session', { session: '0001' })).toContain(
      'not running',
    );
  });
});

describe('browsing', () => {
  it('works in the session the way a person does: tabs, pages, mouse and keyboard', async () => {
    const remote = await startSession();

    const opened = await ai.framedValue('open_tab', {
      session: '0001',
      url: 'example.org',
    });
    expect(opened).toMatchObject({ url: 'https://example.org', active: true });
    const tabs = z.array(
      z.object({ id: z.number(), active: z.boolean() }).loose(),
    );
    expect(
      (await ai.framedParsed(tabs, 'list_tabs', { session: '0001' })).map(
        (t) => t.id,
      ),
    ).toEqual([1, 2]);
    expect(
      unframed(
        await ai.text('navigate', {
          session: '0001',
          url: 'https://example.com/a',
        }),
      ),
    ).toContain('URL: https://example.com/a');
    expect(remote.events).toContainEqual([
      'goto',
      'https://example.com/a',
      null,
      'domcontentloaded',
    ]);
    expect(
      await ai.failure('navigate', {
        session: '0001',
        url: 'javascript:alert(1)',
      }),
    ).toContain('not a web address');
    expect(
      (
        await ai.framedParsed(tabs, 'switch_tab', { session: '0001', tab: 1 })
      ).map((t) => t.active),
    ).toEqual([true, false]);
    expect(
      (
        await ai.failure('switch_tab', { session: '0001', tab: 9 })
      ).toLowerCase(),
    ).toContain('no such tab');

    const page = unframed(await ai.text('read_page', { session: '0001' }));
    expect(page.startsWith('URL: ')).toBe(true);
    expect(page).toContain('[1] textbox “Email” at (120, 80)');
    expect(page).toContain('Fake page text');

    await ai.text('click', { session: '0001', element: 2 });
    await ai.text('click', { session: '0001', x: 30, y: 40 });
    await ai.text('click', { session: '0001', x: 31, y: 41, button: 'right' });
    await ai.text('click', { session: '0001', x: 32, y: 42, double: true });
    expect(await ai.failure('click', { session: '0001', x: 30 })).toContain(
      'element number, or both x and y',
    );
    expect(
      await ai.failure('click', { session: '0001', element: 2, double: true }),
    ).toContain('need a position');
    await ai.text('hover', { session: '0001', x: 50, y: 60 });
    await ai.text('drag', {
      session: '0001',
      from_x: 1,
      from_y: 2,
      to_x: 300,
      to_y: 4,
    });
    await ai.text('type_text', {
      session: '0001',
      text: 'me@example.com',
      element: 1,
      submit: true,
    });
    await ai.text('type_text', {
      session: '0001',
      text: 'focused',
      submit: true,
    });
    await ai.text('press_key', { session: '0001', key: 'Control+a' });
    await ai.text('press_key', {
      session: '0001',
      key: 'Shift',
      action: 'down',
    });
    const scrolled = await ai.text('scroll', {
      session: '0001',
      direction: 'up',
      pixels: 100,
    });
    await ai.text('scroll', {
      session: '0001',
      direction: 'right',
      pixels: 70,
      x: 10,
      y: 20,
    });
    expect(unframed(scrolled)).toBe('0-600 of 600');
    expect(remote.events.filter((event) => event[0] !== 'goto')).toEqual([
      ['clickElement', 2],
      ['clickAt', 30, 40, 'left', 1],
      ['clickAt', 31, 41, 'right', 1],
      ['clickAt', 32, 42, 'left', 2],
      ['hover', 50, 60],
      ['drag', 1, 2, 300, 4],
      ['fillElement', 1, 'me@example.com', true],
      ['text', 'focused'],
      ['key', 'press', 'Enter'],
      ['key', 'press', 'Control+a'],
      ['key', 'down', 'Shift'],
      ['scroll', 0, -100],
      ['scroll', 70, 0, 10, 20],
    ]);
    // Dialogs wait for the assistant.
    expect(remote.attended.length).toBeGreaterThan(0);
    expect(remote.attended.every((ms) => ms > 60_000)).toBe(true);

    remote.selection = 'chosen words';
    expect(
      unframed(await ai.text('get_selected_text', { session: '0001' })),
    ).toBe('chosen words');

    const shot = await ai.call('screenshot', { session: '0001' });
    expect(shot.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/jpeg',
    });
    const [image] = shot.content;
    expect(
      image?.type === 'image'
        ? Buffer.from(image.data, 'base64').toString()
        : '',
    ).toBe('jpeg-screenshot');

    expect(
      await ai.framedParsed(tabs, 'close_tab', { session: '0001', tab: 2 }),
    ).toHaveLength(1);
    await ai.call('stop_session', { session: '0001' });
    expect(await ai.failure('list_tabs', { session: '0001' })).toContain(
      'not running',
    );
  });

  it('reports a dialog that a click opened at once, and has it answered', async () => {
    const remote = await startSession();
    remote.dialogOnClick = ['confirm', 'Delete everything?'];
    // The click itself waits for the answer, the tool does not.
    const clicked = await ai.text('click', { session: '0001', element: 2 });
    expect(unframed(clicked)).toBe('A confirm dialog: “Delete everything?”');
    expect(clicked).toContain('handle_dialog');

    const page = await ai.text('read_page', { session: '0001' });
    expect(page).toContain('blocked');
    expect(unframed(page)).toContain('Delete everything?');
    expect(await ai.failure('screenshot', { session: '0001' })).toContain(
      'dialog',
    );

    expect(
      await ai.text('handle_dialog', { session: '0001', accept: false }),
    ).toContain('Dismissed the confirm dialog');
    expect(remote.events).toContainEqual(['answer', 1, false, null]);
    expect(unframed(await ai.text('read_page', { session: '0001' }))).toContain(
      'URL: ',
    ); // the page responds again
    expect(await ai.failure('handle_dialog', { session: '0001' })).toContain(
      'No dialog is open',
    );

    remote.dialogOnClick = ['prompt', 'Your name?'];
    await ai.text('click', { session: '0001', x: 1, y: 2 });
    await ai.text('handle_dialog', { session: '0001', text: 'Ada' });
    expect(remote.events).toContainEqual(['answer', 2, true, 'Ada']);
  });

  it('can wait, at most 30 seconds, for as long as it is told', async () => {
    const started = Date.now();
    expect(await ai.text('wait', { seconds: 0.05 })).toBe('Done waiting.');
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });
});

describe('secrets', () => {
  it('are stored, listed without their masked values, read, changed and deleted', async () => {
    await startSession();
    const created = z.object({ id: z.number(), preview: z.string() });
    const login = await ai.parsed(created, 'create_secret', {
      kind: 'credentials',
      title: 'Shop',
      fields: [
        { label: 'Username', value: 'me' },
        { label: 'Password', value: 'hunter2' },
      ],
    });
    expect(login.preview).toBe('me');
    const mine = await ai.parsed(created, 'create_secret', {
      kind: 'personal',
      title: 'Me',
      session: '0001',
      fields: [
        { label: 'Email', value: 'a@example.com' },
        { label: 'Email', value: 'b@example.com' },
      ],
    });

    const listed = await ai.parsed(secretsSchema, 'list_secrets');
    expect(listed.map((s) => [s.title, s.scope])).toEqual([
      ['Me', '0001'],
      ['Shop', 'all sessions'],
    ]);
    expect(JSON.stringify(listed)).not.toContain('hunter2'); // lists never show masked values
    expect(
      (
        await ai.parsed(secretsSchema, 'list_secrets', { kind: 'credentials' })
      ).map((s) => s.title),
    ).toEqual(['Shop']);
    expect(
      (
        await ai.parsed(secretsSchema, 'list_secrets', {
          session: '0001',
          include_global: false,
        })
      ).map((s) => s.title),
    ).toEqual(['Me']);

    expect(await ai.value('get_secret', { secret_id: login.id })).toMatchObject(
      {
        fields: [
          { label: 'Username', value: 'me' },
          { label: 'Password', value: 'hunter2' },
        ],
      },
    );
    const twoEmails = z.object({
      fields: z.array(z.object({ value: z.string() })),
    });
    expect(
      (
        await ai.parsed(twoEmails, 'get_secret', { secret_id: mine.id })
      ).fields.map((f) => f.value),
    ).toEqual(['a@example.com', 'b@example.com']); // the same label twice is fine

    await ai.call('update_secret', {
      secret_id: login.id,
      title: 'Shop login',
      session: '0001',
    });
    await ai.call('update_secret', {
      secret_id: mine.id,
      for_every_session: true,
    });
    expect(
      (await ai.parsed(secretsSchema, 'list_secrets')).map((s) => [
        s.title,
        s.scope,
      ]),
    ).toEqual([
      ['Me', 'all sessions'],
      ['Shop login', '0001'],
    ]);
    expect(await ai.text('delete_secret', { secret_id: login.id })).toContain(
      'Deleted',
    );
    expect(await ai.failure('get_secret', { secret_id: login.id })).toContain(
      'does not exist',
    );
    expect(
      await ai.failure('create_secret', {
        kind: 'note',
        title: 'Empty',
        fields: [],
      }),
    ).toContain('at least one value');

    // The web page sees what the assistant stored.
    const seen = await fetch(`${origin}/api/secrets`);
    expect(
      z
        .array(z.object({ title: z.string() }))
        .parse(await seen.json())
        .map((s) => s.title),
    ).toEqual(['Me']);
  });

  it('can be typed into a page without being shown', async () => {
    const remote = await startSession();
    const created = z.object({ id: z.number() });
    const login = await ai.parsed(created, 'create_secret', {
      kind: 'credentials',
      title: 'Shop',
      fields: [
        { label: 'Username', value: 'me' },
        { label: 'Password', value: 'hunter2' },
      ],
    });
    const emails = await ai.parsed(created, 'create_secret', {
      kind: 'personal',
      title: 'Me',
      session: '0001',
      fields: [
        { label: 'Email', value: 'a@example.com' },
        { label: 'Email', value: 'b@example.com' },
      ],
    });

    const typed = await ai.text('type_secret', {
      session: '0001',
      secret_id: login.id,
      field: 'password',
      element: 1,
    });
    expect(typed).not.toContain('hunter2');
    expect(typed).toContain('Password');
    expect(typed).toContain('Shop');
    await ai.text('type_secret', {
      session: '0001',
      secret_id: login.id,
      field: 'Username',
      submit: true,
    });
    await ai.text('type_secret', {
      session: '0001',
      secret_id: emails.id,
      field: 'Email',
      occurrence: 2,
      element: 1,
    });
    expect(
      remote.events.filter((event) =>
        ['fillElement', 'text', 'key'].includes(event[0]),
      ),
    ).toEqual([
      ['fillElement', 1, 'hunter2', false],
      ['text', 'me'],
      ['key', 'press', 'Enter'],
      ['fillElement', 1, 'b@example.com', false],
    ]);

    const missing = await ai.failure('type_secret', {
      session: '0001',
      secret_id: login.id,
      field: 'PIN',
    });
    expect(missing).toContain('Username, Password');
    expect(missing).not.toContain('hunter2');
    expect(
      await ai.failure('type_secret', {
        session: '0001',
        secret_id: emails.id,
        field: 'Email',
        occurrence: 3,
      }),
    ).toContain('2 value(s) named Email');

    addProxy(harness.manager, '192.0.2.2:8080');
    await ai.call('create_session', { name: 'other' });
    expect(
      await ai.failure('type_secret', {
        session: 'other',
        secret_id: emails.id,
        field: 'Email',
      }),
    ).toContain('belongs to session 0001');
    // A secret for every session can be typed in any.
    await ai.text('type_secret', {
      session: 'other',
      secret_id: login.id,
      field: 'Password',
    });
  });
});

describe('proxies and settings', () => {
  it('are managed with the tools, and the web page agrees', async () => {
    const added = z.object({
      summary: z.string(),
      added: z.array(z.object({ proxy: z.string() })),
      errors: z.array(z.object({ line: z.number() })),
    });
    const result = await ai.parsed(added, 'add_proxies', {
      text: '192.0.2.1:8080:user:secret-password\n192.0.2.1:8080:user:secret-password\nnot a proxy',
    });
    expect(result.summary).toBe('Added 1, 1 duplicate, 1 error');
    expect(result.added.map((p) => p.proxy)).toEqual([
      'http://user@192.0.2.1:8080',
    ]);
    expect(result.errors[0]?.line).toBe(3);
    expect(JSON.stringify(result)).not.toContain('secret-password');

    const listing = z.object({
      total: z.number(),
      proxies: z.array(z.object({ id: z.number(), proxy: z.string() })),
    });
    const pool = await ai.parsed(listing, 'list_proxies');
    expect(pool.total).toBe(1);
    expect(pool.proxies[0]?.proxy).toBe('http://user@192.0.2.1:8080');
    expect(JSON.stringify(pool)).not.toContain('secret-password');

    expect(await ai.text('check_proxies')).toContain('Checking 1 proxies');
    await waitForChecks(harness.manager);
    const id = pool.proxies[0]?.id;
    expect(await ai.value('check_proxy', { proxy_id: id })).toMatchObject({
      health: 'ok',
      exit_ip: '203.0.113.1',
      country: 'US',
    });
    expect(await ai.text('delete_proxy', { proxy_id: id })).toContain(
      'Deleted proxy',
    );

    expect(await ai.value('get_settings')).toEqual({
      start_page: 'https://www.google.com',
      default_start_page: 'https://www.google.com',
    });
    expect(
      await ai.value('set_start_page', { url: 'duckduckgo.com' }),
    ).toMatchObject({
      start_page: 'https://duckduckgo.com',
    });
    const web = await fetch(`${origin}/api/settings`);
    expect(await web.json()).toMatchObject({
      startPage: 'https://duckduckgo.com',
    });
    expect(
      await ai.failure('set_start_page', { url: 'nonsense words' }),
    ).toContain('start page');
  });

  it('can switch nothing about AI access: the settings tools do not know it', async () => {
    const result = await ai.call('set_start_page', {
      url: 'x.example',
      mcpEnabled: false,
    });
    expect(result.isError).toBe(true);
    expect(harness.manager.settings().mcpEnabled).toBe(true);
  });

  it('are sorted out and exported', async () => {
    expect(await ai.failure('export_proxies')).toContain('nothing to export');
    await ai.call('add_proxies', {
      text: '192.0.2.1:8080\n192.0.2.2:8080:me:pw\n192.0.2.3:8080\n192.0.2.4:8080',
    });
    harness.checker.setError('192.0.2.3:8080', 'connection refused');
    await ai.call('check_proxy', { proxy_id: 3 });
    await startSession(null); // takes the first free one

    const proxies = async (only: string, more: Record<string, unknown> = {}) =>
      (
        await ai.parsed(
          z.object({ proxies: z.array(z.object({ proxy: z.string() })) }),
          'list_proxies',
          {
            only,
            ...more,
          },
        )
      ).proxies.map((p) => p.proxy);
    expect(await proxies('in_use')).toEqual(['http://192.0.2.1:8080']);
    expect(await proxies('failed')).toEqual(['http://192.0.2.3:8080']);
    expect(await proxies('free')).toEqual([
      'http://192.0.2.4:8080',
      'http://me@192.0.2.2:8080',
    ]); // newest first
    const limited = z.object({
      total: z.number(),
      matching: z.number(),
      proxies: z.array(z.unknown()),
    });
    const one = await ai.parsed(limited, 'list_proxies', { limit: 1 });
    expect([one.total, one.matching, one.proxies.length]).toEqual([4, 4, 1]);

    const exported = z.object({
      proxies: z.array(z.object({ name: z.string(), host: z.string() })),
    });
    const file = await ai.parsed(exported, 'export_proxies');
    expect(file.proxies.map((p) => p.name)).toEqual(['0001']);
    expect(file.proxies[0]?.host).toBe('192.0.2.1');

    await ai.call('stop_session', { session: '0001' });
    expect(await ai.failure('delete_proxy', { proxy_id: 1 })).toContain(
      'uses proxy',
    ); // a session has it: not without force
    expect(
      await ai.text('delete_proxy', { proxy_id: 1, force: true }),
    ).toContain('Deleted');
  });

  it('are summed up by the overview', async () => {
    const overview = z.object({
      sessions: z.array(z.object({ name: z.string(), status: z.string() })),
      next_session_name: z.string(),
      proxies: z.object({ total: z.number(), free: z.number() }),
      secrets: z.number(),
      browser: z.object({ installed: z.boolean() }),
    });
    const empty = await ai.parsed(overview, 'overview');
    expect(empty.sessions).toEqual([]);
    expect(empty.next_session_name).toBe('0001');
    expect(empty.proxies.total).toBe(0);
    expect(empty.browser.installed).toBe(true);

    await startSession();
    await ai.call('add_proxies', { text: '192.0.2.2:8080' });
    await ai.call('create_secret', {
      kind: 'note',
      title: 'x',
      fields: [{ label: 'Note', value: 'y' }],
    });
    const status = await ai.parsed(overview, 'overview');
    expect(status.sessions).toEqual([{ name: '0001', status: 'running' }]);
    expect([status.proxies.total, status.proxies.free, status.secrets]).toEqual(
      [2, 1, 1],
    );
  });
});

describe('what goes wrong', () => {
  it('is told in a sentence, not as a protocol error', async () => {
    const result = await ai.call('start_session', { session: 99 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('There is no session “99”');
  });
});
