# Shipped configuration catalog

`configs/platform/` contains the reusable configuration Tale ships with its images. It contains no
customer deployment configuration. Each organization owns its runtime files under
`$TALE_CONFIG_DIR/<org-slug>/`; the [configuration registry](../services/platform/lib/shared/config/registry.ts)
defines which domains are seeded and how.

## Choose the right tree

| Tree | Purpose | Examples |
| --- | --- | --- |
| `platform/system/` | Read-only, organization-independent definitions shipped with the platform | Provider protocols, model catalogs, connector definitions, harness metadata, PII patterns |
| `platform/custom/` | Defaults copied into an organization's configuration when scaffolded | Agents, skills, automation bundles, governance policies, branding |
| A client's private repository | Client-specific packs, configuration releases, deployment targets, and business rules | Never place these in this shared catalog |

Organizations edit their own seeded copies. Editing a builtin file does not by itself update an
existing organization's copy; use the documented scaffolding or configuration-release workflow.
The registry distinguishes per-file, bundle, and recursive copy behavior. Check that behavior before
changing a domain's layout or planning a reseed.

## File formats and schemas

Configuration uses YAML with JSON compatibility where the domain loader supports it. A skill is a
`SKILL.md` file with YAML frontmatter and can include scripts or reference assets. Automation bundles
contain their definition and workflow files. Do not treat arbitrary JSON, YAML, and Markdown files as
interchangeable: the relevant domain schema and loader define the accepted shape.

Shared native schemas live under [`packages/shared/src/schemas/`](../packages/shared/src/schemas/).
Platform-specific schemas and compatibility exports live under
[`services/platform/lib/shared/schemas/`](../services/platform/lib/shared/schemas/). Keep one canonical
schema for a concept. The [safe YAML loader](../services/platform/lib/shared/config/yaml.ts) handles parsing.

Provider credentials are stored through the platform credential service, not added to catalog files.
Other domains may use encrypted sidecars. Follow [secrets with SOPS](../docs/en/self-hosted/configuration/secrets-with-sops.md)
for the distinction; never commit a real credential to either tree.

## Validate a catalog change

```bash
bun run --filter @tale/platform configs:validate
bun run check
```

Read the [repo contract](../.agents/repo.md) before changing a config schema or migration behavior.
For an operator-facing workflow, see [configuration releases](../docs/en/self-hosted/configuration/config-releases.md).
