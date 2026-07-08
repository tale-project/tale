'use node';

/**
 * Install preflight: diff the file set an automation install WOULD write (from
 * `planAutomationFiles` — the same plan `installAutomationFiles` consumes, so the diff can
 * never drift from the copy) against what is already on the org's disk.
 *
 * Statuses:
 *  - `create`    — the destination does not exist; the install only adds.
 *  - `identical` — the destination exists with the same content: byte-equal,
 *    or (for `*.json`) equal after normalization (parse → drop top-level
 *    null/empty-array entries exactly like `serializeJson` → deep key sort →
 *    stringify), so whitespace/key-order/serializer differences don't scare
 *    the operator.
 *  - `override`  — the destination exists with DIFFERENT content; the install
 *    would replace the user's file. These are what the confirmation flow gates.
 *
 * Comparison is over raw Buffers — never utf-8 decoded reads — so a binary
 * asset (icon, script blob) diffs correctly (the ledger's utf-8 `contentHash`
 * quirk stays confined to the ledger).
 */
import { readFile } from 'node:fs/promises';

import {
  APP_MANIFEST_FILENAME,
  AUTOMATION_MANIFEST_FILENAME,
} from '../../lib/shared/schemas/automations';
import { sortObjectKeysDeep } from '../../lib/shared/utils/canonicalize-config';
import { errnoCode } from '../lib/file_io';
import { type PlannedFile, planAutomationFiles } from './install_fs';

export type PreflightStatus = 'create' | 'identical' | 'override';

/** What a planned file IS, for grouped display in the confirmation UI. */
export type PreflightKind =
  | 'manifest'
  | 'icon'
  | 'agent'
  | 'view'
  | 'message'
  | 'asset'
  | 'integration'
  | 'skill';

export interface PreflightEntry {
  /** `'automation'` (shell) or a fan-out domain (`integrations`, `skills`). */
  domain: string;
  /** Path relative to the domain dir (for `'automation'`: relative to the automation dir). */
  path: string;
  kind: PreflightKind;
  /** The owning slug where the kind has one (agent/integration/skill). */
  slug?: string;
  status: PreflightStatus;
}

/** The stable identity a confirmation names — `${domain}:${path}`. */
export function preflightKey(
  e: Pick<PreflightEntry, 'domain' | 'path'>,
): string {
  return `${e.domain}:${e.path}`;
}

/** Classify a planned file for display (see {@link PreflightKind}). */
function classify(
  file: PlannedFile,
  automationSlug: string,
): { kind: PreflightKind; slug?: string } {
  if (file.domain === 'integrations') {
    return { kind: 'integration', slug: file.path.split('/')[0] };
  }
  if (file.domain === 'skills') {
    return { kind: 'skill', slug: file.path.split('/')[0] };
  }
  // domain 'automation' — the shell. DUAL-READ: a planned manifest file is either the
  // canonical name or the legacy one (see `file_utils.ts`'s DUAL-READ note).
  if (
    file.path === AUTOMATION_MANIFEST_FILENAME ||
    file.path === APP_MANIFEST_FILENAME
  ) {
    return { kind: 'manifest' };
  }
  if (/^icon\.[a-z0-9]+$/.test(file.path)) return { kind: 'icon' };
  if (file.path.startsWith('agents/')) {
    const name = file.path.slice('agents/'.length).replace(/\.json$/, '');
    return { kind: 'agent', slug: `${automationSlug}/${name}` };
  }
  if (file.path.startsWith('views/')) return { kind: 'view' };
  if (file.path.startsWith('messages/')) return { kind: 'message' };
  return { kind: 'asset' };
}

/**
 * Normalize a JSON buffer to the canonical form `serializeJson`
 * (`convex/lib/file_io.ts`) writes: parse, drop top-level entries whose value
 * is null/undefined/empty-array, deep-sort object keys, stringify. Returns
 * null when the buffer is not valid JSON (the caller then falls back to the
 * byte comparison's verdict).
 */
function normalizeJson(buf: Buffer): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString('utf-8'));
  } catch {
    return null;
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    parsed = Object.fromEntries(
      Object.entries(parsed).filter(
        ([, v]) =>
          v !== null &&
          v !== undefined &&
          !(Array.isArray(v) && v.length === 0),
      ),
    );
  }
  return JSON.stringify(sortObjectKeysDeep(parsed));
}

/**
 * Diff what installing `automationSlug` would write against the org's disk — one
 * {@link PreflightEntry} per planned file (see the header for the statuses).
 * Pure read: nothing on disk is touched.
 */
export async function diffAutomationInstall(
  orgSlug: string,
  automationSlug: string,
): Promise<PreflightEntry[]> {
  const plan = await planAutomationFiles(orgSlug, automationSlug);
  const entries: PreflightEntry[] = [];
  for (const file of plan) {
    const { kind, slug } = classify(file, automationSlug);
    let dstBuf: Buffer | null;
    try {
      dstBuf = await readFile(file.dst);
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') throw err;
      dstBuf = null;
    }
    if (dstBuf === null) {
      entries.push({
        domain: file.domain,
        path: file.path,
        kind,
        slug,
        status: 'create',
      });
      continue;
    }
    const srcBuf = await readFile(file.src);
    let status: PreflightStatus = srcBuf.equals(dstBuf)
      ? 'identical'
      : 'override';
    if (status === 'override' && file.path.endsWith('.json')) {
      const srcNorm = normalizeJson(srcBuf);
      const dstNorm = normalizeJson(dstBuf);
      if (srcNorm !== null && srcNorm === dstNorm) status = 'identical';
    }
    entries.push({
      domain: file.domain,
      path: file.path,
      kind,
      slug,
      status,
    });
  }
  return entries;
}
