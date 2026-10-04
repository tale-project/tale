// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The binding doors (#4111). A door takes a CLIENT-NAMED blob ref and writes
 * it into a holder: a file row, a document, a task, a queued mail. The
 * rejected-upload reclaim (`claimRejectedUpload`) and the abandoned-upload
 * sweep may take an upload's bytes only while nothing bound it, and each
 * decides in one statement on the upload's intent row
 * (`backend/domains/files/upload-intents.ts`).
 *
 * That statement is race-safe because of the intent row, not because of
 * `blobRefHeld`. Every door STAMPS (`bound_at_ms`) or CONSUMES the row in
 * the transaction that writes its holder, so the claim waits on the door's
 * row lock and then re-reads the row's own `bound_at_ms` and
 * `consumed_at_ms` on the committed version. The holder subqueries get no
 * such re-read: under READ COMMITTED they keep the statement's snapshot. A
 * door that wrote its holder without touching the intent row (or touched it
 * in a transaction of its own) would race the claim, and the claim would
 * delete the bytes the holder was committing.
 *
 * So every call of a proof that touches the intent row is enumerated here,
 * with the handle it runs on and why that is safe. A new call fails until it
 * is listed, and listing it means naming the transaction the proof shares
 * with the holder write. What this cannot see is a door that names a ref
 * with no proof at all; the blob-ref authority checks of
 * `backend:integration` refuse such a door.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOTS = ['backend', 'lib'];

/** The proofs that touch an intent row: every call is a door or a wrapper. */
const PROOFS = new Set([
  'ownsUploadedBlob',
  'firstForeignUpload',
  'consumeUploadIntent',
  'assertOwnedAttachments',
]);

/** The REST ledger's consume, a statement rather than a call. */
const REST_CONSUME = 'UPDATE app.rest_upload_intents SET consumed_at_ms';

interface Door {
  /** Repo-relative to `services/platform`. */
  file: string;
  /** The enclosing function (the variable a function expression is bound to). */
  fn: string;
  proof: string;
  /** The first argument of the call (the handle the proof runs on). */
  handle: string;
  /**
   * `in-tx`: the proof stamps or consumes in the holder's own transaction.
   * `early-refusal`: no write (`stamp: false`); a stamping door re-proves.
   * `bundle-lane`: a staged bundle's consume; the lane binds no holder.
   * `wrapper`: a pass-through over its caller's handle.
   */
  kind: 'in-tx' | 'early-refusal' | 'bundle-lane' | 'wrapper';
  /** Why the intent row and the holder write cannot race. */
  why: string;
}

const DOORS: readonly Door[] = [
  {
    file: 'backend/domains/files/service.ts',
    fn: 'registerUpload',
    proof: 'consumeUploadIntent',
    handle: 'tx',
    kind: 'in-tx',
    why: 'consumes the intent in the transaction that inserts the file row',
  },
  {
    file: 'backend/domains/documents/service.ts',
    fn: 'createDocumentFromBlobUpload',
    proof: 'ownsUploadedBlob',
    handle: 'tx',
    kind: 'in-tx',
    why: 'stamps in the transaction that inserts the documents (the multi-bind)',
  },
  {
    file: 'backend/domains/tasks/service.ts',
    fn: 'assertOwnedTaskAttachments',
    proof: 'firstForeignUpload',
    handle: 'tx',
    kind: 'in-tx',
    why: 'stamps in the transaction that writes the task’s attachments',
  },
  {
    file: 'backend/domains/conversations/send.ts',
    fn: 'sendMessageViaConnectorInTx',
    proof: 'assertOwnedAttachments',
    handle: 'tx',
    kind: 'in-tx',
    why: 'stamps in the transaction that inserts the queued mail (reply, compose)',
  },
  {
    file: 'backend/domains/conversations/api-sync.ts',
    fn: 'queueApiReply',
    proof: 'assertOwnedAttachments',
    handle: 'tx',
    kind: 'in-tx',
    why: 'stamps in the transaction that inserts the queued API reply',
  },
  {
    file: 'backend/domains/conversations/api-sync.ts',
    fn: 'synchronizeConversation',
    proof: 'firstForeignUpload',
    handle: 'tx',
    kind: 'in-tx',
    why: 'stamps in the transaction that writes the mirrored messages',
  },
  {
    file: 'backend/domains/conversations/routes.ts',
    fn: 'refuseForeignAttachments',
    proof: 'assertOwnedAttachments',
    handle: 'deps.sql',
    kind: 'early-refusal',
    why: 'the early refusal, `stamp: false`: no write; the send’s transaction proves again and stamps',
  },
  {
    file: 'backend/domains/skills/upload.ts',
    fn: 'uploadSkillBundlePg',
    proof: 'consumeUploadIntent',
    handle: 'sql',
    kind: 'bundle-lane',
    why: 'consumes a staged bundle the lane deletes on every path; it binds no holder',
  },
  {
    file: 'backend/domains/automations/upload.ts',
    fn: 'uploadAutomationPg',
    proof: 'consumeUploadIntent',
    handle: 'sql',
    kind: 'bundle-lane',
    why: 'consumes a staged bundle the lane deletes on every path; it binds no holder',
  },
  {
    file: 'backend/rest/v1-projects.ts',
    // The upload bind's handler, an unnamed route callback in the factory.
    fn: 'createProjectRestRoutes',
    proof: REST_CONSUME,
    handle: 'tx',
    kind: 'in-tx',
    why: 'consumes the REST intent in the transaction that writes the file row and the document',
  },
  // Wrappers: they run on the handle their caller passes.
  {
    file: 'backend/domains/files/upload-intents.ts',
    fn: 'firstForeignUpload',
    proof: 'ownsUploadedBlob',
    handle: 'sql',
    kind: 'wrapper',
    why: 'a wrapper over the caller’s handle',
  },
  {
    file: 'backend/domains/conversations/attachment-ownership.ts',
    fn: 'assertOwnedAttachments',
    proof: 'firstForeignUpload',
    handle: 'sql',
    kind: 'wrapper',
    why: 'a wrapper over the caller’s handle',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (
      !entry.name.endsWith('.ts') ||
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.d.ts') ||
      entry.name.endsWith('.integration.ts') ||
      entry.name === 'integration-check.ts'
    ) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/** The name of the function a node sits in, or `<module>`. */
function enclosingFunction(node: ts.Node): string {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (
      (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) &&
      at.name !== undefined
    ) {
      return at.name.getText();
    }
    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      ts.isVariableDeclaration(at.parent)
    ) {
      return at.parent.name.getText();
    }
  }
  return '<module>';
}

