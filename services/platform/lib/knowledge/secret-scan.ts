/**
 * The pre-ingestion secret scan.
 *
 * A knowledge corpus is read back by agents and pasted into model context, so a
 * credential that gets indexed is a credential that will eventually be spoken
 * aloud — to a chat user, into an automation's output, or to whatever the model
 * calls next. Deleting the file afterwards does not undo that. So a file is
 * scanned BEFORE it is chunked, and a match refuses the whole upload rather
 * than redacting part of it: a partially-scrubbed secret is still a secret, and
 * the person uploading is the only one who can say what the file should have
 * contained instead.
 *
 * Two kinds of detector, with deliberately different treatment:
 *
 *  - **shaped credentials** — an AWS access key id, a PEM private key block, a
 *    JSON Web Token. These have a syntax nothing else has, so a match is a
 *    match and no filter applies to it.
 *  - **a keyword assignment** — a long, high-entropy literal assigned to a name
 *    like `api_key` or `password`. That heuristic is what catches the secrets
 *    with no fixed shape, and it is also what fires on documentation. It is
 *    therefore filtered against the placeholder vocabulary people actually
 *    write — `your-api-key-here`, `********`, `${env.TOKEN}`, `config.token` —
 *    before it can reject anything.
 *
 * Scanning FAILS OPEN. If the decoder or a detector throws, the file is
 * allowed and the failure is logged: this is a guard on top of the
 * organization's own judgement about what it uploads, and a scanner bug must
 * not become an outage that blocks every upload.
 */

import { logger } from './logger';

export interface SecretScanResult {
  /** True when the file must not be indexed. */
  readonly rejected: boolean;
  /** What was found, in words a person can act on. Never the value itself. */
  readonly reason: string | null;
}

const ALLOWED: SecretScanResult = { rejected: false, reason: null };

/** Words that are placeholders, not secrets. */
const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  '',
  'null',
  'none',
  'nil',
  'undefined',
  'true',
  'false',
  'redacted',
  'placeholder',
  'example',
  'changeme',
  'xxx',
  'xxxx',
  'xxxxxxxx',
  'tbd',
  'todo',
  'fixme',
  'n/a',
]);

const PLACEHOLDER_SHAPES: readonly RegExp[] = [
  // `your-api-key`, `example_token`, `dummy-secret`.
  /^(?:your|my|sample|example|test|fake|dummy|demo)[-_].+/i,
  // `token-goes-here`, `key_placeholder`, `secret-value`.
  /.+[-_](?:here|placeholder|example|sample|value|goes-here)$/i,
];

/** `config.apiKey`, `process.env.TOKEN`, `this.secret` — a reference to a
 * secret, not the secret. */
const MEMBER_ACCESS = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

/** `********` and friends — already masked. */
const STAR_MASK = /^\*+$/;

/** `${env.TOKEN}`, `{{secret}}`, `<your token>` — a template hole. */
const TEMPLATE_HOLE = /\$\{.*\}|^<.+>$|\{\{.+\}\}/;

const AWS_KEY_ID =
  /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16})\b/;
const PEM_PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const JSON_WEB_TOKEN =
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

/** `api_key = "…"`, `password: …`, `token=…`. */
const KEYWORD_ASSIGNMENT =
  /(?:api[_-]?key|secret|password|passwd|pwd|token|auth)\s*[:=]\s*(.+)/gi;

const HEX = /^[0-9a-fA-F]+$/;
const BASE64ISH = /^[A-Za-z0-9+/=_-]+$/;

/** Shortest literal that could plausibly be a real credential. */
const MIN_SECRET_LENGTH = 12;

/** Length at which a hex or base64 literal stops looking like an identifier. */
const MIN_ENCODED_LENGTH = 16;

/** Bits of entropy per character above which a base64-ish literal is random
 * rather than words. */
const MIN_ENTROPY = 3.5;

interface Detector {
  readonly label: string;
  /** Whether the placeholder filter applies to what this detector returns. */
  readonly filterPlaceholders: boolean;
  detect(text: string): string | null;
}

