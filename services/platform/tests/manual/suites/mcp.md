# MCP

> **Prefix** `MCP-` · **Reset** none · **Cost** 1 box

Exercise Tale's MCP endpoint, `/api/v1/mcp`, from a real coding agent: connecting a client with an
API key and working in the organization through it. A person drives the agent in a terminal beside
a signed-in browser. The suite leaves behind the API key it creates and the client configuration it
writes. The endpoint's rules are the [MCP spec](../../../backend/domains/mcp/spec.md) (same
prefix); what its tests already prove is listed in
[`reference/automation.md`](../reference/automation.md); the endpoint's page in Settings is
`SET-F33` in [settings](settings.md).

## Scope & routes

| Surface | Route |
| --- | --- |
| MCP endpoint page (address, organization slug) | `/dashboard/{org}/settings/api/mcp` |
| API keys | `/dashboard/{org}/settings/api/rest` |

## Preconditions

Bring the stack up and sign in per [setup.md](../setup.md) as an owner, admin or developer of the
organization; mode A is enough, since no box calls a model through Tale. The agent must trust the
deployment's certificate: in modes A and B the app speaks plain HTTP on `http://localhost:3000`,
and behind Caddy (mode C) trust its internal CA first, as setup.md describes. Create an API key
(`SET-F32`) and export it as `TALE_API_KEY`, the app's address as `TALE_URL`, and the value under
**Organization slug** (`settings.mcpEndpoint.orgSlug.title`) on the MCP endpoint page as
`TALE_ORG_SLUG`. Install Claude Code.

> **Agent note**: judge what the agent did by what Tale shows after a reload (the automation list,
> its versions, the run list), never by what the agent says it did. A tool the agent reports as
> failed is a finding only when Tale's answer names no reason.

## Connect

- [ ] `MCP-F1` · **Connect Claude Code with a key** — In a terminal, run
  `claude mcp add --transport http tale "$TALE_URL/api/v1/mcp" --header "Authorization: Bearer $TALE_API_KEY" --header "X-Organization-Slug: $TALE_ORG_SLUG"`,
  then `claude mcp list`, then start Claude Code, type its /mcp command, and ask it to list this
  organization's automations → `claude mcp list` reports `tale` as connected; the /mcp panel
  shows the `tale` server with its tools; the agent's answer names exactly the automations
  `/dashboard/{org}/automations` lists.
