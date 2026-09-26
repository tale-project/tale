---
title: Send your first message
description: Sign in to Tale, start a chat, choose a model, and check the response.
---

Start here when you have access to a Tale workspace and want to get your first answer. You will send a short prompt, read the response, and find the conversation again.

## Before you begin

You need your instance address, an account, and a workspace with an AI provider connected. Ask the person who manages your workspace for access. To install your own instance, follow the [self-hosted quickstart](/self-hosted/install/quickstart); for a managed instance, follow [Cloud onboarding](/cloud/onboarding).

An account lets you sign in. Your organization is the workspace that holds your team’s members, projects, and configuration. Your role controls which actions you can take there.

## Start a conversation

<Steps>

<Step title="Sign in and start a chat">

Open your instance and sign in with the method your administrator provided. If you belong to several organizations, choose the one where you want to work. Open **Home**, then choose **New chat**, the pencil at the top of the Home list.

</Step>

<Step title="Check the model and write a prompt">

Use the model control below the message field to inspect the available models. It may show **Auto**; you can choose a specific model when you want to control which one answers. The available choices depend on your workspace’s connected providers and access rules.

<Frame caption="The message field and model control are in the same composer.">

![The chat composer contains the message field, the model selector, attachment controls, and the send button.](/images/platform/chat-composer.webp)

</Frame>

For a first test, use a self-contained request: “Write a three-item checklist for preparing a team meeting. Keep each item to one sentence.” This does not depend on uploaded documents or connected tools.

</Step>

<Step title="Send and read the answer">

Select **Send message** or press Enter. Your message appears in the conversation, followed by the assistant’s response. A thinking indicator may appear before the answer. Wait for the response to finish before evaluating it.

Check whether it followed the requested length and format. Ask a follow-up such as “Add who should prepare each item.” The same conversation retains the context of your earlier messages.

</Step>

</Steps>

## Find the chat again

Home lists the conversation under **Today**; choose it to reopen it. A new chat starts a separate conversation; it is useful when you change subjects. For names, history, and response controls, read [Chat basics](/platform/chat/basics).

<Tip>

Give the model the goal, the information it should use, and the format you need. “Summarize these notes as decisions and open questions” gives it a clearer task than “Help with this.”

</Tip>

## If you cannot get an answer

| What you see | What to do |
| --- | --- |
| You cannot sign in | Check the instance address and sign-in method with your administrator. |
| No models are available | Ask an administrator to check [AI providers](/platform/admin/providers) and your model access. |
| A provider or model error | Try another available model and report the displayed error to the administrator. |
| A usage limit message | Ask the administrator to review the relevant [policy](/platform/admin/governance/policies-and-limits). |
| An answer without your documents | This first prompt did not supply a source. Follow [chat attachments](/platform/chat/attachments) or [knowledge](/platform/knowledge/overview) to add one. |

Continue with [using Tale with your team](/get-started/members) or [writing effective prompts](/tutorials/member/chat-effectively).

<Video src="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.mp4" poster="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.webp" captions="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.vtt" lang="en" title="Episode 1 — Welcome to Tale" caption="Episode 1 — Welcome to Tale (2:48)">

</Video>
