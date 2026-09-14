---
title: Models
description: Set default models, restrict model access, and choose the model that reads images for text-only agents.
---

Use **Settings > Governance > Models** as an Admin or Owner to choose the models members start with and the models they may use. Defaults guide a choice; access rules enforce a restriction. Configure [provider credentials](/platform/admin/providers) first so the intended models are available.

<Frame caption="Settings > Governance > Models — the per-scope default-model rules, with the model-access allowlist below them and the vision model further down.">

![The Models governance page showing the default-models table with three rules — a default for all users, and role rules for Developer and Member, each pinned to an OpenRouter model — above the model-access section set to Allowlist with one allowed-models rule per role.](/images/platform/governance-content-models.webp)

</Frame>

## Set a default model

1. Under **Default models**, select **Add rule**.
2. Choose **Default** for the baseline, **Role** for a role, or **Team** for a team. Select the target when needed.
3. Choose a provider and model, then **Confirm**. Save the page's pending changes in the header.
4. Start a chat as a member of the target group with its model on **Auto**, and check the resolved model.

The default is used when there is no explicit model choice. A team rule takes precedence over a role rule, followed by the baseline default. A default does not prevent someone from selecting another permitted model.

## Restrict model access

Under **Model access**, choose the mode and add rules for the users, teams, roles, or default scope you want to cover.

| Mode | Effect for a matching rule |
| --- | --- |
| **Allowlist** | Only listed allowed models may be used; a blocked model remains denied. |
| **Blocklist** | Models are permitted unless listed as blocked. |

Access resolves user rules before team rules, then role rules, then the default. Multiple matching team rules combine their lists; an explicit block still wins for that model. If no rule matches, the policy does not restrict that user. Add a baseline rule when you intend to cover everyone.

Access is checked when a model is used, including an explicitly selected or pinned model. A configured default must also pass the check. If it is denied, automatic selection can fall back to an allowed model. The editor warns about a default that conflicts with access rules; resolve that warning so the intended default is actually used.

<Tip>
Test both cases after changing access: an allowed model should work and a denied model should be refused for the affected member. Testing only as the admin does not prove a role-specific rule.
</Tip>

## Choose the image-reading model

A text-only agent needs help reading an image, such as a screenshot or scanned page. **Vision model** selects the model that transcribes it. An agent whose own model reads images does not use this fallback.

Leave **Model that reads images** on **Automatic** to follow the available provider catalog. Tale prefers a recommended vision model and otherwise selects a reachable low-cost option. The text below the picker identifies the current choice and reason.

Pin a model if you need a stable choice. The picker offers models suitable for transcription. If a pin later becomes unavailable, Tale falls back to automatic selection. Review the current choice after rotating credentials or changing model availability.

## Diagnose an unexpected choice

Check the member's roles and teams, the explicit chat selection, the matching default, the access rule, and the provider credential's model list. A model appearing in a catalog does not establish that the organization has usable credentials for it. Spending and token caps still apply through [Policies and limits](/platform/admin/governance/policies-and-limits).
