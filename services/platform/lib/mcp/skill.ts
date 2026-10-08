import { API_CONTRACT_VERSION } from '../shared/constants/api-contract';
import { MCP_TOOLS } from './tools';

/**
 * The Tale skill — one `SKILL.md` in the Agent Skills format
 * (https://agentskills.io/specification) that teaches a coding agent to
 * work in Tale through its MCP server: when to reach for it, the editing
 * loop, testing, triggers, debugging a run, reading a refusal, and the rules.
 * Claude Code reads it from `.claude/skills/tale/SKILL.md`, Codex and the
 * other Agent Skills clients from `.agents/skills/tale/SKILL.md`.
 *
 * Pure and the same for every deployment: no address, no organization, no
 * key, nothing a person typed — the server's own resources are the
 * references, read fresh from the deployment the agent is connected to.
 * Served by `get_docs {topic: "skill"}`, the resource `tale://docs/skill`
 * and the download `GET /api/app/mcp/skill`.
 *
 * Built like the server instructions: every line names the tools it
 * mentions, and a line ships only when its tools are in the inventory, so
 * the file is true at every release; a section left without lines is left
 * out. `skill.test.ts` holds the format's limits, that every tool and
 * address it names exists, and a reviewed snapshot (`skill.snapshot.md`).
 */

/** The skill's name — the folder it is installed in, and the MCP server's
 * conventional name in a client's configuration. */
export const TALE_SKILL_NAME = 'tale';

/** One line of the skill and the tools it names. */
export interface SkillLine {
  readonly text: string;
  readonly tools: readonly string[];
}

/** One `##` section: its lines in order. */
export interface SkillSection {
  readonly heading: string;
  readonly lines: readonly SkillLine[];
}

/** The `description`, from sentences that each name their tools — the one
 * text a client reads to decide when the skill applies. */
export const SKILL_DESCRIPTION: readonly SkillLine[] = [
  {
    text: "Edit, check, test, save, deploy and debug Tale automations through Tale's MCP server (get_automation, validate_automation, run_automation, test_automation, save_automation, deploy_automation, get_run).",
    tools: [
      'get_automation',
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
      'deploy_automation',
      'get_run',
    ],
  },
  {
    text: 'Use when the user asks to create or change a Tale automation, workflow, trigger or schedule, or to find out why a Tale run failed.',
    tools: [],
  },
];

/** The opening paragraph, under the title. */
const INTRODUCTION: readonly SkillLine[] = [
  {
    text: "Tale runs automations: node graphs that a schedule, a webhook, a platform event or a person starts. Its MCP server lets you read, change, check, test, save and deploy them and debug their runs, with the rights of the person whose key or sign-in connects you. Every change you make is in the organization's audit log as that person's, made through a coding agent.",
    tools: [],
  },
];

