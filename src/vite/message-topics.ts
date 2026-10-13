import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { Plugin } from 'vite';

/**
 * Ships a service's messages with the code that reads them.
 *
 * The service keeps its catalog one file per topic and locale
 * (`messages/<locale>/<topic>.yml`, a topic being one top-level namespace)
 * and hands its other locales to `initServiceI18n` as `topics`. Every module
 * that names a topic — `useT('tasks')`, `useTranslation('tasks')`,
 * `getFixedT(lng, 'tasks')`, an `ns` or `…Namespace(s)` property set to
 * `'tasks'`, a `'tasks:key'` literal — gets an import of a generated module
 * that registers the English `tasks.yml` (`registerTopic` in
 * `@tale/ui/i18n/topics`). The bundler then puts English beside its readers:
 * the cold load carries the topics its pages read, and a chunk loaded later
 * carries its own.
 *
 * A chunk the app loads on demand ends by waiting for the topics it and its
 * static imports bring, in the language the session shows
 * (`__taleMessageTopics.ready`), so its components render with their words
 * in. The service waits for the topics of the cold load before its first
 * frame (`loadLocale`).
 */
export interface MessageTopicsOptions {
  /** The catalog directory: `<messagesDir>/<locale>/<topic>.yml`. */
  readonly messagesDir: string;
  /** The locale that ships with the code; every key falls back to it. */
  readonly baseLocale?: string;
}

const VIRTUAL = 'virtual:message-topic/';
const RESOLVED = '\0message-topic:';
const SCRIPT = /\.[cm]?[jt]sx?$/;
/** A literal that names a namespace's key: `tasks:status.open`. */
const NAMESPACED_KEY = /^([A-Za-z0-9_]+):[A-Za-z]/;
/** Properties whose value names a namespace: `ns`, `namespace`, `entityNamespace`, `additionalNamespaces`. */
const NAMESPACE_PROPERTY = /^ns$|[Nn]amespaces?$/;

interface Node {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNode(value: unknown): value is Node {
  return isRecord(value) && typeof value.type === 'string';
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A template part's text, escapes applied. */
function cookedOf(element: unknown): string | undefined {
  return isNode(element) && isRecord(element.value)
    ? stringOf(element.value.cooked)
    : undefined;
}

/** The strings an expression can evaluate to, as far as literals show them. */
function literalStrings(node: unknown): string[] {
  if (!isNode(node)) return [];
  switch (node.type) {
    case 'Literal': {
      const value = stringOf(node.value);
      return value === undefined ? [] : [value];
    }
    case 'TemplateLiteral': {
      const quasis = listOf(node.quasis);
      const cooked = quasis.length === 1 ? cookedOf(quasis[0]) : undefined;
      return cooked === undefined ? [] : [cooked];
    }
    case 'ArrayExpression':
      return listOf(node.elements).flatMap(literalStrings);
    case 'ConditionalExpression':
      return [
        ...literalStrings(node.consequent),
        ...literalStrings(node.alternate),
      ];
    case 'LogicalExpression':
      return [...literalStrings(node.left), ...literalStrings(node.right)];
    default:
      return [];
  }
}

/** Whether every value an expression can take is a literal string. */
function isNamed(node: unknown): boolean {
  if (!isNode(node)) return false;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string';
    case 'TemplateLiteral':
      return listOf(node.quasis).length === 1;
    case 'ArrayExpression':
      return listOf(node.elements).every(isNamed);
    case 'ConditionalExpression':
      return isNamed(node.consequent) && isNamed(node.alternate);
    case 'LogicalExpression':
      return isNamed(node.left) && isNamed(node.right);
    default:
      return false;
  }
}

function nameOf(node: unknown): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Identifier') return stringOf(node.name);
  if (node.type === 'Literal') return stringOf(node.value);
  return undefined;
}

function calleeName(callee: unknown): string | undefined {
  if (!isNode(callee)) return undefined;
  if (callee.type === 'Identifier') return stringOf(callee.name);
  if (callee.type === 'MemberExpression' && callee.computed !== true) {
    return nameOf(callee.property);
  }
  return undefined;
}

