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
    for (const detector of DETECTORS) {
      const found = detector.detect(text);
      if (found === null) continue;
      if (detector.filterPlaceholders && isPlaceholder(found)) {
        logger.debug(`secret scan ignored a placeholder (${detector.label})`);
        continue;
      }
      logger.warn(
        `file refused by the secret scan (${detector.label}, ${found.length} characters)`,
      );
      return {
        rejected: true,
        reason: `This file looks like it contains a credential (${detector.label}). Remove it and upload the file again.`,
      };
    }
  } catch (err) {
    logger.error(`secret scan failed, allowing the file: ${describe(err)}`);
    return ALLOWED;
  }

  return ALLOWED;
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
export function entropyPerChar(value: string): number {
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
