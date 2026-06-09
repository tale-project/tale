/**
 * The centralized prompt registry.
 *
 * Every previously-hardcoded LLM prompt is registered here by stable key.
 * Import `renderPrompt` (from `./render`) to materialize a prompt; this module
 * just assembles the `key → PromptEntry` map and derives the `PromptKey` union.
 */

import {
  delegationHeaderEntry,
  delegationIntroEntry,
  delegationOutroEntry,
  plannerFooterEntry,
  plannerHeaderEntry,
  routerScaffoldFooterEntry,
  routerScaffoldHeaderEntry,
} from './entries/routing';
import {
  responseLanguageEntry,
  structuredResponseEntry,
  untrustedContentEntry,
} from './entries/system';
import {
  cronGeneratorEntry,
  improveMessageEntry,
  summarizationFullEntry,
  summarizationIncrementalEntry,
  titleSavedPromptEntry,
  titleThreadEntry,
  translationFieldEntry,
  visionAnalyzerEntry,
  workflowTerminationEntry,
} from './entries/utility';
import type { PromptEntry } from './types';

const ENTRIES = [
  // system (cache-critical prefix members)
  responseLanguageEntry,
  untrustedContentEntry,
  structuredResponseEntry,
  // utility agents
  summarizationFullEntry,
  summarizationIncrementalEntry,
  titleThreadEntry,
  titleSavedPromptEntry,
  translationFieldEntry,
  improveMessageEntry,
  visionAnalyzerEntry,
  cronGeneratorEntry,
  workflowTerminationEntry,
  // routing / delegation scaffolds
  routerScaffoldHeaderEntry,
  routerScaffoldFooterEntry,
  plannerHeaderEntry,
  plannerFooterEntry,
  delegationHeaderEntry,
  delegationIntroEntry,
  delegationOutroEntry,
] as const;

export type PromptKey = (typeof ENTRIES)[number]['key'];

/** key → entry. Frozen so a stray write can't mutate the shared registry. */
export const PROMPT_REGISTRY: Readonly<Record<PromptKey, PromptEntry>> =
  Object.freeze(
    // `Object.fromEntries` widens keys to `string`; narrow back to the derived
    // `PromptKey` union (TS can't track the literal keys through the call).
    Object.fromEntries(ENTRIES.map((entry) => [entry.key, entry])) as Record<
      PromptKey,
      PromptEntry
    >,
  );

/** All registered entries, for integrity tests and tooling. */
export const ALL_PROMPT_ENTRIES: readonly PromptEntry[] = ENTRIES;

export { renderPrompt } from './render';
