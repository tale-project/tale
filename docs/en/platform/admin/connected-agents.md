---
title: Connected agents
description: Connect a coding agent to Tale by signing in from it, choose what it may do, and see and disconnect the agents connected to an organization.
---

A coding agent such as Claude Code, Codex or Cursor can sign itself in to Tale's [MCP endpoint](/develop/mcp-endpoint) instead of holding an API key. You sign in, choose one organization and how much the agent may do there, and the agent then works as you, never above your role. This page covers connecting an agent, what the consent page asks, and where you see and end connections. Your operator can switch agent sign-in off; while it is off, agents use API keys, and the **Connected agents** page is there only for people who still hold a connection.

## Connect an agent

1. Select **Connect a coding agent** on this page. The dialog gives the commands for Claude Code and Codex, and the address to add to any other agent; [Use Tale from your editor or a script](/develop/use-tale-from-your-editor#connect-opencode-or-claude-code) covers the rest. **Settings > API > MCP** also shows the address, with a copy button.
2. Run the commands for your agent. Claude Code ends with its sign-in, `claude mcp login tale`; Codex signs in as part of `codex mcp add`. The agent opens Tale in your browser. If you are signed out, sign in first.
3. Check who is asking on the consent page. **Verified domain** means Tale read the app's details from its own domain, which only that domain's owner can publish. **Unverified app** means the agent registered itself and chose its own name: continue only if you started this connection from your agent just now.
4. Choose the **Organization**. The agent works in that organization only; to use another one, connect it again.
5. Choose the **Access** and, if you want, what to **Also allow**. The list headed “What Claude Code can do”, with your agent's name, shows what the choice comes to, and your role still applies: the agent never does more than you can in that organization.
6. Select **Connect**. Tale sends you back to the agent, which signs itself in and can start working.

<Frame caption="Connect a coding agent — the commands for the agent you use, whether it has signed in yet, and what to ask it first.">

![The Connect a coding agent dialog shows the Claude Code, Codex and Other tabs, the two commands that add Tale and sign in, a line that waits for the agent to sign in, and a first prompt to copy.](/images/platform/settings-connect-agent.webp)

</Frame>

<Frame caption="The consent page of an app that registered itself. Where a verified app shows its domain, this one carries the Unverified app warning.">

![The consent page for an app called Cursor: a warning that the app is unverified, the organization it will work in, three access levels and three extras to choose from, a summary of what it can do, and the Connect and Cancel buttons.](/images/platform/agent-consent.webp)

</Frame>

The request that brings you to the consent page expires after five minutes. If it has, start the connection again from the agent.

The dialog keeps watching while it is open. It reads **Waiting for your agent to sign in…** until the agent has signed in, then **Connected:** and its name, with a first prompt to give the agent.

### Choose the access

| Choice                       | What the agent may do                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Read and test**            | Read automations, runs and knowledge, check drafts and try them with test data. Changes nothing. |
| **Edit automations**         | Also save new versions. Deploying stays with you.                                                |
| **Edit and deploy**          | Also deploy, set triggers and start live runs that act on your connected services.               |
| **Read settings**            | Read the settings your role can see. Secrets stay hidden.                                        |
| **Change settings**          | Change the settings your role can change. Every change is recorded in the audit log.             |
| **Connect AI subscriptions** | Ask to add an AI subscription. No tool uses this choice yet.                                     |

The first three are levels: each adds to the one before. The last three are separate choices. [Access levels](/develop/mcp-endpoint#access-levels) lists the tools each one opens. The page offers only what the agent asked for and your role allows; a choice the agent did not ask for is unavailable and says so. When a call needs more access than the connection holds, the agent can ask again and you allow more on the same page. Allowing the same app again changes its connection instead of adding a second one.

### Who may connect

|                                                                                      | Owner, Admin or Developer | Member with a competence used with a key | Any other member |
| ------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------- | ---------------- |
| Connect an agent to the organization                                                 | Yes                       | Yes                                      | No               |
| Allow **Edit automations**, **Edit and deploy**, **Change settings** or **Connect AI subscriptions** | Yes                       | No                                       | No               |
| Allow **Read and test** and **Read settings**                                                | Yes                       | Yes                                      | No               |

A member's competence is the one that lets them create an API key, such as **Call models over the API**; [Competences](/platform/admin/governance/competences) lists them. Someone who may not connect an agent in an organization sees why on the consent page and cannot choose it.

Allowing anything beyond **Read and test** and **Read settings** needs a sign-in from the last day. If yours is older, the page asks for your password first, or sends an account that signs in through your company's sign-in to sign in again, and keeps your choice. Accounts whose email address is not confirmed, or whose two-factor enrollment is due, cannot connect an agent yet.

## See and disconnect agents

Open **Settings > API > Connected agents**. The page is there once agent sign-in is on and you may connect an agent in this organization, and it stays for anyone who still holds a live connection, so they can end it. The list shows each agent with its name, where it comes from (the domain it proved, or **Unverified**), the access you gave it, when it connected and when it last called, **Never** before the first call. Tale keeps its own record of the calls it answered with that connection, and the time of the last call comes from it, never from what the agent says.

<Frame caption="Settings > API > Connected agents — each agent with its access, the day it connected, and when it last called.">

![The Connected agents page lists three coding agents, each marked Unverified, with the access it was given, the day it connected, and when it last called.](/images/platform/settings-connected-agents.webp)

</Frame>

You see the agents you connected. Owners and Admins can switch **Mine** to **Everyone** to see who connected each one, and turn on **Show disconnected** to read when and why a connection ended.

To disconnect an agent, open its row menu and select **Disconnect**. Tale asks first, in words that say whose agent it is, and the agent loses access at once: its next call is refused and it cannot sign itself in again. You can connect it again later. Disconnecting ends the agent's sign-in for this organization only; the same app connected to another organization by you stays as it is.

## What ends a connection

| What happens                                                                                                     | Reason shown                   |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| You disconnect it                                                                                                | by the person who connected it |
| An Owner or Admin disconnects it                                                                                 | by an Admin                    |
| The person leaves the organization, or is removed                                                                | membership ended               |
| The person changes their password, or an Admin sets it, removes their passkey or resets their two-factor sign-in | account security change        |
| An old sign-in was used again: a refresh token presented twice ends every connection of that app for that person | an old sign-in was reused      |
| The app's registration is removed | app removed |

An agent that goes unused for 30 days can no longer renew its sign-in, so it has to be connected again. When a connection ends in a way you did not choose (an old sign-in reused, a change of your password or sign-in method, or an Owner or Admin), you find a notice in your notifications in that organization, naming the agent and why. A disconnect you made yourself leaves none. Every connection, every change of access and every disconnect also leaves a row in the [audit log](/platform/admin/governance/audit-logs), and the calls an agent makes are marked as coming through MCP with the connection.

## If it does not work

| What you see                                                                                              | What to do                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| The agent says it needs authentication                                                                    | Run its sign-in command, or open `/mcp` in Claude Code, and finish the browser steps.                                                   |
| The consent page says connecting a coding agent takes the Owner, Admin or Developer role, or a competence | Ask an Admin for the role or the competence.                                                                                            |
| The consent page says your account cannot connect agents yet                                              | Confirm your email address or set up two-factor authentication, then start again from the agent.                                        |
| The consent page says the request expired                                                                 | Start the connection again from the agent.                                                                                              |
| The agent can read but not save or deploy                                                                 | It holds less access than the call needs. Connect it again and allow more; **Edit automations** and **Edit and deploy** can be allowed only by Owners, Admins and Developers.      |
| A call is refused with `ORG_MISMATCH`                                                                     | The call names an organization other than the one the agent was connected to. Connect the agent to each organization it should work in. |
| The page is not in Settings                                                                               | Agent sign-in is off, or you may not connect an agent here and hold no connection. Ask an Admin.                                        |

Operators find what the deployment must provide in [Let coding agents sign in](/self-hosted/configuration/authentication#coding-agent-sign-in).