interface Found {
  file: string;
  fn: string;
  proof: string;
  handle: string;
  unstamped: boolean;
}

function findDoors(): Found[] {
  const found: Found[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const full of sourceFiles(path.join(PLATFORM_ROOT, root))) {
      const text = readFileSync(full, 'utf8');
      if (
        ![...PROOFS].some((proof) => text.includes(`${proof}(`)) &&
        !text.includes(REST_CONSUME)
      ) {
        continue;
      }
      const file = path.relative(PLATFORM_ROOT, full).split(path.sep).join('/');
      const tree = ts.createSourceFile(
        full,
        text,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          PROOFS.has(node.expression.text)
        ) {
          const [handle] = node.arguments;
          const options = node.arguments.at(-1);
          found.push({
            file,
            fn: enclosingFunction(node),
            proof: node.expression.text,
            handle: handle?.getText() ?? '',
            unstamped:
              options !== undefined &&
              ts.isObjectLiteralExpression(options) &&
              /\bstamp:\s*false\b/.test(options.getText()),
          });
        }
        if (
          ts.isTaggedTemplateExpression(node) &&
          node.template.getText().replace(/\s+/g, ' ').includes(REST_CONSUME)
        ) {
          found.push({
            file,
            fn: enclosingFunction(node),
            proof: REST_CONSUME,
            handle: node.tag.getText(),
            unstamped: false,
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
  }
  return found;
}

const key = (door: { file: string; fn: string; proof: string }) =>
  `${door.file} · ${door.fn} · ${door.proof}`;

describe('binding doors', () => {
  const found = findDoors();

  it('finds every proof call it enumerates (the walk itself works)', () => {
    expect(found.length).toBeGreaterThanOrEqual(DOORS.length);
  });

  it('lists every call of an intent proof as a door, and nothing else', () => {
    const listed = new Set(DOORS.map(key));
    const unlisted = found.filter((door) => !listed.has(key(door)));
    // A new door: list it with the handle the proof shares with its holder
    // write — or give it a transaction that does.
    expect(unlisted.map(key)).toEqual([]);
    const seen = new Set(found.map(key));
    expect(DOORS.filter((door) => !seen.has(key(door))).map(key)).toEqual([]);
  });

  it('runs each proof on the handle its row declares', () => {
    const declared = new Map(DOORS.map((door) => [key(door), door.handle]));
    const drifted = found
      .filter((door) => declared.get(key(door)) !== door.handle)
      .map((door) => `${key(door)}: ${door.handle}`);
    expect(drifted).toEqual([]);
  });

  it('stamps or consumes in the holder’s transaction, or writes nothing', () => {
    const kinds = new Map(DOORS.map((door) => [key(door), door.kind]));
    const broken = found
      .filter((door) => {
        switch (kinds.get(key(door))) {
          case 'in-tx':
            return door.handle !== 'tx' || door.unstamped;
          case 'early-refusal':
            // A stamp the door commits on its own outlives every later
            // refusal of the send and strands the upload (#4111).
            return !door.unstamped;
          case 'bundle-lane':
            return door.proof !== 'consumeUploadIntent';
          case 'wrapper':
            return !PROOFS.has(door.fn);
          default:
            return true;
        }
      })
      .map(key);
    expect(broken).toEqual([]);
    // The early mail refusal is re-proven, with the stamp, where the queued
    // mail is written.
    for (const fn of ['sendMessageViaConnectorInTx', 'queueApiReply']) {
      expect(
        found.some(
          (door) => door.fn === fn && door.handle === 'tx' && !door.unstamped,
        ),
      ).toBe(true);
    }
  });

  it('admits a chat attachment only while a live file row holds it', () => {
    // The chat door takes no intent: it admits a ref only through a file row
    // that is not trashed — itself a holder, whose registration consumed the
    // intent — so no reclaim can claim what a chat message names.
    const shim = readFileSync(
      path.join(PLATFORM_ROOT, 'backend/domains/chat/shim.ts'),
      'utf8',
    );
    const at = shim.indexOf(
      "'file_metadata/internal_queries:filterStorageIdsReadable'",
    );
    const body = shim.slice(at, shim.indexOf("'file_metadata/", at + 1));
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('FROM app.file_metadata');
    expect(body).toContain("lifecycle_status <> 'trashed'");
  });
});
