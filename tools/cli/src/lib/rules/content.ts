const RULES_CONTENT = `# Tale Project

This is a Tale project. Config is namespaced **per organization** under
\`<org>/<domain>/\`, with \`default\` as the canonical (and only required) org
on a fresh \`tale init\`. Multi-org deployments add sibling subtrees
(\`acme/\`, \`globex/\`, …) with the same internal shape.

## Project structure

\`\`\`
default/                    — Canonical/template org (created by 'tale init')
  agents/                   — Agent JSON configs (one file per agent)
  workflows/                — Workflow JSON configs (organized by category)
  connectors/             — Connector bundles (config.json + connector.ts + icon.svg)
  branding/                 — Branding config (branding.json + images/)
  providers/                — LLM provider configs (and *.secrets.json sidecars)
  skills/                   — Skill bundles (per-skill subdirs)
  governance/               — Org governance policies (one <policyType>.json per
                              policy), the retention.json bounds catalog, and
                              *.secrets.json sidecars + sso/ provider configs
<other-org>/                — Same shape; one tree per registered org
.tale/reference/            — Read-only implementation source code (read before
                              creating or editing configs)
\`\`\`

## Working with configs

Before creating or editing any config, read the relevant schemas and
implementation code in \`.tale/reference/\` to understand the valid
structure, fields, and constraints. Use existing config files in the
project as examples.

## How modules connect

- Agents can simultaneously bind connectors (\`connectorBindings\`),
  delegate to other agents (\`delegates\`), and attach workflows
  (\`workflows\`)
- Workflows use connector operations within their steps and can be
  triggered by agents
- Check existing configs to understand available bindings before creating
  new ones

## Naming conventions

- Org slug (top-level directory name): \`[a-z0-9][a-z0-9_-]{0,63}\` (or
  the literal \`default\`)
- Agent filenames: \`[a-z0-9][a-z0-9_-]*\\.json\`
- Workflow step slugs: \`[a-z0-9][a-z0-9_-]*\`
- Connector directory names: lowercase alphanumeric with hyphens/underscores

## Secrets

\`*.secrets.json\` sidecars (e.g. \`providers/openrouter.secrets.json\`)
are SOPS-encrypted and gitignored. Never commit them; never include them
in PR diffs. The repo's root \`.gitignore\` covers \`**/*.secrets.json\`
and \`**/.history/\` at all depths.
`;

export function buildRulesContent(): string {
  return RULES_CONTENT;
}

/**
 * Body for the project's `CLAUDE.md`. Claude Code reads `CLAUDE.md` but not
 * `AGENTS.md`, so this just points at the single source of truth rather than
 * duplicating it.
 */
export function buildClaudeReference(agentsFile: string): string {
  return [
    '# Tale Project',
    '',
    `Agent instructions for this project live in [\`${agentsFile}\`](${agentsFile}).`,
    'Read and follow them before creating or editing any configuration —',
    `Claude Code does not load \`${agentsFile}\` automatically, so this file`,
    'points to it.',
  ].join('\n');
}

// HTML-comment markers delimit the section `tale init` owns. Everything
// outside the markers is the user's and is preserved across re-runs.
const SECTION_BEGIN =
  '<!-- tale:begin — managed by `tale init`; content outside this block is preserved -->';
const SECTION_END = '<!-- tale:end -->';

/**
 * Insert or update the Tale-managed section in an instructions file. When the
 * file is absent/empty, returns just the managed block. When a prior managed
 * block exists, replaces it in place. Otherwise appends the block, leaving the
 * user's existing content untouched. Idempotent.
 */
export function upsertManagedSection(
  existing: string | null,
  body: string,
): string {
  const block = `${SECTION_BEGIN}\n\n${body.trim()}\n\n${SECTION_END}`;

  if (existing === null || existing.trim() === '') {
    return `${block}\n`;
  }

  const begin = existing.indexOf(SECTION_BEGIN);
  const end = existing.indexOf(SECTION_END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = existing.slice(0, begin).replace(/\s+$/, '');
    const after = existing.slice(end + SECTION_END.length).replace(/^\s+/, '');
    const parts = [before, block, after].filter((part) => part.length > 0);
    return `${parts.join('\n\n')}\n`;
  }

  return `${existing.replace(/\s+$/, '')}\n\n${block}\n`;
}
