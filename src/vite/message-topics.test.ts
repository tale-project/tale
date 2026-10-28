import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseAst, type Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  messageTopics,
  topicsNamedIn,
  topicsToAwait,
  unnamedNamespaceReads,
} from './message-topics';

const TOPICS = new Set(['tasks', 'chat', 'settings', 'common']);

function named(code: string): string[] {
  return [...topicsNamedIn(parseAst(code), TOPICS)].sort();
}

describe('topicsNamedIn', () => {
  it('reads the namespaces the i18n calls bind', () => {
    expect(named(`const { t } = useT('tasks');`)).toEqual(['tasks']);
    expect(named(`const { t } = useTranslation(['chat', 'common']);`)).toEqual([
      'chat',
      'common',
    ]);
    expect(named(`i18n.getFixedT(locale, 'settings')('x');`)).toEqual([
      'settings',
    ]);
    expect(named(`i18n.t('errors.gone', { ns: 'common' });`)).toEqual([
      'common',
    ]);
    expect(named('const label = `tasks:status.${id}`;')).toEqual(['tasks']);
  });

  it('reads the namespaces handed on as values', () => {
    expect(
      named(
        `createTableConfigHook({ entityNamespace: 'tasks', additionalNamespaces: ['common'] });`,
      ),
    ).toEqual(['common', 'tasks']);
    expect(named(`jsx(Panel, { namespace: 'chat' });`)).toEqual(['chat']);
    expect(named(`useT(extra[0] ?? 'common');`)).toEqual(['common']);
    expect(named(`useT(admin ? 'settings' : 'chat');`)).toEqual([
      'chat',
      'settings',
    ]);
  });

  it('ignores comments, other strings and namespaces the catalog lacks', () => {
    expect(
      named(`
        // useT('settings') in a comment
        /** const { t } = useT('tasks') */
        const route = '/settings';
        const kind = 'chat';
        useT('docs');
        const text = 'common: a sentence';
      `),
    ).toEqual([]);
  });
});

describe('unnamedNamespaceReads', () => {
  it('finds the reads whose namespace no literal names', () => {
    const code = [
      `useT('tasks');`,
      `useT(namespace);`,
      `useT(admin ? 'settings' : 'chat');`,
      `i18n.getFixedT(locale, ns)('x');`,
      `i18n.t('x', { ns: 'chat' });`,
      `i18n.t('x', { ns: area });`,
      `useT(extra[0] ?? 'common');`,
    ].join('\n');
    const lines = unnamedNamespaceReads(parseAst(code)).map(
      (offset) => code.slice(0, offset).split('\n').length,
    );

    expect(lines).toEqual([2, 4, 6, 7]);
  });
});

interface Chunk {
  isEntry: boolean;
  imports: string[];
  moduleIds: string[];
}

const topic = (name: string) => `\0message-topic:${name}`;

describe('topicsToAwait', () => {
  const chunks: Record<string, Chunk> = {
    'index.js': {
      isEntry: true,
      imports: ['shell.js'],
      moduleIds: ['/app/main.tsx', topic('common')],
    },
    'shell.js': {
      isEntry: false,
      imports: [],
      moduleIds: ['/app/shell.tsx', topic('chat')],
    },
    'tasks-route.js': {
      isEntry: false,
      imports: ['shared.js', 'shell.js'],
      moduleIds: ['/app/tasks.tsx', topic('tasks'), topic('common')],
    },
    'shared.js': {
      isEntry: false,
      imports: [],
      moduleIds: ['/app/picker.tsx', topic('settings')],
    },
  };

  it('waits for what the chunk and its static imports bring, not the cold load', () => {
    expect(topicsToAwait('tasks-route.js', chunks)).toEqual([
      'settings',
      'tasks',
    ]);
  });

  it('never makes the cold load wait', () => {
    expect(topicsToAwait('shell.js', chunks)).toEqual([]);
    expect(topicsToAwait('index.js', chunks)).toEqual([]);
  });
});

describe('messageTopics', () => {
  let dir: string;
  let plugin: Plugin;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'message-topics-'));
    mkdirSync(join(dir, 'en'));
    writeFileSync(join(dir, 'en', 'tasks.yml'), 'title: Tasks\n');
    writeFileSync(join(dir, 'en', 'chat.yml'), 'send: Send\n');
    plugin = messageTopics({ messagesDir: dir });
    call(plugin.configResolved, { command: 'build' });
    call(plugin.buildStart);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs a hook as Vite would, with the one context method it uses. */
  function call(hook: unknown, ...args: unknown[]): unknown {
    const handler =
      typeof hook === 'function'
        ? hook
        : (hook as { handler?: unknown } | undefined)?.handler;
    if (typeof handler !== 'function') throw new Error('no such hook');
    return handler.apply({ parse: (code: string) => parseAst(code) }, args);
  }

  it('gives a module that names a topic an import of its English', () => {
    const code = `const { t } = useT('tasks');\nexport const x = t('title');`;
    const out = call(plugin.transform, code, '/app/board.tsx') as {
      code: string;
      map: null;
    };

    expect(out.code.startsWith(code)).toBe(true);
    expect(out.code).toContain(`import "virtual:message-topic/tasks";`);
    expect(out.map).toBeNull();
    expect(call(plugin.transform, `export const x = 1;`, '/app/x.ts')).toBe(
      null,
    );
    expect(
      call(plugin.transform, `useT('tasks');`, '/node_modules/x/index.js'),
    ).toBe(null);
  });

  it('registers a topic from the generated module', () => {
    const id = call(plugin.resolveId, 'virtual:message-topic/chat');
    expect(id).toBe('\0message-topic:chat');

    const code = call(plugin.load, id) as string;
    expect(code).toContain(JSON.stringify(join(dir, 'en', 'chat.yml')));
    expect(code).toContain(`registerTopic("chat", messages);`);
    expect(call(plugin.load, '\0message-topic:nope')).toBeNull();
  });

  it('makes an on-demand chunk wait for its topics, and nothing else', () => {
    const chunks = {
      'index.js': { isEntry: true, imports: [], moduleIds: ['/app/main.tsx'] },
      'board.js': {
        isEntry: false,
        isDynamicEntry: true,
        imports: [],
        moduleIds: ['/app/board.tsx', topic('tasks')],
      },
    };
    const render = (name: keyof typeof chunks, format = 'es') =>
      call(
        plugin.renderChunk,
        'export const board = 1;',
        { fileName: name, isDynamicEntry: false, ...chunks[name] },
        { format },
        { chunks },
      );

    expect(render('board.js')).toEqual({
      code: 'export const board = 1;\nawait globalThis.__taleMessageTopics?.ready(["tasks"]);\n',
      map: null,
    });
    expect(render('index.js')).toBeNull();
    expect(render('board.js', 'cjs')).toBeNull();
  });
});
