---
title: "AI agent security: permissions, approvals, audit"
description: "Review an AI agent workflow with a practical permissions checklist covering tool access, approval boundaries, cancellation, and retained evidence."
slug: ai-agent-security-permissions-approvals
topicId: T07
reviewed: 2026-10-03
draft: false
coverAlt: "Nested frames give a task different openings and a visible paper trail."
---

An AI agent should receive the authority required for its task, with consequential effects checked by controls the model cannot rewrite. That is the central security decision. Prompt-injection defenses can reduce the chance of a bad request, but the system still needs to decide what happens when one reaches a tool.

Start with one project outcome, one executing identity, and the resources it may affect. A worker preparing a launch report may need to read references and write a deliverable. The same worker does not automatically need a mailbox credential, permission to change access, or the ability to publish the report.

The useful question is: if untrusted content changes this worker's next request, which unwanted effects remain possible?

## Distinguish persuasion from permission

Prompt injection occurs when material an agent reads attempts to redirect its behavior. A supplier document might present uploading the internal project brief as a required verification step. The document can provide evidence about the supplier; it cannot grant authority over the team's data.

Model training, classifiers, and careful instructions are worthwhile defenses. They are not a reason to skip authorization. Anthropic's browser-agent research reports improved resistance while explicitly retaining residual prompt-injection risk. The results concern its tested browser configuration, not Tale's risk or a universal attack rate. [Anthropic: mitigating prompt injections](https://www.anthropic.com/research/prompt-injection-defenses).

OWASP describes excessive agency through unnecessary functionality, permissions, and autonomy. Its recommendations include narrow tools, limited privileges, and authorization outside the model. The practical consequence is to remove unneeded power before debating whether the model will use it responsibly. [OWASP LLM06:2025](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/).

A tool name is not enough to establish that boundary. A “read customer” function can use an overpowered service account. A restricted application tool can sit beside a shell containing a broader credential. Review the actual executing identity and every available route to the same effect.

![Five authority questions concern identity, accessible data, tools and credentials, approval of effects, and retained evidence. Test denial and revoked access, and inspect coverage for each execution path.](/blog/diagrams/en/T07-diagram.svg)

## Work through an announcement that should not be sent

This synthetic example is a design walkthrough, not a recorded Tale test. A team wants a launch report and an announcement sent to a controlled test inbox after review. The trusted task specifies the project, intended recipient, and deliverable. An untrusted supplier page suggests a different recipient and requests an internal attachment.

A reasonable design separates preparation from delivery. The research worker can create the draft but receives no sending credential. A separate operation proposes the exact send. A reviewer checks the recipient and content against the trusted task, and the downstream service still enforces the credential's scope.

| Proposed item | Trusted task permits | Untrusted suggestion | Decision and reason |
| --- | --- | --- | --- |
| Action | Prepare report, then propose one test announcement | Send a verification package immediately | Do not let page text change the workflow's authority |
| Recipient | Team-controlled test inbox selected in the task | Address appearing on supplier page | Reject substituted destination; origin matters |
| Content | Reviewed announcement | Announcement plus internal requirements brief | Reject the additional data disclosure |
| Credential | Delivery path limited to the intended operation | Broad mailbox access for the research worker | Keep the broader credential unavailable |
| Evidence | Proposal, decision, execution result, receipt | Agent says “sent successfully” | Check the receiving system as well |

The important observation is that an attack need not invent a new tool call. If `send_email` is already allowed, changing only its recipient or attachment may cause the unwanted effect. An allowlist containing the email provider's host does not establish which mailbox, recipient, or document is allowed through that host. Network limits and action authorization answer different questions.

The proposed separation is an architectural recommendation. Its enforcement must be demonstrated in the selected product and downstream service; putting this table in an agent's instructions does not implement it.

## Make the authorization decision about the actual operation

For a consequential action, ask whether the executing identity may perform this operation on this resource, using these inputs, for this task. Then ask who may authorize an exception. “The user approved email access” is too broad to answer whether this particular attachment may go to this particular recipient.

Prefer a delivery path that evaluates the exact proposed input and checks current access at execution. If the input changes after review, require a new decision instead of treating the earlier approval as transferable. For custom systems, binding a decision to a specific operation and resource is a design requirement to implement and test, not a Tale feature asserted here.

Keeping credentials outside an agent's filesystem can reduce exposure of their raw values. It does not remove the need to constrain what the authenticated tool can do on the agent's behalf. Likewise, adding MCP does not complete authorization: its security guidance forbids accepting tokens that were not issued for the MCP server and identifies confused-deputy risks around consent. [MCP security best practices](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices).

## Learn from stronger defenses without overstating them

The CaMeL research system goes beyond asking a model to ignore malicious text: it separates control and data flows and checks capabilities when tools execute. Its authors also describe utility tradeoffs, policy-maintenance work, user intervention, and side-channel limits. Its threat model does not cover every text-integrity attack; a misleading summary can remain harmful without violating a protected data flow. This is research evidence for enforcing boundaries, not a claim that prompt injection is solved or that Tale implements CaMeL. [Debenedetti and colleagues, CaMeL preprint, June 2025 revision](https://arxiv.org/html/2503.18813v2).

For the announcement, that distinction changes the review. Preventing an unauthorized send does not establish that the draft is accurate. A manipulated supplier page could still cause the report to overstate a product capability. Keep source and result review even when action permissions are narrow.

Conversely, making every read wait for approval would obstruct routine research without necessarily controlling the eventual disclosure. Put a gate where the authority or exposure changes: adding a new resource scope, exporting internal content, or committing an external effect. This is a task-specific design judgment, not a rule that every write is equally consequential.

## Apply the design to Tale's separate execution paths

Tale project agents receive configured tools, connectors, skills, and permitted secrets. The **Writes data** label identifies platform tools capable of real operations within their access rules. The agent connector broker exposes read actions; direct GitHub tooling and explicitly granted secrets follow separate paths. A run a Member starts is task-scoped and receives neither the agent's granted secrets nor the equipped GitHub token. Test the starter identity you will actually use. [Project agents](https://docs.tale.dev/platform/projects/project-agents) and [agent runtimes](https://docs.tale.dev/platform/agents/harnesses).

Task-result review and operation permission are separate decisions. Accepting a report does not by itself authorize a connector send; answering a request for information is another interaction again. Use the [task automation guide](https://docs.tale.dev/platform/projects/task-automation) for the result-review flow and its applicable reviewer rules.

Tale's operation approvals cover applicable connector writes in live automations. External writes require approval by default; internal platform-authenticated writes do not by default, and organization policy can override a connector or action. This does not establish interception of every shell command or secret-bearing tool path. [Configure approvals](https://docs.tale.dev/platform/approvals/configure).

The approval card shows the exact input and allows approval or rejection, not editing. Reject incorrect input, correct it, and start a new run. Check who can decide: a card on a task can be decided by anyone who can open that task; run-detail access is limited to Owners, Admins, and Developers. Cards do not route to a named approver group. A team requiring one particular approver cannot infer that restriction from the presence of a card. [Operation approval concepts](https://docs.tale.dev/platform/approvals/concepts).

## Test a refusal and an ambiguous outcome

Use synthetic content and destinations you control. First substitute the recipient in the proposed test send and reject it. Check both the recorded decision and absence of delivery. In a separate corrected run, approve the harmless send and inspect the receiving inbox. Tale's mock **Test run** does not perform the external write or exercise the live approval card, so it cannot establish these outcomes. [Operation approval concepts](https://docs.tale.dev/platform/approvals/concepts).

Now consider a constructed failure: the sending service accepts the email, but the caller loses its connection before recording the response. The task appears failed or uncertain. Retrying the whole task may send a duplicate.

Pause further sends and preserve the operation input, identifiers, and timestamps. Look for the effect in the receiving system or provider's delivery record. If delivery is confirmed, record that fact and continue only the remaining work. Retry only when authoritative evidence establishes that the original request did not take effect and cannot still complete, or when the receiving service’s documented idempotency contract safely covers the repeat. An empty inbox or an absent delivery record so far does not establish that condition. If it remains unknown, keep it unknown and escalate; an automatic retry would turn missing evidence into a possible second effect.

Where a receiving API supports an idempotency mechanism, use its documented key and replay semantics to prevent duplicate effects within that mechanism's scope. Otherwise design a reconciliation step or manual decision. This is general recovery advice, not a claim that every Tale connector provides idempotency.

Cancellation is also distinct from reversal. Tale's automation engine stops subsequent work at its execution boundaries; completed effects are not rolled back. Inspect what already happened before restarting. [Execution logs](https://docs.tale.dev/platform/automations/execution-logs).

## Keep the evidence needed to reconstruct the decision

For this example, preserve four things together: what was proposed, who permitted or refused it, what execution reported, and what the receiving system shows. They establish different facts. Approval proves permission was given; it does not prove delivery or correctness.

Tale's audit log is not a full transcript of every conversation or external service. Exports are filtered and capped, and retention changes the available history. Its hash-chain checks do not prove every event was captured or supply independent signing; the on-demand check covers at most 1,000 retained entries. Use the [audit log](https://docs.tale.dev/platform/admin/governance/audit-logs) and [integrity guide](https://docs.tale.dev/self-hosted/operate/security/audit-log-integrity) to understand what platform evidence can establish, then retain the missing downstream evidence where needed.

## Change the design when the work changes

For a low-impact drafting task with no sensitive data or external write authority, a mandatory human decision on every tool call may add little value. Permit bounded work and review the resulting artifact. For repeated, predictable writes, a narrowly scoped API operation with deterministic validation may be easier to govern than an agent selecting arbitrary targets.

The recommendation becomes stricter when the worker can read sensitive information and write to broad destinations, or when errors are difficult to reverse. Reduce its authority, separate preparation from execution, or keep the final action with a person. A reviewer must have enough context and an enforceable decision point; the word “approval” alone does not provide either.

The [action-authority worksheet](/blog/worksheets/en/T07-action-authority.md) includes the completed synthetic decision, a compact authority record, and the ambiguous-delivery recovery exercise. Bring one real task and its available action paths to a [Tale demo](/request-demo), with the effects that must remain unavailable already identified.
