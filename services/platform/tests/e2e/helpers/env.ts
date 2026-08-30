/**
 * Run-mode + base URL + the suite's named timeout budget, in one place so no
 * spec hardcodes a raw millisecond literal. The old suite scattered 329
 * `60_000`/`120_000` hard deadlines on the *wrong* signal (a 120s text-visible
 * race instead of polling the authoritative "generation done" state); these
 * constants replace them with a small, honest set tuned to the hermetic stack
 * (the mock LLM streams a canned reply in ~150ms).
 */

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * A 0.5 entity id in a URL path. App rows use `gen_random_uuid()` stored as
 * text (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`); Better Auth / leftover
 * Convex ids stay unhyphenated. The old `[A-Za-z0-9]{16,}` pattern dies on
 * the first hyphen and `waitForURL` times out after a successful create.
 */
export const ENTITY_ID = '[A-Za-z0-9-]{16,}';

/** Mock-LLM mode is the default; `E2E_MOCK_LLM=0` targets a live stack. */
export function isMockLlmMode(): boolean {
  return process.env.E2E_MOCK_LLM !== '0';
}

export const TIMEOUT = {
  /**
   * First navigation in a fresh worker can hit a cold Vite route compile, so
   * the very first paint gets a generous ceiling. Used only for the initial
   * `goto` + shell-visible assertion in a spec.
   */
  FIRST_PAINT: 60_000,
  /** A subsequent in-app route commit (`waitForURL`) once the worker is warm. */
  NAV: 30_000,
  /** An element/text becoming visible after an already-committed navigation. */
  VISIBLE: 20_000,
  /**
   * A chat turn reaching a terminal state. Poll the Send⇄Stop toggle (the
   * authoritative `isGenerating` signal) — 200× the mock's ~150ms reply, with
   * head-room for CI jitter, instead of the old 120s text-visibility race.
   */
  REPLY: 30_000,
  /** Save → reload → assert the persisted field rehydrated. */
  PERSIST: 20_000,
  /**
   * A workflow execution subscription reaching `completed`. The one place a
   * larger ceiling is justified (a real workflow run, not a single LLM turn).
   */
  EXECUTION: 90_000,
} as const;
