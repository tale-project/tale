# Contributing to Tale

Start with a local instance, reproduce the behavior you want to change, and keep
the code, tests and documentation together. The complete working contract lives in
[`AGENTS.md`](../AGENTS.md) and [`.agents/repo.md`](../.agents/repo.md).

## Run the product locally

Install Bun, a compatible Node.js runtime and Docker with Compose. The
[contributor setup guide](../docs/en/develop/contributor-setup.md) gives the exact
prerequisites, local login and startup troubleshooting.

From the repository root:

```bash
bun install
bun run setup:check
bun run dev
```

The pre-flight command checks Bun and the app/backend ports. Development starts
Docker backing services, a Node application backend and Vite; wait for `READY`
before opening `http://localhost:3000`. Real model calls need a configured provider.

For work confined to the marketing or documentation site, run its workspace:

```bash
bun run --filter @tale/web dev
bun run --filter @tale/docs dev
```

These sites do not need the platform backend for their local content preview.
Use a separate terminal for each service you want to keep running.

## Make a reviewable change

Find the existing implementation before adding another path. For a bug, reproduce
it and add regression coverage for the cause. For UI work, learn the design system
and test the result in a real browser. Use the repository generators for new
services, packages, tools and migrations.

Keep changes scoped to the task. Do not reset databases, remove volumes or replace
another contributor’s local configuration as a troubleshooting shortcut. Git
worktrees share more than source: check which ports, services and state each one
uses.

## Run the checks

Run focused checks while working and the shared gate before requesting review:

```bash
bun run check
```

It covers formatting, lint, types and automated tests. Install Python and `uv` for
the Python formatting/test steps in the workspace. Run the broader verification
when required by the repository or CI:

```bash
bun run verify
```

Browser changes also need the relevant Playwright or manual flow. Database
changes need the real-Postgres integration check described by the
[migration skill](../.agents/skills/create-migration/SKILL.md). Passing unit tests
alone does not verify a deployment, a migration or a user journey.

## Include docs and translations

Document anything a person can see, configure or call. Update English, German and
French together, including labels, captions and links. Follow the
[docs contract](../docs/AGENTS.md),
[writing skill](../.agents/skills/write-docs/SKILL.md) and
[translation skill](../.agents/skills/write-translations/SKILL.md).

Use reproducible captures for documentation screenshots. Change a documented
command, path or configuration pattern and update its README or skill in the same
contribution.

## Submit the contribution

Work on a branch from `main` and open a pull request. Describe the problem, the
resulting behavior and the checks you actually ran. Use a Conventional Commit
style PR title; squash merging uses it for the final commit. The repository’s PR
template lists the remaining review requirements.

## Report a problem

Use the [issue templates](ISSUE_TEMPLATE) for bugs, features, improvements and docs.
Include a minimal reproduction, the version, the relevant error code and what you
expected. Remove credentials and personal data from logs and screenshots.

For questions, use [Discussions](https://github.com/tale-project/tale/discussions).
Report security vulnerabilities privately through the repository’s **Security**
tab and **Report a vulnerability** action.
