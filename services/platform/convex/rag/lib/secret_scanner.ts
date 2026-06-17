'use node';

/**
 * Pre-ingestion secret scanner.
 *
 * CONTRACT-FIDELITY NOTE: the Python implementation wrapped Yelp's
 * `detect-secrets` library (a large plugin pipeline + entropy detectors).
 * That library has no maintained JS equivalent, so this is a hand-rolled
 * detector that reproduces the behaviour the test suite pins:
 *
 * - specific-provider detectors (AWS access keys, PEM/OpenSSH private keys,
 *   JWTs);
 * - a keyword detector that flags a high-entropy / long literal assigned to a
 *   key/secret/password/token-shaped name;
 * - the same placeholder + member-access + templated-value noise filter the
 *   Python post-filter applied.
 *
 * It is deliberately narrower than `detect-secrets`; full parity will be
 * revisited against the live stack. Detector errors fail OPEN (log + allow).
 */

import { logger } from '../../lib/knowledge/logger';

export interface SecretScanResult {
  rejected: boolean;
  reason: string | null;
}

// Bareword placeholders the keyword detector would otherwise flag.
const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
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

const PLACEHOLDER_PATTERNS: RegExp[] = [
  // `your-api-key-here`, `my_secret`, `example-token`, etc.
  /^(?:your|my|sample|example|test|fake|dummy|demo)[-_].+/i,
  // `...-goes-here`, `...-placeholder`, `...-example`.
  /.+[-_](?:here|placeholder|example|sample|value|goes-here)$/i,
];

// Member-access chains (`config.apiKey`, `process.env.FOO`, `this.token`).
const MEMBER_ACCESS_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

// A masked value such as `********`.
const STAR_MASK_RE = /^\*+$/;

/** True when the detected value is a known placeholder, not a real secret. */
function isNoise(secretValue: string | null | undefined): boolean {
  if (!secretValue) {
    return true;
  }
  const stripped = secretValue.trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!stripped) {
    return true;
  }
  const lowered = stripped.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lowered)) {
    return true;
  }
  if (STAR_MASK_RE.test(stripped)) {
    return true;
  }
  if (PLACEHOLDER_PATTERNS.some((p) => p.test(lowered))) {
    return true;
  }
  // Templated values: `${env.TOKEN}`, `${process.env.KEY}`, `<foo>`, `{{x}}`.
  if (/\$\{.*\}|^<.+>$|\{\{.+\}\}/.test(stripped)) {
    return true;
  }
  return MEMBER_ACCESS_RE.test(stripped);
}

/** Shannon entropy of a string in bits per character. */
function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

interface Detector {
  type: string;
  detect: (text: string) => string | null;
  // Whether the post-detection noise filter applies. Specific-provider
  // detectors (AWS/PrivateKey/JWT) return a typed secret that must never be
  // noise-filtered — only the keyword detector's free-form value is.
  applyNoiseFilter: boolean;
}

const AWS_RE = /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16})\b/;
const PEM_PRIVATE_KEY_RE =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;

// `name = "value"`, `name: value`, `name=value` for key-shaped names.
const KEYWORD_ASSIGN_RE =
  /(?:api[_-]?key|secret|password|passwd|pwd|token|auth)\s*[:=]\s*(.+)/gi;

const HEX_RE = /^[0-9a-fA-F]+$/;
const BASE64_RE = /^[A-Za-z0-9+/=_-]+$/;

const DETECTORS: Detector[] = [
  {
    type: 'AWS Access Key',
    applyNoiseFilter: false,
    detect: (text) => {
      const m = AWS_RE.exec(text);
      return m ? m[1] : null;
    },
  },
  {
    type: 'Private Key',
    applyNoiseFilter: false,
    detect: (text) => (PEM_PRIVATE_KEY_RE.test(text) ? 'PRIVATE KEY' : null),
  },
  {
    type: 'JSON Web Token',
    applyNoiseFilter: false,
    detect: (text) => {
      const m = JWT_RE.exec(text);
      return m ? m[0] : null;
    },
  },
  {
    type: 'Secret Keyword',
    applyNoiseFilter: true,
    detect: (text) => {
      KEYWORD_ASSIGN_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = KEYWORD_ASSIGN_RE.exec(text)) !== null) {
        const rawValue = match[1].trim();
        const value = rawValue.replace(/^['"`]+|['"`]+$/g, '').trim();
        if (isNoise(value) || value.length < 12) {
          continue;
        }
        // High entropy OR long hex/base64 literal assigned to a key name.
        const isHex = HEX_RE.test(value) && value.length >= 16;
        const isBase64 =
          BASE64_RE.test(value) &&
          value.length >= 16 &&
          shannonEntropy(value) >= 3.5;
        if (isHex || isBase64) {
          return value;
        }
      }
      return null;
    },
  },
];

/**
 * Scan file content for credential patterns. Returns `{ rejected, reason }`.
 * When `rejected` is true the upload must not be indexed. Detector errors
 * fail open — log and allow.
 */
export function scanFileForSecrets(fileBytes: Uint8Array): SecretScanResult {
  let text: string;
  try {
    // Best-effort UTF-8 decode (non-fatal), mirroring detect-secrets' file read.
    text = new TextDecoder('utf-8', { fatal: false }).decode(fileBytes);
  } catch (err) {
    logger.error(
      `Secret scan failed; allowing file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rejected: false, reason: null };
  }

  try {
    for (const detector of DETECTORS) {
      const value = detector.detect(text);
      if (value === null) {
        continue;
      }
      if (detector.applyNoiseFilter && isNoise(value)) {
        logger.info(
          `Secret scanner: filtered placeholder match (type=${detector.type})`,
        );
        continue;
      }
      logger.warn(
        `File rejected by secret scanner (type=${detector.type}, value_len=${value.length})`,
      );
      return {
        rejected: true,
        reason: `Potential secret detected: ${detector.type}`,
      };
    }
  } catch (err) {
    logger.error(
      `Secret scan failed; allowing file: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rejected: false, reason: null };
  }

  return { rejected: false, reason: null };
}