const DETECTORS: readonly Detector[] = [
  {
    label: 'AWS access key',
    filterPlaceholders: false,
    detect: (text) => AWS_KEY_ID.exec(text)?.[1] ?? null,
  },
  {
    label: 'private key',
    filterPlaceholders: false,
    detect: (text) => (PEM_PRIVATE_KEY.test(text) ? 'PRIVATE KEY' : null),
  },
  {
    label: 'JSON Web Token',
    filterPlaceholders: false,
    detect: (text) => JSON_WEB_TOKEN.exec(text)?.[0] ?? null,
  },
  {
    label: 'secret keyword',
    filterPlaceholders: true,
    detect: (text) => {
      KEYWORD_ASSIGNMENT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = KEYWORD_ASSIGNMENT.exec(text)) !== null) {
        const value = unquote(match[1]);
        if (value.length < MIN_SECRET_LENGTH || isPlaceholder(value)) continue;
        const looksHex = HEX.test(value) && value.length >= MIN_ENCODED_LENGTH;
        const looksEncoded =
          BASE64ISH.test(value) &&
          value.length >= MIN_ENCODED_LENGTH &&
          entropyPerChar(value) >= MIN_ENTROPY;
        if (looksHex || looksEncoded) return value;
      }
      return null;
    },
  },
];

/** What a detector found: which one, counted from the first, and how long
 * the literal is. Never the literal. */
interface Detection {
  readonly detector: number;
  readonly length: number;
}

/**
 * The first detector, in their order, that finds a credential in `text`,
 * among the first `among` of them.
 */
function firstDetection(
  text: string,
  among: number = DETECTORS.length,
): Detection | null {
  for (let index = 0; index < among; index += 1) {
    const detector = DETECTORS[index];
    if (detector === undefined) break;
    const found = detector.detect(text);
    if (found === null) continue;
    if (detector.filterPlaceholders && isPlaceholder(found)) {
      logger.debug(`secret scan ignored a placeholder (${detector.label})`);
      continue;
    }
    return { detector: index, length: found.length };
  }
  return null;
}

function refusal(detection: Detection): SecretScanResult {
  const label = DETECTORS[detection.detector]?.label ?? 'credential';
  logger.warn(
    `file refused by the secret scan (${label}, ${detection.length} characters)`,
  );
  return {
    rejected: true,
    reason: `This file looks like it contains a credential (${label}). Remove it and upload the file again.`,
  };
}

/**
 * Scan a file's bytes before it is indexed.
 *
 * The reason names the KIND of credential found, never the value — a rejection
 * message is shown to a user and written to a log, and both are places the
 * secret must not end up.
 */
