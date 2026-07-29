export const SYSTEM_MSG_TAG = {
  APPROVAL_REJECTED: '[APPROVAL_REJECTED]',
  WORKFLOW_CANCELLED: '[WORKFLOW_CANCELLED]',
  WORKFLOW_COMPLETED: '[WORKFLOW_COMPLETED]',
  WORKFLOW_FAILED: '[WORKFLOW_FAILED]',
  WORKFLOW_CREATED: '[WORKFLOW_CREATED]',
  WORKFLOW_STARTED: '[WORKFLOW_STARTED]',
  WORKFLOW_UPDATED: '[WORKFLOW_UPDATED]',
  HUMAN_INPUT_RESPONSE: '[HUMAN_INPUT_RESPONSE]',
  LOCATION_RESPONSE: '[LOCATION_RESPONSE]',
  RESPONSE_INTERRUPTED: '[RESPONSE_INTERRUPTED]',
  TIMEOUT_RECOVERY: '[TIMEOUT_RECOVERY]',
  CONNECTOR_OPERATION_COMPLETED: '[CONNECTOR_OPERATION_COMPLETED]',
  CONNECTOR_OPERATION_FAILED: '[CONNECTOR_OPERATION_FAILED]',
  MODEL_FALLBACK: '[MODEL_FALLBACK]',
  GENERATION_INCOMPLETE: '[GENERATION_INCOMPLETE]',
  STEP_LIMIT_CONTINUED: '[STEP_LIMIT_CONTINUED]',
  STEP_LIMIT_REACHED: '[STEP_LIMIT_REACHED]',
} as const;

export type SystemMsgTag = (typeof SYSTEM_MSG_TAG)[keyof typeof SYSTEM_MSG_TAG];

const TAG_REGEX = /^\[([A-Z][A-Z_]+)\]/;
const KNOWN_TAGS = new Set<string>(Object.values(SYSTEM_MSG_TAG));

export function parseSystemMessageTag(content: string): {
  tag: SystemMsgTag | null;
  body: string;
} {
  const match = content.match(TAG_REGEX);
  if (!match) return { tag: null, body: content };
  const raw = `[${match[1]}]`;
  if (!KNOWN_TAGS.has(raw)) return { tag: null, body: content };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated via KNOWN_TAGS set lookup
  return {
    tag: raw as SystemMsgTag,
    body: content.slice(match[0].length).trimStart(),
  };
}

export type SystemMessageDisplay =
  | 'pill'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

const DISPLAY_MAP: Record<SystemMsgTag, SystemMessageDisplay> = {
  [SYSTEM_MSG_TAG.HUMAN_INPUT_RESPONSE]: 'pill',
  [SYSTEM_MSG_TAG.LOCATION_RESPONSE]: 'pill',
  [SYSTEM_MSG_TAG.WORKFLOW_COMPLETED]: 'info',
  [SYSTEM_MSG_TAG.WORKFLOW_CREATED]: 'info',
  [SYSTEM_MSG_TAG.WORKFLOW_UPDATED]: 'info',
  [SYSTEM_MSG_TAG.RESPONSE_INTERRUPTED]: 'warning',
  [SYSTEM_MSG_TAG.TIMEOUT_RECOVERY]: 'warning',
  [SYSTEM_MSG_TAG.WORKFLOW_FAILED]: 'error',
  [SYSTEM_MSG_TAG.APPROVAL_REJECTED]: 'info',
  [SYSTEM_MSG_TAG.WORKFLOW_CANCELLED]: 'info',
  [SYSTEM_MSG_TAG.WORKFLOW_STARTED]: 'info',
  [SYSTEM_MSG_TAG.CONNECTOR_OPERATION_COMPLETED]: 'info',
  [SYSTEM_MSG_TAG.CONNECTOR_OPERATION_FAILED]: 'error',
  [SYSTEM_MSG_TAG.MODEL_FALLBACK]: 'warning',
  [SYSTEM_MSG_TAG.GENERATION_INCOMPLETE]: 'warning',
  // Step-cap continuations are expected capacity stops on tool-heavy turns,
  // not failures — rendered as neutral info, never a warning.
  [SYSTEM_MSG_TAG.STEP_LIMIT_CONTINUED]: 'info',
  [SYSTEM_MSG_TAG.STEP_LIMIT_REACHED]: 'info',
};

