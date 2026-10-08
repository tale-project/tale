# MCP

> **Prefix** `MCP-` · **Reset** none · **Cost** 12 boxes

Exercise Tale's MCP endpoint, `/api/v1/mcp`, from a real coding agent: connecting a client with an
API key and working in the organization through it. A person drives the agent in a terminal beside
a signed-in browser. The suite leaves behind the API key it creates, the client configurations it
writes, and the versions and mock runs the agent saves and starts; it deploys nothing. The endpoint's rules are the [MCP spec](../../../backend/domains/mcp/spec.md) (same
prefix); what its tests already prove is listed in
[`reference/automation.md`](../reference/automation.md); the endpoint's page in Settings is
`SET-F33` in [settings](settings.md).

## Scope & routes

| Surface | Route |
| --- | --- |
| MCP endpoint page (address, organization slug) | `/dashboard/{org}/settings/api/mcp` |
| API keys | `/dashboard/{org}/settings/api/rest` |
| Automation editor (the **Version** history) | `/dashboard/{org}/automations/{slug}/editor` |
| Automation runs | `/dashboard/{org}/automations/{slug}/runs` |

`{slug}` is the automation's name with every `/` written as `__` (`billing/dunning` →
`billing__dunning`).

## Preconditions

Bring the stack up and sign in per [setup.md](../setup.md) as an owner, admin or developer of the
organization; mode A is enough, since no box calls a model through Tale. The agent must trust the
deployment's certificate: in modes A and B the app speaks plain HTTP on `http://localhost:3000`,
and behind Caddy (mode C) trust its internal CA first, as setup.md describes. Create an API key
(`SET-F32`) and export it as `TALE_API_KEY`, the app's address as `TALE_URL`, and the value under
**Organization slug** (`settings.mcpEndpoint.orgSlug.title`) on the MCP endpoint page as
`TALE_ORG_SLUG`. Install Claude Code and Codex; `MCP-F2` also needs Cursor, VS Code and Gemini
CLI.

> **Agent note**: judge what the agent did by what Tale shows after a reload (the automation list,
> its versions, the run list), never by what the agent says it did. A tool the agent reports as
> failed is a finding only when Tale's answer names no reason.

## Connect

- [ ] `MCP-F1` · **Connect Claude Code and Codex with a key** — In a terminal, run
  `claude mcp add --transport http tale "$TALE_URL/api/v1/mcp" --header "Authorization: Bearer $TALE_API_KEY" --header "X-Organization-Slug: $TALE_ORG_SLUG"`,
  then `claude mcp list`, then start Claude Code, type its /mcp command, and ask it to list this
  organization's automations. Then run
  `codex mcp add tale --url "$TALE_URL/api/v1/mcp" --bearer-token-env-var TALE_API_KEY`, add
  `env_http_headers = { "X-Organization-Slug" = "TALE_ORG_SLUG" }` under `[mcp_servers.tale]` in
  `~/.codex/config.toml`, start Codex in the same shell, type its /mcp command and ask the same →
  `claude mcp list` reports `tale` as connected; each client's /mcp view shows the `tale` server
  with its tools; each agent's answer names exactly the automations `/dashboard/{org}/automations`
  lists; the backend log carries `[mcp]` lines with the same `cred=` for both clients; the round
  record names, for each client, the origin of any `[mcp] origin-mismatch` line it brought, or
  that it brought none.
- [ ] `MCP-F2` · **Connect Cursor, VS Code and Gemini CLI with a key** — Register the endpoint in
  each client as a remote HTTP server named `tale` with `MCP-F1`'s two headers: in Cursor, an
  entry under `mcpServers` in `.cursor/mcp.json` with `url` and `headers`; in VS Code, an entry
  under `servers` in `.vscode/mcp.json` with `"type": "http"`, `url` and `headers`; in Gemini CLI,
  `gemini mcp add --transport http tale "$TALE_URL/api/v1/mcp" --header "Authorization: Bearer $TALE_API_KEY" --header "X-Organization-Slug: $TALE_ORG_SLUG"`.
  In each, ask the agent to list this organization's automations → each client shows `tale` as
  connected with its tools; each agent's answer names exactly the automations
  `/dashboard/{org}/automations` lists; the round record names, for each client, the origin of
  any `[mcp] origin-mismatch` line it brought, or that it brought none.
