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

/** Seeded org-custom AI provider — `fixtures/config/default/providers/e2e-mock.json`.
 * A custom (not shipped) connector, so it appears on the providers settings
 * page only AFTER the org scaffold copies the fixture — which is why the
 * worker bootstrap waits on it as the "scaffold complete" gate. */
export const SEEDED_PROVIDER_DISPLAY_NAME = 'E2E Mock Provider';

/** Seeded autoInstall prompt — `fixtures/config/default/prompts/summarize-text.json`. */
export const SEEDED_PROMPT_TITLE = 'Summarize Text';

/** Seeded start-only workflow — `fixtures/config/default/workflows/test.json`. */
export const SEEDED_WORKFLOW_NAME = 'test';