export function scanForSecrets(bytes: Uint8Array): SecretScanResult {
  let text: string;
  try {
    // Non-fatal decoding: a binary file becomes replacement characters rather
    // than an exception, and the detectors simply find nothing in it.
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (err) {
    logger.error(
      `secret scan could not read the file, allowing it: ${describe(err)}`,
    );
    return ALLOWED;
  }

  try {
    const detection = firstDetection(text);
    return detection === null ? ALLOWED : refusal(detection);
  } catch (err) {
    logger.error(`secret scan failed, allowing the file: ${describe(err)}`);
    return ALLOWED;
  }
}

/** How much text is gathered before a part of it is scanned. */
const SCAN_PIECE_CHARS = 1024 * 1024;

/** How many line ends of a piece, from its last one back, are tried for a
 * place to cut before more text is waited for. */
const CUT_TRIES = 512;

/** How much white space before a line end is looked past to see what the
 * line ends with. Past that, what it ends with cannot be told. */
const CUT_LOOKBACK_CHARS = 96;

/** How much of what a line ends with is looked at: more than the longest
 * name a credential is assigned to. */
const NAME_CHARS = 16;

/** A line that ends where an assignment could go on: with the name a
 * credential is assigned to, or with the `:` or `=` after it. */
const OPEN_ASSIGNMENT =
  /(?:api[_-]?key|secret|password|passwd|pwd|token|auth|[:=])$/i;

/** The characters no detector's literal runs across: the ones `.` does not
 * match. */
function isLineEnd(unit: number): boolean {
  return unit === 0x0a || unit === 0x0d || unit === 0x2028 || unit === 0x2029;
}

/**
 * Where `piece` can be cut so that no detector's match runs across the cut:
 * the index after a line end, or 0 when it holds no such place. `before`
 * is the end of the text that came before the piece, and `atStart` whether
 * that is all of it.
 *
 * Three of the detectors match inside one line. The keyword assignment
 * alone can run over a line end, through the white space around its `:`
 * or `=` (`password:` on one line, its value on the next). So a line end is
 * a place to cut unless what precedes it, white space aside, is such a name
 * or sign — or lies further back than is looked.
 */
function safeCut(before: string, piece: string, atStart: boolean): number {
  const reach = CUT_LOOKBACK_CHARS + NAME_CHARS;
  let tries = 0;
  for (let at = piece.length - 1; at >= 0 && tries < CUT_TRIES; at -= 1) {
    if (!isLineEnd(piece.charCodeAt(at))) continue;
    tries += 1;
    // What precedes the line end, as far back as is looked.
    const seen =
      at >= reach
        ? piece.slice(at - reach, at)
        : (before + piece.slice(0, at)).slice(-reach);
    const said = seen.trimEnd();
    if (said === '') {
      // White space as far as is looked. From the very start of the text
      // there is nothing before it to run on from; anywhere else, what the
      // line before ended with cannot be told.
      if (atStart && seen.length < reach) return at + 1;
      continue;
    }
    // More white space than is looked past: what is left of the line is too
    // little to tell a name by, where a name was cut short by the looking.
    if (seen.length - said.length > CUT_LOOKBACK_CHARS) continue;
    if (!OPEN_ASSIGNMENT.test(said)) return at + 1;
  }
  return 0;
}

/**
 * The same scan for a file that is read a piece at a time: its text is
 * pushed as it is decoded, and the verdict is asked for at its end. The
 * verdict is the one {@link scanForSecrets} gives for the whole file.
 *
 * The text is scanned in parts cut at line ends that no credential can run
 * across, so what is held is the part being gathered, and never the file
 * (tale-project/tale#4942). Each piece is looked through for such a line
 * end once, as it comes: a text with none for megabytes on end, a minified
 * file or one whose lines every one end in a `:`, is gathered whole, and
 * gathering it costs its length, not its length times its pieces.
 */
export class SecretScanner {
  /** The text gathered and not yet scanned, in the pieces it came in. */
  private pieces: string[] = [];
  private gathered = 0;
  /** The end of all the text pushed so far, as far back as a cut looks. */
  private before = '';
  /** Whether `before` is all the text pushed so far. */
  private atStart = true;
  private best: Detection | null = null;
  private failed = false;

  constructor(private readonly pieceChars: number = SCAN_PIECE_CHARS) {}

  /** Take the next piece of the file's text. */
  push(text: string): void {
    if (this.settled() || text === '') return;
    const reach = CUT_LOOKBACK_CHARS + NAME_CHARS;
    const cut =
      this.gathered + text.length >= this.pieceChars
        ? safeCut(this.before, text, this.atStart)
        : 0;
    if (cut > 0) {
      this.pieces.push(text.slice(0, cut));
      const part = this.pieces.join('');
      const rest = text.slice(cut);
      this.pieces = rest === '' ? [] : [rest];
      this.gathered = rest.length;
      this.scan(part);
    } else {
      this.pieces.push(text);
      this.gathered += text.length;
    }
    if (this.atStart && this.before.length + text.length > reach) {
      this.atStart = false;
    }
    this.before = (this.before + text).slice(-reach);
  }

  /** How much text is gathered and not yet scanned, in UTF-16 units. */
  get heldChars(): number {
    return this.gathered;
  }

  /** The verdict on everything pushed. */
  end(): SecretScanResult {
    if (!this.settled()) this.scan(this.pieces.join(''));
    this.pieces = [];
    this.gathered = 0;
    if (this.failed || this.best === null) return ALLOWED;
    return refusal(this.best);
  }

  /** Whether nothing pushed from here on can change the verdict: the scan
   * failed, which allows the file, or the first detector found something. */
  private settled(): boolean {
    return this.failed || this.best?.detector === 0;
  }

  private scan(part: string): void {
    try {
      // Only a detector that comes before the one that already found
      // something can change the verdict.
      const found = firstDetection(part, this.best?.detector);
      if (found !== null) this.best = found;
    } catch (err) {
      logger.error(`secret scan failed, allowing the file: ${describe(err)}`);
      this.failed = true;
    }
  }
}

/** Whether a detected literal is a stand-in rather than a real credential. */
export function isPlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  const stripped = unquote(value);
  if (stripped === '') return true;
  const lowered = stripped.toLowerCase();
  if (PLACEHOLDER_WORDS.has(lowered)) return true;
  if (STAR_MASK.test(stripped)) return true;
  for (const shape of PLACEHOLDER_SHAPES) if (shape.test(lowered)) return true;
  if (TEMPLATE_HOLE.test(stripped)) return true;
  return MEMBER_ACCESS.test(stripped);
}

/** Shannon entropy in bits per character — how random a literal looks. */
function entropyPerChar(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .trim();
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
