const RULES_CONTENT = `# Tale Project

This is a Tale project. Edit configs in \`agents/\`, \`workflows/\`, \`integrations/\`, and \`branding/\`.

## Project structure

\`\`\`
agents/              — Agent JSON configs (one file per agent)
workflows/           — Workflow JSON configs (organized by category subdirectories)
integrations/        — Integration directories (config.json + connector.ts + icon.svg each)
branding/            — Branding config (branding.json + images/)
.tale/reference/     — Read-only implementation source code, read before creating or editing configs
\`\`\`

## Working with configs

Before creating or editing any config, read the relevant schemas and implementation code in \`.tale/reference/\` to understand the valid structure, fields, and constraints. Use existing config files in the project as examples.

## How modules connect

- Agents can simultaneously bind integrations (\`integrationBindings\`), delegate to other agents (\`delegates\`), and attach workflows (\`workflows\`)
- Workflows use integration operations within their steps and can be triggered by agents
- Check existing configs to understand available bindings before creating new ones

## Naming conventions

- Agent filenames: \`[a-z0-9][a-z0-9_-]*\\.json\`
- Workflow step slugs: \`[a-z0-9][a-z0-9_-]*\`
- Integration directory names: lowercase alphanumeric with hyphens/underscores
`;

export function buildRulesContent(): string {
  return RULES_CONTENT;
}
