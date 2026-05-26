---
title: AI-assisted development
description: Use AI-powered editors to author agents, workflows, and integrations with full platform awareness.
---

The `tale init` and `tale upgrade` CLI commands generate editor-configuration files that make AI-powered code editors — Claude Code, Cursor, GitHub Copilot, Windsurf — aware of Tale's project structure, schemas, and platform source. With those files in place, you can describe an agent, a workflow, or an integration in natural language and the editor produces a configuration that matches the schema. This page is for source contributors and developers using a file-based authoring flow; users editing through the platform UI don't need any of this.

The outcome of running `tale init` once is a project directory that any of the named editors can open with full context: the schemas, the validators, the connector tool surface, and the example library all live under `.tale/reference/`.

## What `tale init` generates

A scaffolded project ships with one editor-rules file per supported editor and a read-only reference directory the editor can grep:

| File                              | Purpose                                   | Editor           |
| --------------------------------- | ----------------------------------------- | ---------------- |
| `CLAUDE.md`                       | Project rules and context                 | Claude Code      |
| `.cursor/rules/tale.mdc`          | Project rules with glob-based frontmatter | Cursor           |
| `.github/copilot-instructions.md` | Project rules                             | GitHub Copilot   |
| `.windsurfrules`                  | Project rules                             | Windsurf         |
| `.tale/reference/`                | Full platform source (read-only)          | All of the above |

The four rules files carry the same core content — project structure, configuration conventions, an instruction to consult `.tale/reference/` before generating anything — in each editor's preferred format. The reference directory contains the backend implementation: database schemas, validators, agent-tool definitions, workflow step types, and connector contracts. That's everything the editor needs to produce a correct config without guessing.

## How to use it

The workflow is the same across every editor:

1. Create or upgrade the project: `tale init <project-name>` for a fresh tree, `tale upgrade` to regenerate the rules files in an existing one.
2. Open the project in your AI-powered editor of choice. The editor picks up the rules file automatically.
3. Describe the thing you want in plain language. The editor reads the schemas from `.tale/reference/` and writes the matching configuration files.
4. Save. The Tale platform live-reloads `agents/`, `workflows/`, `integrations/`, and `branding/` — there's no separate deploy step.

A few prompts that work well in practice:

```text
Create an agent that helps the sales team look up product details and customer history.
```

```text
Add a workflow that runs every morning, checks for overdue invoices, and posts a summary to Slack.
```

```text
Create a REST API integration for our internal service at api.example.com with OAuth2 authentication.
```

```text
Update the CRM assistant agent to also have access to the document search tool.
```

The editor generates the JSON, you review it, the platform applies it.

## Keeping rules and reference up to date

The rules files and the reference directory are bundled into the CLI binary, so an out-of-date CLI produces out-of-date rules. Run `tale upgrade` periodically:

```bash
tale upgrade
```

The upgrade rewrites every generated file. Don't edit them by hand — local changes are overwritten on the next upgrade. If a rule needs to change for the whole project (a custom convention, a house style), file the change against the CLI itself rather than patching the generated file.

## Where this fits

AI-assisted development is the file-based authoring path for agents, automations, integrations, and branding. It exists because the JSON shape that backs every UI screen is also the shape an AI-powered editor can generate from a plain-language description — for a fleet of agents, that's faster than building each one in the UI.

For the canonical UI build flow that doesn't involve a code editor, [Build your first agent end to end](/tutorials/editor/first-agent-end-to-end) is the entry point. For the connector authoring surface this page sits next to, [Build an integration](/develop/integrations) is the reference.