/** The topics a module's code names. */
export function topicsNamedIn(
  program: unknown,
  topics: ReadonlySet<string>,
): Set<string> {
  const named = new Set<string>();
  const add = (values: readonly string[]) => {
    for (const value of values) if (topics.has(value)) named.add(value);
  };
  const keyOf = (value: string | undefined) => {
    const match = value === undefined ? null : NAMESPACED_KEY.exec(value);
    if (match?.[1] !== undefined) add([match[1]]);
  };
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...listOf(node));
      continue;
    }
    if (!isNode(node)) continue;
    switch (node.type) {
      case 'CallExpression': {
        const callee = calleeName(node.callee);
        const args = listOf(node.arguments);
        if (callee === 'useT' || callee === 'useTranslation') {
          add(literalStrings(args[0]));
        } else if (callee === 'getFixedT') {
          add(literalStrings(args[1]));
        }
        break;
      }
      case 'Property': {
        const key = nameOf(node.key);
        if (key !== undefined && NAMESPACE_PROPERTY.test(key)) {
          add(literalStrings(node.value));
        }
        break;
      }
      case 'Literal':
        keyOf(stringOf(node.value));
        break;
      case 'TemplateElement':
        keyOf(cookedOf(node));
        break;
      default:
        break;
    }
    for (const [field, child] of Object.entries(node)) {
      if (field !== 'type' && typeof child === 'object' && child !== null) {
        stack.push(child);
      }
    }
  }
  return named;
}

/**
 * Where a module reads a namespace the plugin cannot see — `useT(namespace)`,
 * `{ ns: namespace }` — as offsets into its code. The topic must then be named
 * where the value comes from (`entityNamespace: 'tasks'`), or its English
 * never ships.
 */
export function unnamedNamespaceReads(program: unknown): number[] {
  const offsets: number[] = [];
  const stack: unknown[] = [program];
  const check = (node: Node, value: unknown) => {
    if (value !== undefined && !isNamed(value)) {
      offsets.push(typeof node.start === 'number' ? node.start : -1);
    }
  };
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...listOf(node));
      continue;
    }
    if (!isNode(node)) continue;
    if (node.type === 'CallExpression') {
      const callee = calleeName(node.callee);
      const args = listOf(node.arguments);
      if (callee === 'useT' || callee === 'useTranslation')
        check(node, args[0]);
      else if (callee === 'getFixedT') check(node, args[1]);
    } else if (node.type === 'Property' && nameOf(node.key) === 'ns') {
      check(node, node.value);
    }
    for (const [field, child] of Object.entries(node)) {
      if (field !== 'type' && typeof child === 'object' && child !== null) {
        stack.push(child);
      }
    }
  }
  return offsets.sort((a, b) => a - b);
}

function readTopics(dir: string): Set<string> {
  return new Set(
    readdirSync(dir)
      .filter((file) => file.endsWith('.yml'))
      .map((file) => file.slice(0, -'.yml'.length)),
  );
}

interface ChunkInfo {
  readonly isEntry: boolean;
  readonly imports: readonly string[];
  readonly moduleIds: readonly string[];
}

type ChunkGraph = Readonly<Record<string, ChunkInfo | undefined>>;

function topicsOfChunk(chunk: ChunkInfo): string[] {
  return chunk.moduleIds.flatMap((id) =>
    id.startsWith(RESOLVED) ? [id.slice(RESOLVED.length)] : [],
  );
}

/** Every chunk a set of chunks loads statically, themselves included. */
function staticClosure(
  roots: readonly string[],
  chunks: ChunkGraph,
): Set<string> {
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.shift();
    const imports = next === undefined ? undefined : chunks[next]?.imports;
    for (const imported of imports ?? []) {
      if (!seen.has(imported)) {
        seen.add(imported);
        queue.push(imported);
      }
    }
  }
  return seen;
}

