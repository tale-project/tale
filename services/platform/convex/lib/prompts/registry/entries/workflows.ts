/**
 * Workflow-editor dual-view sync prompts (W5b) — the text `specification`
 * ⇄ step-graph round trip in `convex/workflows/specification_actions.ts`.
 */

import type { PromptEntry } from '../types';

export const workflowSpecificationToGraphEntry: PromptEntry = {
  key: 'workflow.specification.to_graph',
  required: ['syntaxReference', 'integrations'],
  usedBy: ['workflows/specification_actions.ts:previewGraphFromSpecification'],
  template: `You are a compiler that turns a natural-language workflow specification into a Tale workflow graph — a \`workflowConfig\` object plus an ordered \`stepsConfig\` array of steps.

## Step syntax reference
{{syntaxReference}}

## Integrations available to this organization
{{integrations}}

## Rules
- Reproduce every step slug, JEXL expression, double-curly-brace template placeholder, and literal prompt string the specification implies EXACTLY as written — never paraphrase a value that looks like code or a template (the step syntax reference above shows the exact placeholder syntax).
- Every step needs a unique \`stepSlug\` (snake_case) and valid \`nextSteps\` pointing at other step slugs in the graph.
- Prefer the simplest graph that satisfies the specification: don't invent steps, integrations, or fields the specification doesn't ask for.
- The graph must start from a \`start\` or \`trigger\` step and every branch must terminate (an \`output\` step, or a dead end the specification describes as intentional).
- Only reference integrations listed above; never invent an integration name.
- Return ONLY the structured workflowConfig + stepsConfig — no commentary.`,
};

export const workflowSpecificationFromGraphEntry: PromptEntry = {
  key: 'workflow.specification.from_graph',
  usedBy: ['workflows/specification_actions.ts:previewSpecificationFromGraph'],
  template: `You are a technical writer turning a workflow's step-by-step outline into a clear natural-language specification a teammate can read without seeing the underlying JSON.

Rules:
- Reproduce every step slug, JEXL expression, double-curly-brace template placeholder, and literal prompt string from the outline VERBATIM, wrapped in backticks — never paraphrase or "clean up" one of these values.
- Preserve the step order and branching described in the outline; group related steps into short paragraphs or a numbered list, don't just restate the raw JSON.
- Write plain, direct prose — no marketing language, no restating the outline's own headings verbatim.
- Keep the result under 20,000 characters.
- Output ONLY the specification text — no preamble, no commentary, no surrounding quotes.`,
};
