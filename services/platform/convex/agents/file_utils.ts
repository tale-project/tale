'use node';

/**
 * On-disk plumbing for the `agents` config domain.
 *
 * Every organization keeps its agents at
 * `${TALE_CONFIG_DIR}/<orgSlug>/agents/<slug>.yml`, one flat file per agent.
 * The file is the whole model: there is no agent row, no installation record
 * and no per-org catalog index — listing an org's agents means reading its own
 * directory, which is what makes the domain tenant-isolated by construction.
 *
 * Edits keep a trail under `<orgSlug>/agents/.history/<slug>/`, the same
 * mechanism every other file-based domain uses; this domain adds no versioning
 * of its own.
 *
 * Only `.yml` files are agents. A file left over in the shape this domain was
 * converted FROM is a different document with different fields, not an agent
 * in an older format, so it is skipped rather than parsed and reported broken;
 * the versioned conversion is what turns one into an agent file.
 *
 * Path handling is defensive throughout: the org slug and the agent slug are
 * validated before they are joined, joins go through the shared traversal
 * guard, and reads refuse symlinks.
 */

import path from 'node:path';

import type { AgentFileReader } from '../../lib/agents/listing';
import {
  isValidAgentSlug,
  MAX_AGENT_FILE_BYTES,
} from '../../lib/shared/schemas/agents';
import {
  atomicWrite,
  generateHistoryTimestamp,
  getConfigRoot,
  pruneHistory,
  readdirSafe,
  readJsonFile,
  removeDirSafe,
  removeFileSafe,
  safeJoinWithinDir,
  validateOrgSlug,
} from '../lib/file_io';

/** The config-domain name — the directory name inside an org's config tree. */
export const AGENTS_CONFIG_DOMAIN = 'agents';

/** Extension every agent file carries. */
export const AGENT_FILE_EXTENSION = '.yml';

/** How many superseded versions to keep per agent. */
const MAX_HISTORY_ENTRIES = 20;

/** `<orgSlug>/agents/` — the org's agent domain directory. */
export function resolveAgentsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(
    getConfigRoot(AGENTS_CONFIG_DOMAIN),
    orgSlug,
    AGENTS_CONFIG_DOMAIN,
  );
}

/** `<orgSlug>/agents/<slug>.yml` — one agent. */
export function resolveAgentFilePath(orgSlug: string, slug: string): string {
  if (!isValidAgentSlug(slug)) {
    throw new Error(`Invalid agent slug: ${slug}`);
  }
  return safeJoinWithinDir(
    resolveAgentsDir(orgSlug),
    `${slug}${AGENT_FILE_EXTENSION}`,
  );
}

/** `<orgSlug>/agents/.history/<slug>/` — superseded versions of one agent. */
export function resolveAgentHistoryDir(orgSlug: string, slug: string): string {
  if (!isValidAgentSlug(slug)) {
    throw new Error(`Invalid agent slug: ${slug}`);
  }
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveAgentsDir(orgSlug), '.history'),
    slug,
  );
}

/** `agents/<slug>.yml` — the path an operator sees, org-tree relative. */
export function relativeAgentPath(slug: string): string {
  return `${AGENTS_CONFIG_DOMAIN}/${slug}${AGENT_FILE_EXTENSION}`;
}

/**
 * The agent slugs present for an org, unsorted. A missing domain directory is
 * an empty roster, not an error — the directory is created on demand when the
 * org authors its first agent. Entries that are not `.yml` files, or whose
 * stem is not a valid slug, are ignored, which also skips the `.history/`
 * trail and any editor leftovers.
 */
export async function listAgentSlugs(orgSlug: string): Promise<string[]> {
  const entries = await readdirSafe(resolveAgentsDir(orgSlug));
  const slugs: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(AGENT_FILE_EXTENSION)) continue;
    const slug = entry.slice(0, -AGENT_FILE_EXTENSION.length);
    if (isValidAgentSlug(slug)) slugs.push(slug);
  }
  return slugs;
}

/**
 * The raw text of one agent file, or `null` when the org has none. A
 * symlinked, oversized or unreadable file throws — silently treating one as
 * absent would hide a broken agent from the operator who has to fix it.
 */
