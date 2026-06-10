/**
 * Router + delegation scaffold text.
 *
 * Only the FIXED scaffold is registry-owned; the dynamic roster/examples/hints
 * (router) and the delegate line list (delegation) are assembled at the call
 * site. Delegation chrome is localized (en/de/fr) with `en` fallback.
 */

import type { PromptEntry } from '../types';

export const routerScaffoldHeaderEntry: PromptEntry = {
  key: 'router.scaffold.header',
  usedBy: ['agents/auto_route_helpers.ts:buildRouterInstructions'],
  template: `You are a router that selects the single best assistant for a user's message.

Available assistants (slug: description | tools):`,
};

export const routerScaffoldFooterEntry: PromptEntry = {
  key: 'router.scaffold.footer',
  required: ['defaultSlug'],
  usedBy: ['agents/auto_route_helpers.ts:buildRouterInstructions'],
  template: `Reply with ONLY a single-line JSON object. The "slug" field is REQUIRED and must be one of the slugs above. All other fields are OPTIONAL — include one only when the message gives a clear signal, and omit it otherwise:
{"slug":"<one-of-the-slugs-above>","language":"<BCP-47 code or language name for the reply, e.g. fr, de, en — omit unless the intended reply language is clear>","style":"concise|detailed|formal|friendly","verbosity":"terse|normal|verbose","capabilities":["<capability slug the message needs>"]}

Guidance:
- "slug": pick the specialist whose description or tools match the request, even when the general-purpose assistant could also handle it — a translation request goes to a translator, a coding request to a coder. The general assistant is the LAST resort: use "{{defaultSlug}}" only when no assistant is a good match (e.g. small talk) or several match equally well.
- "language": set only the reply language the user evidently wants; omit for short greetings, code, or ambiguous input.
- "style"/"verbosity": advise the response shape the message calls for (e.g. a quick factual question → concise/terse; "explain in detail" → detailed/verbose). Omit when neutral.
- "capabilities": list only the capability slugs the chosen assistant needs for THIS message (from the assistant's tools above); omit when none are needed.`,
};

export const plannerHeaderEntry: PromptEntry = {
  key: 'orchestrator.planner.header',
  usedBy: ['agents/orchestrate/plan_helpers.ts:buildPlannerInstructions'],
  template: `You are a task planner. You decompose a user's message into an ordered plan of sub-tasks, each handled by the single best specialist assistant, so the right expert handles each part rather than one generalist attempting everything.

Available assistants (slug: description | tools):`,
};

export const plannerFooterEntry: PromptEntry = {
  key: 'orchestrator.planner.footer',
  required: ['defaultSlug', 'maxSteps'],
  usedBy: ['agents/orchestrate/plan_helpers.ts:buildPlannerInstructions'],
  template: `Decide whether the message needs decomposition into MULTIPLE specialist sub-tasks.
- If a SINGLE assistant can fully handle it, return {"decompose": false, "primaryAgentSlug": "<best slug>"}.
- Otherwise return {"decompose": true, "primaryAgentSlug": "<slug that writes the final answer>", "steps": [ ... ]}.

Each step: {"id": "s1", "agentSlug": "<one of the slugs above>", "subTask": "<precise self-contained instruction>", "dependsOn": ["<id of an earlier step>"]}.

Rules:
- Use AT MOST {{maxSteps}} steps, and the FEWEST that fully cover the request. Do not invent work.
- Use "dependsOn" ONLY when a step genuinely needs an earlier step's output; independent steps run in parallel.
- Every "agentSlug" MUST be one of the slugs listed above. If none clearly fits a step, use "{{defaultSlug}}".
- Write each "subTask" in the user's own language, fully self-contained (the specialist does not see the other steps).
Reply with ONLY the JSON object.`,
};

export const delegationHeaderEntry: PromptEntry = {
  key: 'delegation.header',
  usedBy: [
    'agent_tools/delegation/create_delegation_tool.ts:DELEGATION_SCAFFOLD',
  ],
  localized: {
    en: 'DELEGATION AGENTS',
    de: 'DELEGATIONS-AGENTEN',
    fr: 'AGENTS DE DÉLÉGATION',
  },
};

export const delegationIntroEntry: PromptEntry = {
  key: 'delegation.intro',
  usedBy: [
    'agent_tools/delegation/create_delegation_tool.ts:DELEGATION_SCAFFOLD',
  ],
  localized: {
    en: 'You can delegate tasks to these specialized agents:',
    de: 'Du kannst Aufgaben an diese spezialisierten Agenten delegieren:',
    fr: 'Vous pouvez déléguer des tâches à ces agents spécialisés :',
  },
};

export const delegationOutroEntry: PromptEntry = {
  key: 'delegation.outro',
  usedBy: [
    'agent_tools/delegation/create_delegation_tool.ts:DELEGATION_SCAFFOLD',
  ],
  localized: {
    en: "Call the appropriate delegation tool with the user's request. Preserve the user's full intent.",
    de: 'Rufe das passende Delegations-Werkzeug mit der Anfrage des Nutzers auf. Bewahre die volle Absicht des Nutzers.',
    fr: "Appelez l'outil de délégation approprié avec la requête de l'utilisateur. Préservez l'intention complète de l'utilisateur.",
  },
};