interface ColdLoad {
  /** The chunks the entries load statically. */
  readonly chunks: ReadonlySet<string>;
  /** The topics those chunks bring. */
  readonly topics: ReadonlySet<string>;
}

const coldLoads = new WeakMap<ChunkGraph, ColdLoad>();

function coldLoadOf(chunks: ChunkGraph): ColdLoad {
  let cold = coldLoads.get(chunks);
  if (cold === undefined) {
    const entries = Object.keys(chunks).filter((name) => chunks[name]?.isEntry);
    const initial = staticClosure(entries, chunks);
    cold = {
      chunks: initial,
      topics: new Set(
        [...initial].flatMap((name) => {
          const chunk = chunks[name];
          return chunk === undefined ? [] : topicsOfChunk(chunk);
        }),
      ),
    };
    coldLoads.set(chunks, cold);
  }
  return cold;
}

/**
 * The topics an on-demand chunk must wait for: the ones it and its static
 * imports bring, minus those of the cold load (in before the first frame).
 */
export function topicsToAwait(fileName: string, chunks: ChunkGraph): string[] {
  const cold = coldLoadOf(chunks);
  if (cold.chunks.has(fileName)) return [];
  const topics = new Set<string>();
  for (const name of staticClosure([fileName], chunks)) {
    const chunk = chunks[name];
    if (chunk === undefined) continue;
    for (const topic of topicsOfChunk(chunk)) {
      if (!cold.topics.has(topic)) topics.add(topic);
    }
  }
  return [...topics].sort();
}

export function messageTopics({
  messagesDir,
  baseLocale = 'en',
}: MessageTopicsOptions): Plugin {
  const baseDir = join(messagesDir, baseLocale);
  let topics = new Set<string>();
  let mentions: RegExp | undefined;
  let building = false;

  return {
    name: 'tale:message-topics',
    // After the TypeScript and JSX transforms, so it reads plain JavaScript.
    enforce: 'post',
    configResolved(config) {
      building = config.command === 'build';
    },
    buildStart() {
      topics = readTopics(baseDir);
      const names = [...topics].join('|');
      mentions =
        topics.size === 0 ? undefined : new RegExp(`['"\`](?:${names})['"\`:]`);
    },
    resolveId(id) {
      return id.startsWith(VIRTUAL)
        ? `${RESOLVED}${id.slice(VIRTUAL.length)}`
        : null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const topic = id.slice(RESOLVED.length);
      if (!topics.has(topic)) return null;
      const file = JSON.stringify(join(baseDir, `${topic}.yml`));
      return [
        `import messages from ${file};`,
        `import { registerTopic } from '@tale/ui/i18n/topics';`,
        `registerTopic(${JSON.stringify(topic)}, messages);`,
      ].join('\n');
    },
    transform(code, id) {
      if (mentions === undefined || id.startsWith('\0')) return null;
      if (id.includes('/node_modules/')) return null;
      if (!SCRIPT.test(id.split('?')[0] ?? id)) return null;
      if (!mentions.test(code)) return null;
      const named = topicsNamedIn(this.parse(code), topics);
      if (named.size === 0) return null;
      // Import declarations hoist, so appending them leaves every mapping
      // of the module's own code where it was.
      const imports = [...named]
        .sort()
        .map((topic) => `import ${JSON.stringify(`${VIRTUAL}${topic}`)};`);
      return { code: `${code}\n${imports.join('\n')}\n`, map: null };
    },
    renderChunk(code, chunk, outputOptions, meta) {
      if (!building || outputOptions.format !== 'es') return null;
      if (!chunk.isDynamicEntry || chunk.isEntry) return null;
      const awaited = topicsToAwait(chunk.fileName, meta.chunks);
      if (awaited.length === 0) return null;
      // The chunk resolves for its importer once the words of its topics
      // are in; appended, so the mappings of its code stay where they were.
      return {
        code: `${code}\nawait globalThis.__taleMessageTopics?.ready(${JSON.stringify(awaited)});\n`,
        map: null,
      };
    },
  };
}
