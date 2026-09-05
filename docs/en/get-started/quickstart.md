---
title: Quickstart
description: From nothing to your first agent answer — get an instance, sign in, and send your first message.
---

This is the shortest path to a working chat with an agent: get an instance, sign in, send a message, watch the reply stream. It takes about five minutes on a ready instance and fifteen if you stand one up on your own machine, and it ends with the screen below — a real answer from an agent over your workspace.

<Frame caption="Where this quickstart ends: a streamed agent reply in the Chat tab.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

Prefer the tour as a video? Episode 1 walks the same ground in three minutes — captions included.

<Video src="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.mp4" poster="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.webp" captions="/videos/en/tutorials/ep1-welcome/ep1-welcome.en.vtt" lang="en" title="Episode 1 — Welcome to Tale" caption="Episode 1 — Welcome to Tale (2:48)">

</Video>

## Get an instance

The two editions run the same product — pick by who should operate the stack.

<Tabs>

<Tab title="Self-hosted">

With [Docker](https://www.docker.com/products/docker-desktop) running, three commands stand up the whole stack on your machine:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

The first run pulls images — expect five to ten minutes. When the browser opens, sign up: the first account claims the **Owner** role and creates your organization. The [self-hosted quickstart](/self-hosted/install/quickstart) covers every step in depth, including Windows and troubleshooting.

</Tab>

<Tab title="Cloud">

Cloud instances are set up for you: fill in the [demo request form](https://tale.dev/request-demo) and the Tale team provisions your own instance. Once it is ready, open it and sign up — the form asks for your name, email, and a password; verify the email link when it arrives, name your organization, and you land in the dashboard. The setup wizard offers to connect an AI provider right away — paste an [OpenRouter](https://openrouter.ai) key there and chat works immediately. The [admin journey](/get-started/admins) walks the same wizard with screenshots when you want more than the happy path.

</Tab>

</Tabs>

## Send your first message

<Steps>

<Step title="Open a new chat">

Click **New chat** in the sidebar. The composer at the bottom of the screen is where everything starts: the message field, and one picker naming the model the reply will come from. A model already showing on the picker means you are ready to send — the assistant itself is built in, so there is nothing else to choose.

</Step>

<Step title="Ask something real">

Pick any chat model from the picker — every reply comes from the model you named, so nothing is chosen for you behind the scenes. Type a question and send it. The reply streams in token by token; when the agent reasons before answering, a collapsible thinking line appears above the reply.

<Check>

A streamed reply that answers your question means the whole chain works — provider credential, model, and assistant. You have a working workspace.

</Check>

</Step>

</Steps>

## Where you are now

You have a running instance and an agent that answers. The next fifteen minutes depend on your role: the [member journey](/get-started/members) covers documents and projects, the [editor journey](/get-started/editors) publishes your first specialist agent, the [admin journey](/get-started/admins) sets up the team and providers, and the [developer journey](/get-started/developers) gets you an API key and your first request.
