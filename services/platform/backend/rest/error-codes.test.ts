// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SKILL_BUNDLE_REFUSAL_CODES } from '../core/skills/bundle_zip.ts';
import { SKILL_ERROR_STATUS } from '../domains/skills/errors.ts';
import { REST_ERROR_CODES, isRestErrorCode } from './error-codes.ts';

const here = new URL('.', import.meta.url).pathname;

/** The door's handler sources — never its tests or its real-Postgres
 * check scripts, which carry codes of their own to compare against. */
function handlerSources(): string[] {
  return readdirSync(here)
    .filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('-check.ts'),
    )
    .map((name) => readFileSync(join(here, name), 'utf8'));
}

/** Every code literal a handler answers: `code: 'X'` in an envelope, the
 * third argument of `notFound(c, …, 'X')`, the code of a
 * `RestRefusal(…, 'X')` or `invalidQueryResponse(c, 'X', …)`. */
function literalCodes(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/code:\s*'([A-Z][A-Z0-9_]+)'/g)) {
    found.add(match[1] ?? '');
  }
  for (const match of source.matchAll(
    /(?:notFound|invalidQueryResponse|new RestRefusal)\(([^;]*?)\)/gs,
  )) {
    for (const code of (match[1] ?? '').matchAll(/'([A-Z][A-Z0-9_]{3,})'/g)) {
      found.add(code[1] ?? '');
    }
  }
  found.delete('');
  return [...found];
}

/**
 * The domain modules a handler imports — the layers whose own error
 * classes reach the wire through `domainErrorResponse` /
 * `codedRefusalResponse`. Their `new XError('CODE', …)` literals are
 * codes the door can answer, so the registry must carry them too; the
 * runtime warn-once (`noteRestErrorCode`) only ever told an operator after
 * the fact. Modules are followed one level deep from the handlers (the
 * services they name), which is where the door's refusals are thrown.
 */
function domainSourcesReachableFromHandlers(): {
  path: string;
  source: string;
}[] {
  const seen = new Map<string, string>();
  for (const name of readdirSync(here)) {
    if (
      !name.endsWith('.ts') ||
      name.endsWith('.test.ts') ||
      name.endsWith('-check.ts')
    ) {
      continue;
    }
    const source = readFileSync(join(here, name), 'utf8');
    for (const match of source.matchAll(
      /from '((?:\.\.\/(?:domains|core|auth|lib)\/)[^']+)'/g,
    )) {
      const spec = match[1] ?? '';
      const file = spec.endsWith('.ts') ? spec : `${spec}.ts`;
      const path = join(here, file);
      if (seen.has(path)) continue;
      try {
        seen.set(path, readFileSync(path, 'utf8'));
      } catch (error) {
        // A directory import, or a module without the .ts suffix on disk —
        // nothing to scan there; the handler guard covers the door itself.
        console.warn(`[error-codes.test] skipped ${file}:`, error);
      }
    }
  }
  return [...seen].map(([path, source]) => ({ path, source }));
}

/** Every SHOUTING code a domain module throws through one of its error
 * classes (`new ContactError('CONTACT_STALE', …)`) or answers in a coded
 * envelope. Lower-case codes are the app doors' own vocabulary and are
 * not the REST door's business. */
function domainCodes(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(
    /new [A-Z][A-Za-z]*Error\(\s*'([A-Z][A-Z0-9_]{3,})'/g,
  )) {
    found.add(match[1] ?? '');
  }
  for (const match of source.matchAll(/code:\s*'([A-Z][A-Z0-9_]{3,})'/g)) {
    found.add(match[1] ?? '');
  }
  found.delete('');
  return [...found];
}

/**
 * Domain codes the REST door can never answer: thrown on paths only the
 * app doors reach (an interactive confirmation, a lane REST does not
 * mount), or already translated by the door before they surface. Listed
 * by hand so the guard stays honest — a code that becomes reachable is
 * moved into the registry, not left here.
 */
