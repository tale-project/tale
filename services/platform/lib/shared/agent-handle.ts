/**
 * An agent's mention handle: what a person types after `@` to find it.
 *
 * "My Opus Agent #3" answers to `@my-opus-agent-3`; a second agent of the
 * same project whose name gives the same handle answers to
 * `@my-opus-agent-3-02`. The handle is made from the agent's CURRENT name and
 * made again when the agent is renamed; a mention stores the agent's id, so
 * the handle only helps someone type and search.
 *
 * Pure and import-free on purpose: the boot data migration that fills the
 * handles of agents created before they existed imports this module, and the
 * handles it writes are frozen into the database, so the rule must not move
 * with a dependency upgrade.
 */

/** The longest base a name gives, before any `-02` suffix. */
export const AGENT_HANDLE_BASE_MAX = 48;

/** The longest whole handle, suffix included (the column's CHECK holds the
 * same number). */
export const AGENT_HANDLE_MAX = 52;

/** The base of a name with no letter or digit Tale can spell in ASCII
 * ("发票助手", "🚀"). */
const AGENT_HANDLE_FALLBACK = 'agent';

/** Lowercase letters and digits in runs joined by single hyphens. */
const AGENT_HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Letters NFKD does not take apart into a base letter and a mark, spelled
 * the way their languages write them without the letter. */
const TRANSLITERATION: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

const APOSTROPHES = /['‘’ʼ]/g;
const TRANSLITERATED = new RegExp(
  `[${Object.keys(TRANSLITERATION).join('')}]`,
  'g',
);

/** The handle a name gives before any collision suffix. */
export function agentHandleBase(name: string): string {
  const spelled = name
    .normalize('NFC')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(TRANSLITERATED, (letter) => TRANSLITERATION[letter] ?? letter)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = spelled.slice(0, AGENT_HANDLE_BASE_MAX).replace(/-+$/, '');
  return base === '' ? AGENT_HANDLE_FALLBACK : base;
}

/** The `n`th handle a base offers: the base itself, then `-02` to `-99`, then
 * `-100` and up. The base is cut, never the suffix, should a suffix ever not
 * fit beside it. */
export function agentHandleCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${String(n).padStart(2, '0')}`;
  const room = AGENT_HANDLE_MAX - suffix.length;
  const cut =
    base.length > room ? base.slice(0, room).replace(/-+$/, '') : base;
  return `${cut}${suffix}`;
}

/** The first handle of `base` nobody in `taken` holds. */
export function nextAgentHandle(
  base: string,
  taken: ReadonlySet<string>,
): string {
  for (let n = 1; ; n += 1) {
    const candidate = agentHandleCandidate(base, n);
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether `handle` is one of the handles `base` offers: the base, or the base
 * with a collision suffix. A rename that changes only case or punctuation
 * keeps a handle that still fits its new name. */
export function handleFitsBase(handle: string, base: string): boolean {
  if (handle === base) return true;
  const match = /-(\d{2,})$/.exec(handle);
  if (match === null) return false;
  const n = Number(match[1]);
  return n >= 2 && agentHandleCandidate(base, n) === handle;
}

/** Whether an agent keeps `handle` when a save renames it from `previousName`
 * to `name`: while the handle is one the new name offers, except when it was
 * the old name's own handle and only looks like a numbered twin of the new
 * one. "Tax agent 2025" (`@tax-agent-2025`) renamed "Tax agent" answers to
 * `@tax-agent`, not to `@tax-agent-2025`. */
export function renameKeepsHandle(
  handle: string,
  previousName: string,
  name: string,
): boolean {
  const base = agentHandleBase(name);
  if (handle === base) return true;
  return (
    handleFitsBase(handle, base) && handle !== agentHandleBase(previousName)
  );
}

/** Whether a stored or typed value has a handle's shape. */
export function isAgentHandle(value: string): boolean {
  return value.length <= AGENT_HANDLE_MAX && AGENT_HANDLE_RE.test(value);
}

export interface AgentHandleRow {
  id: string;
  name: string;
  handle: string | null;
  createdAt: number;
}

/**
 * Handles for the agents of ONE project that have none yet, oldest agent
 * first, so the agent that was there first keeps the clean handle. Handles
 * already stored and `reserved` ones (what other people and automations
 * answer to) are never handed out. Agents that hold a handle are not in the
 * result.
 */
export function deriveAgentHandles(
  rows: readonly AgentHandleRow[],
  reserved: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const taken = new Set<string>(reserved);
  for (const row of rows) {
    if (row.handle !== null) taken.add(row.handle);
  }
  const missing = rows
    .filter((row) => row.handle === null)
    .toSorted(
      (a, b) =>
        a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const minted = new Map<string, string>();
  for (const row of missing) {
    const handle = nextAgentHandle(agentHandleBase(row.name), taken);
    taken.add(handle);
    minted.set(row.id, handle);
  }
  return minted;
}
