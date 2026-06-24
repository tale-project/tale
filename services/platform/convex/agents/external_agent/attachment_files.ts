// Pure, dependency-free contract for delivering chat attachments to a sandboxed
// external agent (Claude Code / OpenCode).
//
// Three call sites must agree on WHERE the files live: the staging action
// (writes them via sessionStageFiles), the prompt preamble (tells the agent the
// paths), and the adapter's `--add-dir` grant (lets the agent read them).
// They all derive their paths from THIS module so they cannot drift apart
// (mirrors steer_files.ts).
//
// Files are staged OUTSIDE the agent's workspace (/user/workspace) so chat
// uploads never pollute the user's project files; they sit on the same
// persistent /user volume and the agent is granted read access via --add-dir.
// On-disk names are the human file names (sanitized + de-duped per turn), NEVER
// the opaque Convex _storage id — so "summarize report.pdf" resolves naturally.

/** The daemon stages workspace-relative paths under WORKSPACE_ROOT=/user. */
const WORKSPACE_ROOT = '/user';
/** Sub-tree (under /user) that holds chat uploads; granted to the agent via
 * `--add-dir /user/uploads`. Outside /user/workspace so it never pollutes the
 * user's project files. */
export const UPLOADS_SUBDIR = 'uploads';
/** Absolute staging root inside the container — the path passed to `--add-dir`. */
export const UPLOADS_ABS_ROOT = `${WORKSPACE_ROOT}/${UPLOADS_SUBDIR}`;

/** Per-turn cap on staged attachments — a runaway/abuse backstop, not a product
 * limit (a typical chat attaches a handful). Extras are surfaced as skipped in
 * the preamble, never silently dropped. */
export const MAX_ATTACHMENTS_PER_TURN = 20;

export interface AttachmentInput {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface PlannedAttachment {
  fileId: string;
  /** Workspace-relative path handed to sessionStageFiles (daemon resolves it
   * under /user → absPath). */
  stagePath: string;
  /** Absolute container path the agent is told about. */
  absPath: string;
  /** Human, sanitized, per-turn-unique on-disk name (never a storage id). */
  diskName: string;
  fileType: string;
}

export interface SkippedAttachment {
  name: string;
  reason: string;
}

export interface AttachmentStagePlan {
  /** Absolute dir holding this turn's uploads (/user/uploads/<promptMessageId>). */
  dirAbs: string;
  planned: PlannedAttachment[];
  /** Attachments dropped before staging (currently: over the per-turn cap). */
  skipped: SkippedAttachment[];
}

/** Reduce an arbitrary upload name to one safe path segment: basename only (no
 * dir components), no control/null bytes, no traversal. Falls back to `file`
 * when nothing usable remains; preserves a sensible extension. */
export function sanitizeAttachmentName(raw: string): string {
  // Basename: drop anything up to the last slash/backslash.
  const base = raw.split(/[/\\]/).pop() ?? '';
  // Drop C0 control chars (incl. NUL — the daemon rejects it outright) + DEL by
  // code point, so a name can never break the path or a shell. Filtering by
  // code point beats a control-char regex (cleaner, no lint suppression).
  const cleaned = Array.from(base)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  // Guard against `.` / `..` / empty so the segment is always a real filename.
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return 'file';
  return cleaned;
}

/** Make `name` unique within `used` by inserting `-N` before the extension. */
function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 2;
  let candidate = `${stem}-${n}${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Restrict the per-turn dir segment to a path-safe token (the message id is
 * already opaque; this just hardens it). */
function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned === '' ? 'turn' : cleaned;
}

/** Plan where each attachment lands. Pure: no I/O — the caller resolves the
 * storage URLs and calls sessionStageFiles with `planned[].stagePath`. */
export function buildAttachmentStagePlan(
  promptMessageId: string,
  attachments: readonly AttachmentInput[],
): AttachmentStagePlan {
  const dirSegment = sanitizeSegment(promptMessageId);
  const dirRel = `${UPLOADS_SUBDIR}/${dirSegment}`;
  const dirAbs = `${UPLOADS_ABS_ROOT}/${dirSegment}`;
  const planned: PlannedAttachment[] = [];
  const skipped: SkippedAttachment[] = [];
  const used = new Set<string>();
  attachments.forEach((att, i) => {
    if (i >= MAX_ATTACHMENTS_PER_TURN) {
      skipped.push({ name: att.fileName, reason: 'too_many' });
      return;
    }
    const diskName = dedupeName(sanitizeAttachmentName(att.fileName), used);
    planned.push({
      fileId: att.fileId,
      stagePath: `${dirRel}/${diskName}`,
      absPath: `${dirAbs}/${diskName}`,
      diskName,
      fileType: att.fileType,
    });
  });
  return { dirAbs, planned, skipped };
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'too_many':
      return `skipped (over the ${MAX_ATTACHMENTS_PER_TURN}-file per-message limit)`;
    case 'too_large':
      return 'skipped (file too large to stage)';
    default:
      return `skipped (${reason})`;
  }
}

/** Build the message preamble that tells the agent where the uploads are. It is
 * prepended to the user's prompt (and becomes the whole prompt when the user
 * sent only files). Skipped files are surfaced explicitly so the agent never
 * assumes a file it cannot read is present. Returns '' when nothing to say. */
export function buildAttachmentPreamble(
  staged: readonly { absPath: string; fileType: string }[],
  skipped: readonly SkippedAttachment[],
): string {
  if (staged.length === 0 && skipped.length === 0) return '';
  const lines: string[] = [];
  if (staged.length > 0) {
    lines.push(
      staged.length === 1
        ? 'The user attached 1 file to this message. It has been saved to the sandbox filesystem at the absolute path below — read it directly with your file tools (images load as vision):'
        : `The user attached ${staged.length} files to this message. They have been saved to the sandbox filesystem at the absolute paths below — read them directly with your file tools (images load as vision):`,
    );
    for (const f of staged) {
      lines.push(`- ${f.absPath} (${f.fileType})`);
    }
  }
  if (skipped.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      'The following attachment(s) could NOT be delivered — do not assume their contents:',
    );
    for (const s of skipped) {
      lines.push(`- ${s.name} — ${reasonText(s.reason)}`);
    }
  }
  return lines.join('\n');
}

/** Combine the user's text with the attachment preamble. The preamble goes
 * AFTER the user's words so their intent stays primary; when there is no text
 * (attachment-only message) the preamble stands alone. */
export function composePromptWithAttachments(
  rawPrompt: string,
  preamble: string,
): string {
  if (preamble === '') return rawPrompt;
  const text = rawPrompt.trim();
  return text === '' ? preamble : `${text}\n\n${preamble}`;
}