- [ ] `MCP-F12` · **Serve a 2026-07-28 client and a legacy one on one key** — With `MCP-F1`'s
  connection (re-added with `claude mcp remove tale` and the `MCP-F1` command if Claude Code met
  this deployment before it spoke 2026-07-28, since it remembers a server's era), restart Claude
  Code and ask it to list this organization's automations; then, in
  another terminal, run the `initialize` and the `get_docs` commands of "Initialize and retrieve
  the authoring reference" in the MCP endpoint guide (docs `develop/mcp-endpoint`) with the same
  key → both answer; the backend log carries `[mcp]` lines with `method=server/discover` for
  Claude Code, which speaks 2026-07-28, and `method=initialize` for the `curl` call, with the same
  `cred=`; the agent names exactly the automations `/dashboard/{org}/automations` lists; the
  `get_docs` answer holds the reference and `"isError":false`.

## Prompts, resources and the skill

These boxes reuse the connection of `MCP-F1` and an automation the signed-in person can open whose
document has at least one transform node; `billing/dunning` stands for its name below.

- [ ] `MCP-F3` · **Edit an automation from a prompt** — In Claude Code, type `/`, pick
  "/tale:edit_automation", run it as "/tale:edit_automation billing/dunning", and ask for one small
  change (a new field in the output) → the `/` menu lists "/tale:edit_automation",
  "/tale:debug_failed_run" and "/tale:add_trigger"; the agent validates the change and runs it
  on the mocks before it saves; after a reload, the automation in `/dashboard/{org}/automations`
  has one more version, the deployed version is unchanged, and nothing was deployed.
- [ ] `MCP-F7` · **Mention a run as a resource** — Ask the agent to start `billing/dunning` with
  `start_run` and mode "mock", copy the run id it answers, then send a message that mentions
  `@tale:tale://runs/<run id>` and asks what the run returned → typing `@tale:` offers Tale's
  resources; the message carries the run as an attachment; the agent's answer matches the
  output the run shows in the app.
- [ ] `MCP-F8` · **Explain a failed run from a prompt** — Ask the agent to save a version of
  `billing/dunning` whose transform node throws an error and to start it with mode "mock", then
  run "/tale:debug_failed_run <run id>" with the failed run's id → the agent names the failing
  node and its error in plain words, reproduces the failure with `run_automation`, proposes one
  fix and asks before saving it; after a reload, no version beyond the failing one was saved
  until you agreed.
- [ ] `MCP-F11` · **Install the Tale skill** — Save the skill with the `curl` command of "Install
  the Tale skill" in the editor guide (docs `develop/use-tale-from-your-editor#tale-skill`),
  restart Claude Code in that folder, and type `/` → the menu lists "/tale" with the skill's
  description; `.claude/skills/tale/SKILL.md` names no host, organization or key; asked to add a
  field to `billing/dunning`, the agent validates and runs it on the mocks and asks before
  deploying.

## Working on an automation

These boxes reuse `MCP-F1`'s Claude Code connection and the automation of the section above. Run
them in order: `MCP-F6` deploys nothing, so the deployed version it compares is the one the
earlier boxes left.

- [ ] `MCP-F4` · **Read a stale save in the agent** — In Claude Code, ask the agent to read
  `billing/dunning` and to prepare one small change (a new field in the output) without saving
  it; then, in the browser, change one node in the automation's editor and save a version; then
  tell the agent to save its change, naming the version it read as `baseVersion` → the agent
  reports that a newer version was saved meanwhile and names its number instead of saving; after
  a reload, the newest version under the editor's **Version** history is the one you saved;
  asked to try again, the agent reads that version and saves one on top of it that keeps your
  node change and adds its field.
- [ ] `MCP-F5` · **Find the agent's mock run in Runs** — Ask the agent to start the newest version
  of `billing/dunning` with `start_run` and mode "mock", then open
  `/dashboard/{org}/automations/{slug}/runs` → the run is listed with the **Test** badge
  (`automations.runs.mode.mock`), **Started by you (API)** (`automations.runs.starter.youApi`)
  and the version the agent started; opening it shows the output the agent reported.
- [ ] `MCP-F6` · **Asked before a deploy, even in bypass mode** — Quit Claude Code, start it again
  in the same folder with `claude --dangerously-skip-permissions`, ask it to list this
  organization's automations and then to deploy the newest version of `billing/dunning`, and
  decline when Claude Code asks → the list is answered without a question; Claude Code asks you
  before it calls `deploy_automation`; after you decline, a reload of
  `/dashboard/{org}/automations` shows the same deployed version of `billing/dunning` as before.

## What the organization sees

- [ ] `MCP-F13` · **Find the agent's save in the audit log** — After `MCP-F3`, sign in as an
  owner or admin, open **Settings > Governance > Logs**, and open the newest **Automation version
  saved** row (`settings.logs.audit.actionLabels.automation.version.saved`) of `billing/dunning`;
  then save a version of it in the editor and open that row too → the agent's row shows **Source**
  (`settings.logs.audit.viaLabel`) as **Coding agent** (`settings.logs.audit.viaLabels.mcp`) and
  **Client** (`settings.logs.audit.clientLabel`) as the name Claude Code sent, written as sent;
  **User** is the person who holds the key; **Metadata** names the tool `save_automation` and
  the key's id, and repeats neither the source nor the client; the editor's row has no
  **Source** and no **Client** row.