export function getSystemMessageDisplay(
  tag: SystemMsgTag | null,
): SystemMessageDisplay {
  if (!tag) return 'info';
  return DISPLAY_MAP[tag];
}

/**
 * Structured payload carried in a `[MODEL_FALLBACK]` system-message body.
 *
 * The backend writes it machine-readably (URL-encoded values, no localized
 * prose) so the chat UI can render a localized line and the model auto-switch
 * can read `to` reliably — instead of regex-scraping an English sentence.
 */
interface ModelFallbackBody {
  /** The model ref that just failed. */
  from?: string;
  /** The next model ref being attempted ('default' for the tag-default). */
  to?: string;
  /** A `ChatErrorCode`-style reason the previous model failed. */
  reason?: string;
}

export function formatModelFallbackBody(body: ModelFallbackBody): string {
  const parts: string[] = [];
  if (body.from) parts.push(`from=${encodeURIComponent(body.from)}`);
  if (body.to) parts.push(`to=${encodeURIComponent(body.to)}`);
  if (body.reason) parts.push(`reason=${encodeURIComponent(body.reason)}`);
  return parts.join(' ');
}

/**
 * Parse a `[MODEL_FALLBACK]` body. Returns an empty object for legacy bodies
 * (the previous English-sentence format), so callers can fall back gracefully.
 */
export function parseModelFallbackBody(body: string): ModelFallbackBody {
  const result: ModelFallbackBody = {};
  for (const token of body.trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const rawValue = token.slice(eq + 1);
    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    if (key === 'from') result.from = value;
    else if (key === 'to') result.to = value;
    else if (key === 'reason') result.reason = value;
  }
  return result;
}

/**
 * Structured payload carried in a `[GENERATION_INCOMPLETE]` system-message
 * body — written when a turn exhausts its retries without producing a final
 * answer. Machine-readable (URL-encoded tool names, no localized prose) so the
 * chat UI can render a localized warning instead of an English sentence
 * masquerading as the assistant's own words.
 */
interface GenerationIncompleteBody {
  /** Names of the tools the model called during the incomplete turn. */
  tools?: string[];
}

export function formatGenerationIncompleteBody(
  body: GenerationIncompleteBody,
): string {
  return body.tools && body.tools.length > 0
    ? `tools=${body.tools.map((t) => encodeURIComponent(t)).join(',')}`
    : '';
}

/**
 * Structured payload carried in `[STEP_LIMIT_CONTINUED]` /
 * `[STEP_LIMIT_REACHED]` system-message bodies. Machine-readable (no
 * localized prose) so the chat UI renders a localized neutral line.
 * `round` is the 1-based continuation round for CONTINUED, and the number of
 * continuation rounds the turn used for REACHED.
 */
interface StepLimitBody {
  round?: number;
}

export function formatStepLimitBody(body: StepLimitBody): string {
  return body.round !== undefined && body.round > 0
    ? `round=${body.round}`
    : '';
}

export function parseStepLimitBody(body: string): StepLimitBody {
  const result: StepLimitBody = {};
  for (const token of body.trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    if (token.slice(0, eq) !== 'round') continue;
    const value = Number.parseInt(token.slice(eq + 1), 10);
    if (Number.isFinite(value) && value > 0) result.round = value;
  }
  return result;
}

export function parseGenerationIncompleteBody(
  body: string,
): GenerationIncompleteBody {
  const result: GenerationIncompleteBody = {};
  for (const token of body.trim().split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    if (token.slice(0, eq) !== 'tools') continue;
    result.tools = token
      .slice(eq + 1)
      .split(',')
      .filter((t) => t.length > 0)
      .map((t) => {
        try {
          return decodeURIComponent(t);
        } catch {
          return t;
        }
      });
  }
  return result;
}
