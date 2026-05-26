---
title: Image generation
description: Image generation as an agent capability — picking an image-tagged model, costing, and how generated images surface in the reply.
---

Image generation is a capability an agent gets by picking an image-tagged model. The agent's reply can include generated images alongside text; the user sees the image inline in the chat the way an attachment renders. This page covers the wiring.

The mechanics depend on the underlying provider — quality, cost, and speed vary widely. Tale's job is to expose the capability to the agent and the user; the provider's job is to make the image.

## Picking the model

In the agent's **Instructions & model** tab, the model picker exposes models tagged **Image generation**. Pick one as a secondary model and the agent's tool list gains an image-generation tool; the agent can invoke it during a reply when the model decides the user wants an image. Some providers expose **Image editing** as a separate tag — pick that one to let the agent edit an attached image rather than create one from scratch.

## How it surfaces

When the agent generates an image, the reply renders the image inline next to the agent's text. Hovering shows a small **Image preview** chip; clicking opens the full-size preview with **Previous image** and **Next image** controls if the reply produced more than one. The image is stored in the chat's object store alongside attachments and inherits the chat's retention rules.

## Cost and budget

Image models cost more per call than text models — sometimes ten times more. The org's [Policies and limits](/platform/admin/governance/policies-and-limits) can cap image cost per user, per team, or per agent; hitting the cap surfaces as a toast and the image fails to render. Cost is visible in [Usage analytics](/platform/admin/governance/usage-analytics) under the same Top Models table as the text models.

## Where this fits

Image generation is one extra tag on the model picker — the rest of the agent's shape stays the same. The drift candidate here is provider and model names; pair this page with the running models list in [Providers](/platform/admin/providers) rather than memorising specific model strings.