export const SKILL_SECTIONS: readonly SkillSection[] = [
  {
    heading: 'When to use',
    lines: [
      {
        text: '- Creating or changing a Tale automation, or what starts it (a schedule, a webhook, an event).',
        tools: [],
      },
      {
        text: '- Finding out why a Tale run failed, and fixing the automation.',
        tools: [],
      },
      {
        text: "- Not for acting on real systems on your own: deploying, triggers and live runs act for real, so they wait for the person's yes.",
        tools: [],
      },
    ],
  },
  {
    heading: 'Before you start',
    lines: [
      {
        text: "- Check the connection: your tools include get_automation. If they do not, ask the person to connect Tale's MCP server (Tale shows how under Settings > API > MCP).",
        tools: ['get_automation'],
      },
      {
        text: '- Read the authoring reference once per session: get_docs, or the resource tale://docs/authoring.',
        tools: ['get_docs'],
      },
      {
        text: '- Discover instead of guessing: search_catalog and get_catalog for the node types this deployment runs.',
        tools: ['search_catalog', 'get_catalog'],
      },
      {
        text: '- Name only what the organization has: list_models, list_harnesses, list_skills, list_connectors, list_agent_secrets (names only), list_projects and list_events say what exists.',
        tools: [
          'list_models',
          'list_harnesses',
          'list_skills',
          'list_connectors',
          'list_agent_secrets',
          'list_projects',
          'list_events',
        ],
      },
    ],
  },
  {
    heading: 'The editing loop',
    lines: [
      {
        text: '1. Read the automation with get_automation and note its version: it is your baseVersion. For a new one, pick a name list_automations does not show.',
        tools: ['get_automation', 'list_automations'],
      },
      { text: '2. Edit the document.', tools: [] },
      {
        text: '3. Call validate_automation and fix every error. Read the warnings: they name what the organization lacks or a read that may fail.',
        tools: ['validate_automation'],
      },
      {
        text: '4. Run it with run_automation and a realistic input until the output and the effects are right. It runs on the mocks, and nothing leaves Tale.',
        tools: ['run_automation'],
      },
      {
        text: '5. Add tests to the document and run them with test_automation.',
        tools: ['test_automation'],
      },
      {
        text: '6. Save with save_automation, passing baseVersion and a one-line message. The settings, task contract and presentation you leave out are kept.',
        tools: ['save_automation'],
      },
      {
        text: '7. Ask the person before deploy_automation, and pass expectedDeployedVersion (the version you read as live, null for none).',
        tools: ['deploy_automation'],
      },
      { text: '', tools: [] },
      {
        text: 'A save refused with AUTOMATION_VERSION_STALE means someone saved meanwhile: read data.latestVersion, merge your change into it, and save again with that baseVersion.',
        tools: [],
      },
    ],
  },
  {
    heading: 'Testing',
    lines: [
      {
        text: '- run_automation runs a draft on the mocks; test_automation runs the tests of a draft, or of a saved version (name, version) and records the verdict on it.',
        tools: ['run_automation', 'test_automation'],
      },
      {
        text: '- start_run with mode "mock" runs a saved version on the mocks and records the run, so the person can review it in Tale. Without mode, start_run is live.',
        tools: ['start_run'],
      },
    ],
  },
  {
    heading: 'Triggers',
    lines: [
      {
        text: '- Read the triggers reference first: tale://docs/triggers, or get_docs with topic "triggers".',
        tools: ['get_docs'],
      },
      {
        text: '- An automation has at most one trigger; list_triggers shows it, and set_trigger replaces it. A trigger runs the deployed version, for real.',
        tools: ['list_triggers', 'set_trigger'],
      },
      {
        text: "- A webhook's token is shown once, in set_trigger's answer: tell the person to keep it in the sender's secret store, never in a document or a commit.",
        tools: ['set_trigger'],
      },
    ],
  },
  {
    heading: 'Debugging a failed run',
    lines: [
      {
        text: '1. Read the run with get_run (or the resource tale://runs/{runId}): its status, error, failureCode and trace.',
        tools: ['get_run'],
      },
      {
        text: '2. Read the version it ran with get_automation.',
        tools: ['get_automation'],
      },
      {
        text: "3. Reproduce it with run_automation and the run's input, and propose the smallest fix; save it only once the person agrees.",
        tools: ['run_automation'],
      },
      {
        text: '4. When the cause is outside the document (a connector nobody connected, a secret nobody stored, a model the organization does not serve), say which and where in Tale it is set.',
        tools: [],
      },
    ],
  },
  {
    heading: 'Reading refusals',
    lines: [
      {
        text: 'A refusal is data, never a crash: {error, code, hint, data}. Branch on code and follow hint.',
        tools: [],
      },
      { text: '', tools: [] },
      { text: '| Code | What to do |', tools: [] },
      { text: '| --- | --- |', tools: [] },
      {
        text: '| INVALID_ARGUMENTS | Fix every problem in data.issues at once; the tool schema says what it takes. |',
        tools: [],
      },
      {
        text: '| AUTOMATION_VERSION_STALE | Read data.latestVersion, merge, save again with that baseVersion. |',
        tools: [],
      },
      {
        text: '| AUTOMATION_DEPLOYMENT_STALE | Another version went live meanwhile: tell the person and ask again. |',
        tools: [],
      },
      {
        text: '| AUTOMATION_NOT_FOUND | Check the name with list_automations; it may be one the person cannot see. |',
        tools: ['list_automations'],
      },
      {
        text: "| FORBIDDEN_DEVELOPER_SETTINGS | The person's role cannot do this. Say so; do not retry. |",
        tools: [],
      },
      {
        text: '| RATE_LIMITED | Wait data.retryAfterMs, then call again. |',
        tools: [],
      },
      {
        text: '| INTERNAL_ERROR | Tell the person data.requestId; whoever runs Tale can look it up. |',
        tools: [],
      },
    ],
  },
  {
    heading: 'Rules',
    lines: [
      {
        text: '- Ask the person before anything that acts for real or for others: deploy_automation, set_trigger, delete_automation, set_automation_projects, run_deployed, a live start_run, answer_run_ask.',
        tools: [
          'deploy_automation',
          'set_trigger',
          'delete_automation',
          'set_automation_projects',
          'run_deployed',
          'start_run',
          'answer_run_ask',
        ],
      },
      {
        text: '- Approvals are human-only: never try to decide one.',
        tools: [],
      },
      {
        text: "- Never read local credential files, and never ask for, accept or print a secret (an API key, a token, a password). A document never holds one: the organization's secrets reach a run by name.",
        tools: [],
      },
    ],
  },
  {
    heading: 'References',
    lines: [
      {
        text: '- tale://docs/authoring: the automation grammar and the automation tools (get_docs).',
        tools: ['get_docs'],
      },
      {
        text: '- tale://docs/triggers: trigger kinds, their fields and the events (get_docs with topic "triggers").',
        tools: ['get_docs'],
      },
      {
        text: '- tale://docs/validation: reading a validation result, and every issue code (get_docs with topic "validation").',
        tools: ['get_docs'],
      },
      {
        text: '- tale://automations/{name} and tale://runs/{runId}: an automation and a run, as get_automation and get_run read them; write "/" in a name as %2F.',
        tools: ['get_automation', 'get_run'],
      },
    ],
  },
];

