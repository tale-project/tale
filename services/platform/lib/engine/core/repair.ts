/**
 * Deterministic document repair + agent-action parsing.
 *
 * The single most common agent failure mode is malformed JSON where
 * `{{ }}` templates meet JSON structure — a missing `}` after a
 * template-heavy string, a spurious `]`, a stray quote between array
 * elements, raw newlines inside strings. Every fix here is grammar-forced:
 * it is applied only when the surrounding delimiter state proves it, so
 * valid input can never be corrupted. This layer measurably converts
 * otherwise-lost authoring turns into progress.
 *
 * Parsing order for agent replies: fenced blocks (last first) → the whole
 * text → balanced-brace candidates. YAML parsing covers JSON too (superset),
 * with `repairJson` as the JSON fallback.
 */

import { parseYaml } from '../../shared/config/yaml';

/** An action an agent asked the engine to perform. */
export interface AgentAction {
  method: string;
  params: unknown;
  /** Set when the reply deviated from the protocol but was recoverable. */
  lenient?: string;
}

export interface ParseFailure {
  parseError: string;
}

export type ParsedReply = AgentAction | ParseFailure;

export function isParseFailure(p: ParsedReply): p is ParseFailure {
  return 'parseError' in p;
}

// --------------------------------------------------------------- JSON repair

/** String-aware scan of a JSON prefix: the stack of pending closers. */
function scanStack(
  src: string,
  end = src.length,
): { stack: string[]; inStr: boolean } | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < end && i < src.length; i++) {
    const c = src[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null;
    }
  }
  return { stack, inStr };
}

function missingClosers(src: string): string | null {
  const scan = scanStack(src);
  if (!scan) return null;
  return (scan.inStr ? '"' : '') + scan.stack.toReversed().join('');
}

/**
 * Repair the JSON failure modes agents actually produce. Returns the
 * repaired source, or null when no grammar-forced fix applies — this
 * function never guesses.
 */
export function repairJson(src: string): string | null {
  let s = src.trim();
  for (let i = 0; i < 12; i++) {
    let err: unknown;
    try {
      JSON.parse(s);
      return s;
    } catch (e) {
      err = e;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const pm = msg.match(/position (\d+)/);
    if (!pm) return null;
    const pos = Number(pm[1]);

    // Raw control characters inside strings → escape them.
    if (/Bad control character/.test(msg)) {
      const ch = s[pos];
      const esc =
        ch === '\n' ? '\\n' : ch === '\t' ? '\\t' : ch === '\r' ? '\\r' : null;
      if (!esc) return null;
      s = s.slice(0, pos) + esc + s.slice(pos + 1);
      continue;
    }
    // Under-closed at EOF → append exactly the missing closers.
    if (pos >= s.length || s.slice(pos).trim() === '') {
      const closers = missingClosers(s);
      if (!closers) return null;
      s += closers;
      continue;
    }
    // `]` where an object is still open → a missing `}`; with no open array
    // it is a spurious `]`.
    if (/Expected ',' or '}'/.test(msg) && s[pos] === ']') {
      const scan = scanStack(s, pos);
      if (scan && scan.stack.includes(']')) {
        s = `${s.slice(0, pos)}}${s.slice(pos)}`;
      } else {
        s = s.slice(0, pos) + s.slice(pos + 1);
      }
      continue;
    }
    // The symmetric case: `}` inside an open array.
    if (/Expected ',' or ']'/.test(msg) && s[pos] === '}') {
      const scan = scanStack(s, pos);
      if (scan && scan.stack.includes('}')) {
        s = `${s.slice(0, pos)}]${s.slice(pos)}`;
      } else {
        s = s.slice(0, pos) + s.slice(pos + 1);
      }
      continue;
    }
    // A trailing comma before a closer.
    if (
      /Expected double-quoted property name/.test(msg) &&
      (s[pos] === '}' || s[pos] === ']')
    ) {
      const before = s.slice(0, pos).replace(/,\s*$/, '');
      if (before.length < pos) {
        s = before + s.slice(pos);
        continue;
      }
    }
    // A stray quote before an object between array elements: [..., "{"id"…].
    if (
      /after array element/.test(msg) &&
      s[pos - 1] === '"' &&
      s[pos - 2] === '{' &&
      s[pos - 3] === '"'
    ) {
      const prev = s
        .slice(0, pos - 3)
        .trimEnd()
        .slice(-1);
      if (prev === ',' || prev === '[') {
        s = s.slice(0, pos - 3) + s.slice(pos - 2);
        continue;
      }
    }
    return null;
  }
  return null;
}

/** Actionable description of a JSON syntax error with location context. */
export function jsonErrorDetail(src: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/position (\d+)/);
  if (m) {
    const pos = Number(m[1]);
    const snippet = src.slice(Math.max(0, pos - 60), pos + 60);
    return `the document is malformed: ${msg}. The problem is near: …${snippet}…`;
  }
  return `the document is malformed: ${msg}`;
}

