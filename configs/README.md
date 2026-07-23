# configs/ — the shipped configuration catalog

The platform's file-based configuration tree. Everything here is YAML (`.yml`,
with `.secrets.yml` SOPS sidecars where a domain carries secrets); i18n message
bundles (`messages/*.json`) are the one deliberate JSON exemption. JSON stays
valid input everywhere — JSON is valid YAML — but the shipped catalog is
authored as YAML, parsed through the shared safe loader at
`services/platform/lib/shared/config/yaml.ts`, and validated by the Zod
schemas under `services/platform/lib/shared/schemas/` (the source of truth for
every file's shape).

## Tree contract

- `platform/system/` — shipped with the image: **read-only at runtime,
  org-independent, never scaffolded** into org trees.
  - `providers/<slug>.yml` — AI provider connectors (wire format, auth
    methods, catalog source)
  - `models/<provider>.yml` — static model catalogs
  - `integrations/<slug>/` — integration connectors (`connector.yml` +
    `icon.svg`)
  - `harnesses/<slug>.yml` — coding-agent harness facts
  - `pii/patterns/*.yml` — PII pattern definitions
  - `pii/locales/<locale>.yml` — per-locale PII datasets
- `platform/custom/` — the per-org **seed catalog**, scaffolded into
  `$TALE_CONFIG_DIR/<org>/<domain>/` when an organization is created or
  reseeded; each org then owns and edits its copies.
  - `agents/` — default agents (the chat agent)
  - `skills/<name>/SKILL.md` — built-in skills
  - `automations/<path>/` — automation bundles (`automation.yml` +
    `workflow.yml` + `icon.svg`)
  - `governance/` — policy defaults
  - `branding/` — branding defaults

Populated so far: `custom/governance/` carries the shipped policy defaults
(one `.yml` per policy type plus the `retention.yml` bounds catalog),
validated against `POLICY_SCHEMAS` by the runtime catalog check
(`convex/lib/config_store/validate_builtin_catalog.ts`). The remaining
domain directories hold only `.gitkeep` placeholders and populate as their
rewrite phases land.
