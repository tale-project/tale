---
name: issue-desk
description: A config-driven multi-agent "issue resolution desk" pack. GitHub issues (bound to tasks by the github sync) flow through a fixed process — coordinator triages and assigns by role, an implementer agent resolves the issue in a sandbox, a deterministic step runs the repo's tests, a human signs off, and a pull request is opened. The whole app is data (one annotated workflow + roles + a localized label catalog) running on the platform skeleton — no per-vertical system code.
pack:
  messageNamespace: issueDesk
  messagesDir: messages
  roles:
    - coordinator
    - implementer
    - reviewer
---

# Issue resolution desk

A demonstration **pack** for the config-driven platform skeleton. It composes
existing platform primitives — no new system code — into a friendly,
multi-agent, human-gated process:

1. **Intake** — the `github` issue sync upserts each issue onto the board as a
   task keyed by `owner/repo#n` (`externalSystem: "github"`); assigning it to an
   agent triggers `workflows/issue-desk/desk-process.json`.
2. **Coordinator** (`role: coordinator`) triages and assigns by role.
3. **Implementer** (`role: implementer`, an external-runtime Claude-Code agent
   bound to the `github` integration) clones the repo and fixes the issue on a
   `tale/<id>` branch.
4. **Verify** — a deterministic `sandbox` step runs the repo's tests and returns
   a pass/fail verdict.
5. **Review** (`role: reviewer`) — a human approval gate, the only path to done.
6. **Deliver** — a pull request is opened via the `github` connector.

Roles resolve to concrete agents through the org-chart delegation graph; the
step `ui` annotations let the generic operator workspace render the run with no
bespoke UI. Tier-2 labels live in `messages/{en,de,fr}.json`.