// ------------------------------------------------------------ reply parsing

/** The dispatch surface — a reply naming one of these under a non-standard
 * key is still recoverable. */
const KNOWN_METHODS = new Set([
  'get_docs',
  'get_catalog',
  'search_catalog',
  'validate_workflow',
  'run_workflow',
  'test_workflow',
  'save_workflow',
  'get_workflow',
  'list_workflows',
  'deploy_workflow',
  'set_trigger',
  'run_deployed',
]);

function get(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

/** Normalize the shapes agents emit into `{method, params}`. */
function normalizeAction(value: unknown): AgentAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
  const obj = value as Record<string, unknown>;
  if (typeof obj.method === 'string' && obj.method.length > 0) {
    return {
      method: obj.method,
      params: get(obj, 'params', 'arguments', 'input') ?? {},
    };
  }
  const alias = get(obj, 'name', 'tool', 'action');
  if (typeof alias === 'string' && KNOWN_METHODS.has(alias)) {
    return {
      method: alias,
      params: get(obj, 'params', 'arguments', 'parameters', 'input') ?? {},
      lenient: 'used a non-standard action key',
    };
  }
  // A bare workflow document (name + nodes, no method) → run it.
  if (obj.nodes && obj.name) {
    return {
      method: 'run_workflow',
      params: { workflow: obj, input: {} },
      lenient: 'sent a bare workflow',
    };
  }
  if (
    typeof alias === 'string' &&
    alias.length > 0 &&
    (obj.arguments !== undefined || obj.params !== undefined)
  ) {
    return {
      method: alias,
      params: get(obj, 'params', 'arguments') ?? {},
      lenient: 'used a non-standard action key',
    };
  }
  return null;
}

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function balancedJsonCandidates(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (esc) {
        esc = false;
        continue;
      }
      if (c === '\\') {
        esc = true;
        continue;
      }
      if (c === '"') inStr = !inStr;
      if (inStr) continue;
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/** Agent replies are single actions, not multi-megabyte documents; anything
 * bigger than this is a runaway, not a workflow. */
const REPLY_MAX_BYTES = 1024 * 1024;

/**
 * Parse an agent reply into an action. Accepts YAML or JSON, fenced or
 * bare; applies `repairJson` to JSON-looking candidates before giving up.
 */
export function parseAgentReply(raw: string): ParsedReply {
  const text = stripThink(raw);
  if (!text) return { parseError: 'empty reply' };
  const fences = [...text.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)].map(
    (m) => m[1].trim(),
  );
  // The last fenced block is the intended one.
  const candidates = fences.toReversed();
  candidates.push(text);
  candidates.push(...balancedJsonCandidates(text).toReversed());

  let detail: string | null = null;
  for (const c of candidates) {
    const parsed = parseYaml(c, {
      maxBytes: REPLY_MAX_BYTES,
      allowArrayRoot: true,
    });
    if (parsed.ok) {
      const action = normalizeAction(parsed.data);
      if (action) return action;
      if (!detail) detail = 'the document parsed but contains no "method" key';
      continue;
    }
    if (c.trimStart().startsWith('{')) {
      const repaired = repairJson(c);
      if (repaired) {
        try {
          const action = normalizeAction(JSON.parse(repaired));
          if (action) {
            return { ...action, lenient: 'auto-repaired malformed JSON' };
          }
        } catch (err) {
          console.warn(
            '[engine] repaired JSON candidate still failed to parse:',
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (!detail && fences.includes(c)) {
        try {
          JSON.parse(c);
        } catch (e) {
          detail = jsonErrorDetail(c, e);
        }
      }
    } else if (!detail && fences.includes(c)) {
      detail = `the YAML is malformed: ${parsed.error.slice(0, 260)}`;
    }
  }
  return {
    parseError: `${detail ?? 'no action found'}. Reply with exactly one fenced yaml block: method: <name> + params: {...}.`,
  };
}
