export const ILLEGAL_CONTENT_RE = /[\n\r<>`\x00-\x1f\x7f]/;

// Same as ILLEGAL_CONTENT_RE but allows LF (0x0a). For multi-line fields like
// customInstructions; callers must normalize CRLF / lone CR → LF before testing
// (lone CR is still rejected by the \x00-\x09 / \x0b-\x1f range).
export const CUSTOM_INSTRUCTIONS_ILLEGAL_RE = /[<>`\x00-\x09\x0b-\x1f\x7f]/;

export const MEMORY_CONTENT_MAX_TOKENS = 200;

export const CUSTOM_INSTRUCTIONS_MAX_CHARS = 4000;
export const CUSTOM_INSTRUCTIONS_MAX_TOKENS = 800;

export const PROPOSAL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
export const SOFT_DELETE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
