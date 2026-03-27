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
} as const;

type SystemMsgTag = (typeof SYSTEM_MSG_TAG)[keyof typeof SYSTEM_MSG_TAG];

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
};

export function getSystemMessageDisplay(
  tag: SystemMsgTag | null,
): SystemMessageDisplay {
  if (!tag) return 'info';
  return DISPLAY_MAP[tag];
}
