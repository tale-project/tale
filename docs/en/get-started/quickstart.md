---
title: Quickstart
description: From nothing to your first agent answer — get an instance, sign in, and send your first message. Five minutes on Cloud, fifteen on your own machine.
---

This is the shortest path to a working chat with an agent: get an instance, sign in, send a message, watch the reply stream. It takes about five minutes on Cloud and fifteen on your own machine, and it ends with the screen below — a real answer from an agent over your workspace.

<Frame caption="Where this quickstart ends: a streamed agent reply in the Chat tab.">

![A chat thread showing a user question about onboarding feedback and an assistant reply containing a markdown table of three themes.](/images/platform/chat-thread-reply.webp)

</Frame>

## Get an instance

The two editions run the same product — pick by who should operate the stack.

<Tabs>

<Tab title="Cloud">

Visit [tale.dev](https://tale.dev) and click **Get started**. The sign-up form asks for your name, email, and a password; verify the email link when it arrives, name your organization, and you land in the dashboard. The setup wizard offers to connect an AI provider right away — paste an [OpenRouter](https://openrouter.ai) key there and chat works immediately. The [admin journey](/get-started/admins) walks the same wizard with screenshots when you want more than the happy path.

</Tab>

<Tab title="Self-hosted">

With [Docker](https://www.docker.com/products/docker-desktop) running, three commands stand up the whole stack on your machine:

```bash
curl -fsSL https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.sh | bash
tale init my-project && cd my-project
tale dev
```

The first run pulls images — expect five to ten minutes. When the browser opens, sign up: the first account claims the **Owner** role and creates your organization. The [self-hosted quickstart](/self-hosted/install/quickstart) covers every step in depth, including Windows and troubleshooting.

</Tab>

</Tabs>

## Send your first message

<Steps>

<Step title="Open a new chat">

Click **New chat** in the sidebar. The composer at the bottom of the screen is where everything starts: the agent picker on the left, the model picker beside it, and the message field with send on the right. The composer waiting with **Assistant** and **Auto** preselected means you are ready to send.

<Frame caption="The composer — agent picker, model picker, message field.">

![The chat composer strip with agent picker, model picker, and send button.](/images/platform/chat-composer.webp)

</Frame>

</Step>

<Step title="Ask something real">

Leave the agent on **Assistant** and the model on **Auto** — Tale resolves the best available model at request time. Type a question and send it. The reply streams in token by token; when the agent reasons before answering, a collapsible thinking line appears above the reply.

<Check>

A streamed reply that answers your question means the whole chain works — provider, model routing, and agent. You have a working workspace.

</Check>

</Step>

</Steps>

## Where you are now

You have a running instance and an agent that answers. The next fifteen minutes depend on your role: the [member journey](/get-started/members) covers documents and projects, the [editor journey](/get-started/editors) publishes your first specialist agent, the [admin journey](/get-started/admins) sets up the team and providers, and the [developer journey](/get-started/developers) gets you an API key and your first request.