const INVENTORY: ReadonlySet<string> = new Set(
  MCP_TOOLS.map((tool) => tool.name),
);

function shipped(
  lines: readonly SkillLine[],
  inventory: ReadonlySet<string>,
): string[] {
  return lines
    .filter((line) => line.tools.every((tool) => inventory.has(tool)))
    .map((line) => line.text);
}

/** A YAML double-quoted scalar: JSON's string escapes are YAML's. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** The `SKILL.md` for an inventory — by default this endpoint's. */
export function buildTaleSkill(
  inventory: ReadonlySet<string> = INVENTORY,
  sections: readonly SkillSection[] = SKILL_SECTIONS,
): string {
  const description = shipped(SKILL_DESCRIPTION, inventory).join(' ');
  const body = sections.flatMap((section) => {
    const lines = shipped(section.lines, inventory);
    return lines.length === 0
      ? []
      : ['', `## ${section.heading}`, '', ...lines];
  });
  return [
    '---',
    `name: ${TALE_SKILL_NAME}`,
    `description: ${yamlString(description)}`,
    'license: MIT',
    `compatibility: ${yamlString("Needs Tale's MCP server connected (https://<your Tale>/api/v1/mcp); works with any MCP client that reads skills.")}`,
    'metadata:',
    '  publisher: tale',
    `  contract: ${yamlString(API_CONTRACT_VERSION)}`,
    '---',
    '',
    '# Tale',
    '',
    ...shipped(INTRODUCTION, inventory),
    ...body,
    '',
  ].join('\n');
}
