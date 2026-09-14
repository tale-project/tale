---
title: Set automation approval rules
description: Configure which connector writes need human approval and verify how rules are resolved.
---
Automation approval rules decide whether a live connector write runs immediately or waits for a person. The default requires approval for writes to external systems; writes through platform-authenticated internal connectors are allowed. Override that behavior for one organization when its review process needs a different boundary.

## Define the organization’s policy

Store rules in `TALE_CONFIG_DIR/<orgSlug>/governance/approval-policy.yml`. Each rule names exactly one `connector` or one qualified `action`, followed by `decision`.

This example requires review for writes through the internal `task` connector and allows `imap-smtp.send` without a separate approval:

```yaml
rules:
  - connector: task
    decision: require_approval
  - action: imap-smtp.send
    decision: auto_approve
```

<Warning>

`auto_approve` permits the matching write without a human review at this gate. Check the exact action, credentials and intended recipients before allowing an external action such as sending email.

</Warning>

Use connector and action identifiers from the shipped catalog, not translated display names. The action form is `<connector>.<action>`; the allowed decisions are `auto_approve` and `require_approval`.

## Resolve overlapping rules

An action rule wins over a connector rule regardless of their order. Among equally specific matching rules, the last one wins. If no rule matches, Tale uses the internal-versus-external default above. Keep each target once where possible so readers can predict the result without tracing overrides.

The policy affects new gate evaluations. A pending approval is retained when you relax the rule; it does not silently become approved. This file also does not remove independent review gates such as publishing an automation or completing a task that needs review.

## Verify the effect

Test with an isolated automation and harmless data before enabling a rule for production work. Confirm one matching operation and one operation that should keep its default behavior. Inspect the pending approval and run trace through the [approval workflow](/platform/approvals/configure).

New write decisions read the current policy and organization slug without the short display cache. If the policy is invalid or its configuration root is unavailable, the operation stops before the write; repair the configuration before retrying. Only an absent policy file in an available configuration tree uses the default rules. A malformed `.yml` file never falls back to a sibling `.json`. Existing approval records keep their recorded decision, including pending approvals and previously granted operations.
