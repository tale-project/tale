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
  integrations/             — Integration bundles (config.json + connector.ts + icon.svg)
  branding/                 — Branding config (branding.json + images/)
  providers/                — LLM provider configs (and *.secrets.json sidecars)
  skills/                   — Skill bundles (per-skill subdirs)
  retention.json            — Per-org data-retention overrides
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

- Agents can simultaneously bind integrations (\`integrationBindings\`),
  delegate to other agents (\`delegates\`), and attach workflows
  (\`workflows\`)
- Workflows use integration operations within their steps and can be
  triggered by agents
- Check existing configs to understand available bindings before creating
  new ones

## Naming conventions

- Org slug (top-level directory name): \`[a-z0-9][a-z0-9_-]{0,63}\` (or
  the literal \`default\`)
- Agent filenames: \`[a-z0-9][a-z0-9_-]*\\.json\`
- Workflow step slugs: \`[a-z0-9][a-z0-9_-]*\`
- Integration directory names: lowercase alphanumeric with hyphens/underscores

## Secrets

\`*.secrets.json\` sidecars (e.g. \`providers/openrouter.secrets.json\`)
are SOPS-encrypted and gitignored. Never commit them; never include them
in PR diffs. The repo's root \`.gitignore\` covers \`**/*.secrets.json\`
and \`**/.history/\` at all depths.
`;

export function buildRulesContent(): string {
  return RULES_CONTENT;
}