export async function readAgentFileText(
  orgSlug: string,
  slug: string,
): Promise<string | null> {
  const filePath = resolveAgentFilePath(orgSlug, slug);
  const result = await readJsonFile(
    filePath,
    MAX_AGENT_FILE_BYTES,
    (content) => content,
  );
  if (result.ok) return result.data;
  if (result.error === 'not_found') return null;
  throw new Error(`${filePath}: ${result.message}`);
}

/**
 * An {@link AgentFileReader} bound to ONE organization. Nothing downstream
 * can widen it to another org: the slug is captured here and every path is
 * resolved from it.
 */
export function createOrgAgentReader(orgSlug: string): AgentFileReader {
  return {
    listSlugs: () => listAgentSlugs(orgSlug),
    readAgentFile: (slug) => readAgentFileText(orgSlug, slug),
    describe: (slug) => resolveAgentFilePath(orgSlug, slug),
  };
}

/**
 * Write an agent file, keeping the superseded version in the domain's history
 * trail. The write itself is atomic, so a reader never observes a half-written
 * file.
 */
export async function writeAgentFileText(
  orgSlug: string,
  slug: string,
  content: string,
): Promise<void> {
  const filePath = resolveAgentFilePath(orgSlug, slug);
  const current = await readAgentFileText(orgSlug, slug);
  if (current !== null) {
    const historyDir = resolveAgentHistoryDir(orgSlug, slug);
    await atomicWrite(
      path.join(
        historyDir,
        `${generateHistoryTimestamp()}${AGENT_FILE_EXTENSION}`,
      ),
      current,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }
  await atomicWrite(filePath, content);
}

/**
 * Remove an agent and its history trail. Returns true when a file was
 * actually removed, so a caller can tell a delete from a no-op.
 */
export async function removeAgentFile(
  orgSlug: string,
  slug: string,
): Promise<boolean> {
  const removed = await removeFileSafe(resolveAgentFilePath(orgSlug, slug));
  await removeDirSafe(resolveAgentHistoryDir(orgSlug, slug));
  return removed;
}

/** One superseded version in an agent's history trail. */
export interface AgentHistoryEntry {
  /** The snapshot's file name (no path) — the handle a restore names. */
  entry: string;
  /** When the snapshot was written (from the file name's epoch prefix). */
  savedAt: number;
}

/**
 * A history entry name as {@link writeAgentFileText} mints them:
 * `<epochMs>-<8 hex chars>.yml`. Restores accept ONLY this shape, so an entry
 * name can never smuggle a path segment.
 */
const HISTORY_ENTRY_RE = /^(\d+)-[0-9a-f]{8}\.yml$/;

/**
 * The superseded versions of one agent, newest first. A missing history
 * directory is an empty trail (the agent was never edited), not an error.
 */
export async function listAgentHistoryEntries(
  orgSlug: string,
  slug: string,
): Promise<AgentHistoryEntry[]> {
  const entries = await readdirSafe(resolveAgentHistoryDir(orgSlug, slug));
  const trail: AgentHistoryEntry[] = [];
  for (const entry of entries) {
    const match = HISTORY_ENTRY_RE.exec(entry);
    if (!match) continue;
    trail.push({ entry, savedAt: Number(match[1]) });
  }
  trail.sort((a, b) => b.savedAt - a.savedAt);
  return trail;
}

/**
 * The raw text of one history snapshot, or `null` when no such entry exists.
 * The entry name must be one {@link listAgentHistoryEntries} returned.
 */
export async function readAgentHistoryText(
  orgSlug: string,
  slug: string,
  entry: string,
): Promise<string | null> {
  if (!HISTORY_ENTRY_RE.test(entry)) {
    throw new Error(`Invalid agent history entry: ${entry}`);
  }
  const filePath = safeJoinWithinDir(
    resolveAgentHistoryDir(orgSlug, slug),
    entry,
  );
  const result = await readJsonFile(
    filePath,
    MAX_AGENT_FILE_BYTES,
    (content) => content,
  );
  if (result.ok) return result.data;
  if (result.error === 'not_found') return null;
  throw new Error(`${filePath}: ${result.message}`);
}
