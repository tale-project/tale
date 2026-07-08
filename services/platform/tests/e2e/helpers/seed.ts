/**
 * Fixture content seeded into every org from `fixtures/config/default/`. These
 * are NOT translated UI copy — they are fixture literals (filenames /
 * display names), so they stay constants here (shared by the specs and the
 * worker-org bootstrap) rather than going through `t()`. Rename-safety lives in
 * one place.
 */

/** Seeded agent — `fixtures/config/default/agents/assistant.json`. */
export const SEEDED_AGENT_SLUG = 'assistant';
export const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

/** Seeded autoInstall prompt — `fixtures/config/default/prompts/summarize-text.json`. */
export const SEEDED_PROMPT_TITLE = 'Summarize Text';

/** Seeded start-only workflow — `fixtures/config/default/workflows/test.json`. */
export const SEEDED_WORKFLOW_NAME = 'test';
