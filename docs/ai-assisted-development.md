---
title: AI-assisted development
description: Use AI-powered editors to create and edit agents, workflows, and integrations with full platform awareness.
---

When you run `tale init`, the CLI generates configuration files that make AI-powered code editors aware of Tale's project structure, schemas, and platform source code. This means you can create and edit agents, workflows, and integrations by describing what you want in natural language.

## What gets generated

| File                              | Purpose                                    | Editor          |
| --------------------------------- | ------------------------------------------ | --------------- |
| `CLAUDE.md`                       | Project rules and context                  | Claude Code     |
| `.cursor/rules/tale.mdc`          | Project rules with glob-based frontmatter  | Cursor          |
| `.github/copilot-instructions.md` | Project rules                              | GitHub Copilot  |
| `.windsurfrules`                  | Project rules                              | Windsurf        |
| `.tale/reference/`                | Full platform source code (read-only)      | All of the above |

The rules files contain the same core content: project structure, configuration conventions, and instructions to consult `.tale/reference/` before making changes. The reference directory contains the complete backend implementation source, including database schemas, validators, agent tools, workflow step types, and integration connectors. This gives the AI everything it needs to generate correct configurations.

## How to use it

1. Create a project with `tale init my-project` (or run `tale update` on an existing project to regenerate files).
2. Open the project directory in your AI-powered editor.
3. The editor automatically reads its rules file and gains full platform context.
4. Ask the AI to create or modify configurations. For example:
   - "Create an agent that helps the sales team look up product details and customer history"
   - "Add a workflow that runs every morning, checks for overdue invoices, and sends a summary to Slack"
   - "Create a REST API integration for our internal service at api.example.com with OAuth2 authentication"
   - "Update the CRM assistant agent to also have access to the document search tool"
5. The AI reads the reference source code, understands valid schemas and relationships, and generates correct JSON configuration files.
6. Changes to `agents/`, `workflows/`, `integrations/`, and `branding/` are live-reloaded by the platform.

## Supported editors

Tale generates configuration files for Claude Code, Cursor, GitHub Copilot, and Windsurf. Any editor that reads one of these formats will work. For other tools, the `CLAUDE.md` file at the project root can serve as a general reference.

## Keeping rules up to date

Rules files and the reference directory are bundled into the CLI binary. To get the latest version, first update the CLI itself, then run `tale update` to regenerate the files in your project:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale update
```

Do not edit these files manually as they are overwritten on update.
