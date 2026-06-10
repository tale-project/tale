---
title: Image generation
description: Image generation as an agent capability — any assistant can create an image inline when the workspace has an image model, how generated images surface, and what they cost.
---

Any assistant in Tale can generate images. Ask it to create, draw, or design something and it produces the image inline, the way an attachment renders in the reply — there's no separate mode to switch into first. This works whenever the workspace has an image-generation model configured; this page covers the wiring.

The mechanics depend on the underlying provider — quality, cost, and speed vary widely. Tale's job is to expose the capability to the agent and the user; the provider's job is to make the image.

## Asking any assistant for an image

Every assistant carries an image tool it reaches for when you ask it to create a picture, logo, or illustration. The assistant calls the tool, the image renders inline, and its text wraps around the result the way it would around an uploaded attachment. Because the tool ships with every assistant, the **Auto** assistant handles an image request too — you don't have to pick a specialised agent first.

The image comes from the workspace's image-generation model — the one an admin set up under [Providers](/platform/admin/providers) and tagged **Image generation**. There's nothing to configure per agent. When the workspace has no such model, the assistant tells you image generation is unavailable instead of guessing, so an admin knows to add one.

## How it surfaces

When the agent generates an image, the reply renders the image inline next to the agent's text. Hovering shows a small **Image preview** chip; clicking opens the full-size preview with **Previous image** and **Next image** controls if the reply produced more than one. The image is stored in the chat's object store alongside attachments and inherits the chat's retention rules.

## Cost and budget

Image models cost more per call than text models — sometimes ten times more. The org's [Policies and limits](/platform/admin/governance/policies-and-limits) can cap image cost per user, per team, or per agent; hitting the cap surfaces as a toast and the image fails to render. Cost is visible in [Usage analytics](/platform/admin/governance/usage-analytics) under the same Top Models table as the text models.

## Where this fits

Image generation rides on one thing — a model tagged **Image generation** in the workspace — and from there every assistant can produce a picture inline, the **Auto** assistant included. The drift candidate here is provider and model names; pair this page with the running models list in [Providers](/platform/admin/providers) rather than memorising specific model strings.