const APP_ONLY_CODES: ReadonlySet<string> = new Set<string>([
  // Saving, deploying and answering an automation's human asks happen
  // through MCP and the app, whose envelopes are their own.
  'AUTOMATION_DEPLOY_REJECTED',
  'AUTOMATION_NAME_INVALID',
  'AUTOMATION_NAME_RESERVED',
  'AUTOMATION_NAME_TAKEN',
  'EMPTY_ANSWER',
  'HUMAN_ASK_EXPIRED',
  'HUMAN_ASK_NOT_FOUND',
  'HUMAN_ASK_NOT_PENDING',
  // The MCP dispatch store's own gates — answered as JSON-RPC results.
  'FORBIDDEN_DEVELOPER_SETTINGS',
  'UNAUTHENTICATED',
  // The connector bridge and the in-sandbox doors.
  'BAD_REQUEST',
  'TOO_MANY_REQUESTS',
  // Interactive confirmations the REST door supplies itself, or that
  // only the app asks for.
  'DEFAULT_ORG_PROTECTED',
  'PROJECT_CONFIRM_PHRASE_MISMATCH',
  // Hub folder team sharing — no REST body carries teams.
  'FOLDER_TEAM_FORBIDDEN',
  'FOLDER_TEAM_INHERITED',
  'TEAM_INHERITED_FROM_FOLDER',
  // Inputs the door's own schemas refuse before the domain sees them.
  'INVALID_ARGUMENTS',
  'INVALID_SCAN_INTERVAL',
  'PRODUCT_STATUS_INVALID',
  // Task fields no REST body carries: attachments, dependencies,
  // subtasks, reviewers, schedules.
  'TASK_ATTACHMENTS_INVALID',
  'TASK_ATTACHMENT_NOT_OWNED',
  'TASK_DEPENDENCY_CYCLE',
  'TASK_DEPENDENCY_PROJECT_MISMATCH',
  'TASK_DEPENDENCY_SELF',
  'TASK_DEPTH_EXCEEDED',
  'TASK_HAS_OPEN_SUBTASKS',
  'TASK_PARENT_ARCHIVED',
  'TASK_PARENT_PROJECT_MISMATCH',
  'TASK_REVIEWER_INVALID',
  'TASK_SCHEDULE_INVALID',
]);

describe('the REST error-code registry', () => {
  it('carries every code the domain modules behind the handlers can throw', () => {
    const unregistered = domainSourcesReachableFromHandlers()
      .flatMap(({ source }) => domainCodes(source))
      .filter((code) => !isRestErrorCode(code) && !APP_ONLY_CODES.has(code));
    expect([...new Set(unregistered)].sort()).toEqual([]);
  });

  it('is sorted and free of duplicates', () => {
    const sorted = [...REST_ERROR_CODES].sort();
    expect([...REST_ERROR_CODES]).toEqual(sorted);
    expect(new Set(REST_ERROR_CODES).size).toBe(REST_ERROR_CODES.length);
  });

  it('carries every code the door’s handlers answer', () => {
    const unregistered = handlerSources()
      .flatMap(literalCodes)
      .filter((code) => !isRestErrorCode(code));
    expect([...new Set(unregistered)].sort()).toEqual([]);
  });

  it('carries every code the skills family maps onto a status', () => {
    // The bundle-upload refusals are the app's zip lane; REST takes the
    // skill body as text and never reaches them.
    const bundleOnly: ReadonlySet<string> = new Set(SKILL_BUNDLE_REFUSAL_CODES);
    const unregistered = Object.keys(SKILL_ERROR_STATUS).filter(
      (code) => !isRestErrorCode(code) && !bundleOnly.has(code),
    );
    expect(unregistered).toEqual([]);
  });

  it('carries every code the OpenAPI source names', () => {
    const spec = readFileSync(
      join(here, '..', '..', 'scripts', 'openapi', 'spec.ts'),
      'utf8',
    );
    // Backticked SHOUTING identifiers in descriptions are codes — bar the
    // one environment variable a description names.
    const named = new Set(
      [...spec.matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)]
        .map((match) => match[1] ?? '')
        .filter((code) => code !== 'TALE_DEPLOYMENT_CONFIG_ADMINS'),
    );
    const unregistered = [...named].filter((code) => !isRestErrorCode(code));
    expect(unregistered.sort()).toEqual([]);
  });
});
