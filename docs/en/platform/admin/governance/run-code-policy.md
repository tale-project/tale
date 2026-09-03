---
title: Run-code policy
description: The package allowlist and denylist that gate what sandboxed Run code can install. Admins and Owners read this when an agent needs a new library or when an audit asks why a package was blocked at a given time.
---

Run-code policy is the surface where you decide which Python and Node packages the sandbox can install at execution time. Skills with scripts and the Run code tool both run in the same sandbox; this policy is the single seam where you tighten or loosen what they can install. Admins and Owners read this page when an agent needs a new library, or when an audit asks why a package was blocked at a given time.

<Frame caption="Governance > Run-code packages — the default-mode radiogroup above the Python and Node allow and deny lists.">

![The Run-code policy governance page with Allowlist picked in the default-mode radiogroup, above a Python allow list holding pandas, numpy, scipy, and scikit-learn, a Python deny list holding paramiko, fabric, pexpect, and scapy, and a Node allow list holding axios, date-fns, dayjs, and lodash.](/images/platform/governance-run-code-policy.webp)

</Frame>

## A worked switch

The default mode is **Denylist** with an empty list, which means every package is installable. To switch to a curated set, open **Settings > Governance > Run-code packages**, change the mode to **Allowlist**, and enumerate the packages you trust under **Python allow list** and **Node allow list**. Save and the next sandbox run that requests a package outside the list fails with the **not on the allow list** reason in the audit event.

## The two modes

| Name      | Default | Description                                                                                                       |
| --------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Allowlist | off     | Only the listed packages install; everything else is rejected. Use when a regulator names the approved libraries. |
| Denylist  | on      | Every package installs except the listed ones. Use when a small set is known-bad and the rest is trusted.         |

## The four lists

Each mode reads from two lists — Python and Node. One package per line, or comma-separated. Version constraints are stripped automatically (`pandas==2.1` matches `pandas`), so the policy is name-based and survives library upgrades. Scoped Node packages (`@scope/pkg`) are supported.

The mode is global: in allowlist mode both languages read their allow lists, in denylist mode both read their deny lists. The lists themselves are per language, so Python and Node each keep their own set.

## The tester

The Test panel on the same page lets you paste pip or npm specs and see whether each one would pass under the current draft. It uses your unsaved edits, so you can iterate before clicking Save. Each spec is parsed, stripped of its version constraint, and matched against the lists; the panel reports **Allowed** or **Denied** with the reason — matches-the-allow-list, not-on-the-allow-list, matches-the-deny-list, not-on-the-deny-list.

## Network egress and skills

The package policy gates _what_ runs in the sandbox. The same sandbox runs skill scripts — see the [Skills concept](/platform/agents/skills) page. Outbound network from sandbox code is open by default, with cloud-metadata and private-range targets always blocked; on self-hosted deployments the operator can restrict it to a hostname allowlist at the deployment level — the walk lives in [Hardening](/self-hosted/operate/security/hardening). Treat publishing a skill with a script as widening the trust surface for every agent that picks it up; the package policy and the deployment's egress policy together decide what the script can do.

## Where this fits

Run-code policy is the gate on the sandbox that backs both the Run code tool and skill scripts. The companion concept is [Agent skills](/platform/agents/skills) — it covers when to publish a script as a skill, and why the package policy is the load-bearing gate. The companion governance page is [audit logs](/platform/admin/governance/audit-logs) — every denied package install lands there with the spec and the reason.
