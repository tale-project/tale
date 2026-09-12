// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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
 * the fact. Modules are followed from the handlers through the backend's
 * own layers (`domains`, `core`, `auth`, `lib`), up to `IMPORT_DEPTH` hops:
 * one hop found the services the handlers name, but a service that
 * delegates to a helper (`core/knowledge_entries/helpers.ts`, thrown
 * through `domains/knowledge_entries/service.ts`) put its codes on the
 * wire unseen — `KNOWLEDGE_ENTRY_TOPIC_REQUIRED` reached a client with no
 * contract listing it, and the guard stayed green.
 */
const IMPORT_DEPTH = 2;
const BACKEND_ROOT = resolve(here, '..');

function backendLayerImports(fromFile: string, source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
    const spec = match[1] ?? '';
    const target = resolve(dirname(fromFile), spec);
    const inside = relative(BACKEND_ROOT, target);
    if (!/^(domains|core|auth|lib)(\/|$)/.test(inside)) continue;
    found.push(target.endsWith('.ts') ? target : `${target}.ts`);
  }
  return found;
}

function domainSourcesReachableFromHandlers(): {
  path: string;
  source: string;
}[] {
  const seen = new Map<string, string>();
  let frontier: string[] = [];
  for (const name of readdirSync(here)) {
    if (
      !name.endsWith('.ts') ||
      name.endsWith('.test.ts') ||
      name.endsWith('-check.ts')
    ) {
      continue;
    }
    const file = join(here, name);
    frontier.push(...backendLayerImports(file, readFileSync(file, 'utf8')));
  }
  for (let depth = 0; depth < IMPORT_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const path of frontier) {
      if (seen.has(path)) continue;
      let source: string;
      try {
        source = readFileSync(path, 'utf8');
      } catch (error) {
        // A directory import, or a module without the .ts suffix on disk —
        // nothing to scan there; the handler guard covers the door itself.
        console.warn(`[error-codes.test] skipped ${path}:`, error);
        continue;
      }
      seen.set(path, source);
      next.push(...backendLayerImports(path, source));
    }
    frontier = next;
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
  // A project id the organization does not have: every REST door resolves
  // the URL project first (`loadRestProject` → `PROJECT_NOT_FOUND`), the MCP
  // store checks it before the run store does (`PROJECT_NOT_FOUND`), and the
  // webhook door folds it into its one 403 — only the app door's start with
  // a `projectId` in the body answers it. (`AUTOMATION_PROJECT_ARCHIVED` is
  // thrown by nothing and left the registry with it.)
  'AUTOMATION_PROJECT_UNKNOWN',
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
  // Documents: the REST door refuses a project file with the opaque 404
  // and carries no `teamIds`, so a project+team clash never reaches the
  // domain; a blank title is trimmed and refused at the door (`nonBlank`),
  // so the domain's own title check cannot fire; detaching a document
  // from its project is the app's own action; and a bare file row's delete
  // (`FILE_BOUND_TO_DOCUMENT`) is the app's files lane — REST deletes the
  // document, never the row.
  'DOCUMENT_NOT_IN_PROJECT',
  'DOCUMENT_SCOPE_CONFLICT',
  'DOCUMENT_TITLE_INVALID',
  'FILE_BOUND_TO_DOCUMENT',
  // Knowledge entries: the chat/MCP listing lane's own cursor check —
  // REST lists sign their cursors and refuse a foreign one as
  // `INVALID_CURSOR` at the door.
  'KNOWLEDGE_ENTRY_CURSOR_INVALID',
  // Governance retention (the app's retention doors); the purge a REST
  // delete runs never reads the retention config.
  'RETENTION_CONFIG_MISSING',
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
  // Two hops from the handlers (`IMPORT_DEPTH`): modules a REST-reached
  // service imports for lanes only the app doors call. Listed so the
  // guard's over-approximation stays honest — a code that becomes
  // reachable through a REST route moves into the registry.
  // Knowledge entries: the door trims and caps the body first
  // (`nonBlank`), so the domain's own presence and length checks cannot
  // fire from REST — they answered `KNOWLEDGE_ENTRY_TOPIC_REQUIRED` for a
  // whitespace-only topic until the door caught up.
  'KNOWLEDGE_ENTRY_CONTENT_REQUIRED',
  'KNOWLEDGE_ENTRY_CONTENT_TOO_LONG',
  'KNOWLEDGE_ENTRY_TOPIC_REQUIRED',
  'KNOWLEDGE_ENTRY_TOPIC_TOO_LONG',
  // Provider and connector credentials — Settings surfaces only.
  'AUTH_METHOD_NOT_SUPPORTED',
  'CONNECTOR_UNKNOWN',
  'CREDENTIAL_BROKER_CONFIG_INVALID',
  'CREDENTIAL_CONFIG_INVALID',
  'CREDENTIAL_CONFIG_REQUIRED',
  'CREDENTIAL_CREATE_FAILED',
  'CREDENTIAL_DEFAULT_CONFLICT',
  'CREDENTIAL_DISABLED',
  'CREDENTIAL_DISABLED_DEFAULT',
  'CREDENTIAL_ENDPOINT_INVALID',
  'CREDENTIAL_ENDPOINT_REQUIRED',
  'CREDENTIAL_ENV_NAME_INVALID',
  'CREDENTIAL_KEY_ROTATED',
  'CREDENTIAL_NAME_INVALID',
  'CREDENTIAL_NAME_TAKEN',
  'CREDENTIAL_NEEDS_REAUTH',
  'CREDENTIAL_NONE_CONFIGURED',
  'CREDENTIAL_NOT_FOUND',
  'CREDENTIAL_PATCH_EMPTY',
  'CREDENTIAL_REFRESH_FAILED',
  'CREDENTIAL_SECRET_INVALID',
  'CREDENTIAL_SECRET_REQUIRED',
  'CREDENTIAL_SHAPE_INVALID',
  'SYNC_CONFIG_NOT_FOUND',
  // Membership, ownership and passkeys — the organization settings doors.
  'CROSS_ORG_TARGET',
  'DUPLICATE_MEMBER',
  'MEMBER_ADD_FAILED',
  'MEMBER_ALREADY_OWNER',
  'MEMBER_CREATOR_ROLE_IMMUTABLE',
  'MEMBER_LAST_ADMIN',
  'MEMBER_NOT_FOUND',
  'MEMBER_OWNER_REMOVAL_FORBIDDEN',
  'MEMBER_OWNER_ROLE_ASSIGN_FORBIDDEN',
  'MEMBER_OWNER_ROLE_IMMUTABLE',
  'MEMBER_SELF_REMOVAL_FORBIDDEN',
  'OWNERSHIP_TRANSFER_FORBIDDEN',
  'PASSKEY_NOT_FOUND',
  'TARGET_NOT_FOUND',
  // Approvals, reviews and competence grants — interactive governance.
  'APPROVAL_TOO_SOON',
  'REASON_REQUIRED',
  'REQUESTER_NO_LONGER_ADMIN',
  'REQUEST_NOT_FOUND',
  'REQUEST_NOT_PENDING',
  'REVIEW_COMPETENCE_REQUIRED',
  'REVIEW_INDEPENDENT_REVIEWER_REQUIRED',
  'SELF_APPROVAL_BLOCKED',
  // Legal holds and matters, retention floors, configuration versions.
  'CONFIG_VERSION_CONFLICT',
  'HOLD_NOT_FOUND',
  'LEGAL_HOLD_ALREADY_ACTIVE',
  'LEGAL_HOLD_ALREADY_RELEASED',
  'LEGAL_HOLD_RELEASE_ALREADY_PENDING',
  'MATTER_NOT_FOUND',
  'RETENTION_BELOW_FLOOR',
  // Spend gates the chat and automation lanes raise on the app doors.
  'BUDGET_EXCEEDED',
  'COST_LIMIT',
  'COST_WARNING',
  // Chat threads: sharing a thread with its project is the app's own toggle
  // (no REST body carries `isShared`), and the write-scope check fires in
  // the detached REST turn job, where the accepted send is dropped without
  // an error row (the docs say so) — neither ever reaches the wire.
  'THREAD_NOT_IN_PROJECT',
  'THREAD_SCOPE_CHANGED',
  // Conversations: a native reply is queued by the app's Inbox composer
  // (`replyToConversation` → `queueApiReply`); REST only claims, fails,
  // acknowledges, lists and retries what the app queued.
  'REPLY_INVALID',
  'REPLY_LIMITS',
  // Skills: the REST body's visibility enum never carries `private`, and
  // the file layer minting one is the only path to this code; the zip
  // upload lane (`STORAGE_*`) is the app's, REST takes the body as text.
  'SKILL_PRIVATE_RETIRED',
  'STORAGE_NOT_FOUND',
  'STORAGE_NOT_OWNED',
  // Uploads: the REST bind proves ownership through its own
  // `rest_upload_intents` consume (`registerUpload` with the external
  // gate), sizes the blob from the store's HEAD and binds a fresh row, so
  // the app's intent, size and scope refusals cannot fire from it.
  'UPLOAD_BLOB_INVALID',
  'UPLOAD_NOT_OWNED',
  'UPLOAD_SCOPE_CONFLICT',
  // Memories, message limits and text-to-speech — app-only lanes.
  'EMPTY_MEMORY',
  'MEMORIES_DISABLED',
  'MESSAGE_CHAR_LIMIT',
  'TTS_CHUNK_LIMIT',
  'TTS_EMPTY_TEXT',
  'TTS_TEXT_TOO_LONG',
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
    // skill body as text and never reaches them — nor the app-only codes
    // the map answers for the same lane.
    const bundleOnly: ReadonlySet<string> = new Set(SKILL_BUNDLE_REFUSAL_CODES);
    const unregistered = Object.keys(SKILL_ERROR_STATUS).filter(
      (code) =>
        !isRestErrorCode(code) &&
        !bundleOnly.has(code) &&
        !APP_ONLY_CODES.has(code),
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
