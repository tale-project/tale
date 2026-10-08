/**
 * The document the blank-automation wizard saves: one agent node carrying
 * the equipment the wizard collected, its text as the automation's output.
 * The harness and anything else are refined on the canvas afterward.
 *
 * A module of its own so the shipped-document corpus
 * (`lib/engine/core/analysis/corpus.test.ts`) validates exactly what the
 * wizard writes: a new rule that refuses it is a regression.
 */

import type { Automation } from '../engine/core/types';

export interface BlankAutomationChoices {
  /** The automation's slug, which is its document name. */
  slug: string;
  model: string;
  /** The provider that serves `model`; empty when none was picked. */
  modelProvider: string;
  prompt: string;
  skills: readonly string[];
  connectors: readonly string[];
  tools: readonly string[];
  secrets: readonly string[];
}

/**
 * The one-agent scaffold. The model pick stores the PAIR (`model` +
 * `modelProvider`), so the run is served — and billed — by exactly the
 * provider on screen instead of whichever connector a walk reaches first.
 */
export function blankAutomationDocument(
  choices: BlankAutomationChoices,
): Automation {
  const { skills, connectors, tools, secrets } = choices;
  return {
    version: 1,
    name: choices.slug,
    nodes: [
      {
        id: 'agent',
        type: 'agent',
        model: choices.model,
        ...(choices.modelProvider !== '' && {
          modelProvider: choices.modelProvider,
        }),
        prompt: choices.prompt.trim(),
        ...(skills.length > 0 && { skills: [...skills] }),
        ...(connectors.length > 0 && { connectors: [...connectors] }),
        ...(tools.length > 0 && { tools: [...tools] }),
        ...(secrets.length > 0 && { secrets: [...secrets] }),
      },
    ],
    output: '{{ nodes.agent.output.text }}',
  };
}
