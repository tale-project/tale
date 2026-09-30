import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Page cursors are SIGNED: `<position>.<tag>`, the tag an HMAC over the
 * list's scope (its name and the organization) and the position. A
 * consumer passes `continueCursor` back unchanged, so the format is opaque
 * to it — and a token this list never answered (a synthesised position,
 * another list's or another organization's cursor, a hand-edited one) is
 * refused instead of being executed as a position: a well-formed but
 * fabricated keyset cursor used to read as page one, the silent restart the
 * API reference promises never happens.
 *
 * One codec for every paged surface, so no family invents its own format:
 * the REST lists (`rest/shared.ts`, which re-exports these) and the agent
 * workspace tools (`node_only/sandbox/workspace_domain_tools.ts`). A list
 * name is the scope a cursor redeems in, so the families keep apart by name
 * alone — a REST list is never named `agent:…`.
 *
 * The key derives from the deployment's `INSTANCE_SECRET` (the same root
 * as the WebDAV app-password key, so every replica of a colour and both
 * colours of a rollout agree), else from `BETTER_AUTH_SECRET`; a bare dev
 * process with neither signs with a public constant — cursors are
 * positions, not credentials, so the constant costs nothing but provenance.
 */
const CURSOR_TAG_BYTES = 16;
let cursorKeyCache: Buffer | null = null;

function cursorKey(): Buffer {
  if (cursorKeyCache !== null) return cursorKeyCache;
  const root =
    process.env.INSTANCE_SECRET ??
    process.env.BETTER_AUTH_SECRET ??
    'tale-dev-cursor-key';
  cursorKeyCache = createHash('sha256')
    .update(`${root}:rest-cursor:v1`)
    .digest();
  return cursorKeyCache;
}

/** Test seam: forget the derived key so a changed secret is picked up. */
export function resetCursorKeyForTests(): void {
  cursorKeyCache = null;
}

function cursorTag(scope: string, position: string): string {
  return createHmac('sha256', cursorKey())
    .update(`${scope}\n${position}`)
    .digest()
    .subarray(0, CURSOR_TAG_BYTES)
    .toString('base64url');
}

/** The signed cursor of `list` in `organizationId` for `position` — the
 * context-free form the routes' `mintCursor` and the tests share. */
export function mintCursorFor(
  organizationId: string,
  list: string,
  position: string,
): string {
  return `${position}.${cursorTag(`${list}:${organizationId}`, position)}`;
}

/** The position inside a cursor `list` in `organizationId` answered, or
 * null for a token that is not one of its own (constant-time comparison). */
export function verifyCursorFor(
  organizationId: string,
  list: string,
  token: string,
): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const position = token.slice(0, dot);
  const tag = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(
    cursorTag(`${list}:${organizationId}`, position),
  );
  return tag.length === expected.length && timingSafeEqual(tag, expected)
    ? position
    : null;
}
