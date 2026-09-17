---
title: Models
description: Set default models, restrict access, and choose separate models for images and audio transcription.
---

Use **Settings > Governance > Models** as an Admin or Owner to choose the models members start with and the models they may use. Defaults guide a choice; access rules enforce a restriction. Configure [provider credentials](/platform/admin/providers) first so the intended models are available.

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

For chat, access is checked when a model is used, including an explicitly selected or pinned model. A configured default must also pass the check. If it is denied, automatic selection can fall back to an allowed model. The editor warns about a default that conflicts with access rules; resolve that warning so the intended default is actually used.

<Tip>
Test both cases after changing access: an allowed model should work and a denied model should be refused for the affected member. Testing only as the admin does not prove a role-specific rule.
</Tip>

## Choose the image-reading model

A text-only agent needs help reading an image, such as a screenshot or scanned page. **Vision model** selects the model that transcribes it. An agent whose own model reads images does not use this fallback.

Leave **Model that reads images** on **Automatic** to follow the available provider catalog. Tale prefers a recommended vision model and otherwise selects a reachable low-cost option. The text below the picker identifies the current choice and reason.

Pin a model if you need a stable choice. The picker offers models suitable for transcription. If a pin later becomes unavailable, Tale falls back to automatic selection. Review the current choice after rotating credentials or changing model availability.

## Choose the audio transcription model

**Audio transcription model** controls server transcription for audio and video attachments, the audio fallback for video links, and dictation in browsers without built-in speech recognition. Browser speech recognition uses its own service and keeps priority when supported.

<Frame caption="Audio transcription has its own organization-wide automatic or fixed model selection.">

![The Audio transcription model section shows Automatic and identifies the current server transcription model.](/images/platform/governance-content-models.webp)

</Frame>

An active default credential for OpenRouter also makes its dedicated speech-to-text models available here. Tale discovers them from the OpenRouter catalog. Check that the credential’s allowed models include your intended transcription model, then use **Automatic** or select that model explicitly.

1. Under **Model that transcribes audio**, leave **Automatic** selected to let Tale choose an available compatible model, or select a specific provider and model.
2. Save the page's pending changes in the header. Until you save, the selection is a draft; discard it to keep the saved setting.
3. Check the current model shown below the picker. Test a short recording before relying on the setup for a longer upload.

A model change applies to new transcription work; completed attachments keep their existing transcript. Uploading the same bytes again reuses completed work for the same transcription target, but transcribes them again when the target provider or model differs.

An explicit selection stays fixed. If that model becomes unavailable, Tale reports it and does not switch to another model. Choose another available model or **Automatic**, then save. If no compatible model is available, configure an active credential in [AI providers](/platform/admin/providers) and check the credential’s allowed models. A temporary failure to check the configuration calls for a retry, not a new model selection.

Members see the problem before uploading audio or video. Settings actions appear according to their access; otherwise, they are asked to contact an admin. For deployment-managed selection and custom audio endpoints, see the [self-hosted provider reference](/self-hosted/configuration/providers#configure-audio-transcription).

## Diagnose an unexpected choice

Check the member's roles and teams, the explicit chat selection, the matching default, the access rule, and the provider credential's model list. A model appearing in a catalog does not establish that the organization has usable credentials for it. Spending and token caps still apply through [Policies and limits](/platform/admin/governance/policies-and-limits).
