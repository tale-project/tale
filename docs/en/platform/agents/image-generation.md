---
title: Image generation
description: Image generation is a tool any agent can be granted — generate_image produces a picture inline in the reply, on a model picked per turn like any other.
---

Image generation in Tale is a tool, not a kind of agent. Any agent granted `generate_image` can produce a picture inline: ask it to create, draw, or design something, the model calls the tool, and the image renders in the reply the way an attachment does. There is no mode to switch into first and no specialised persona to pick.

This page covers that tool — what it does, how you grant or withhold it, how the result lands in the conversation, and what it costs. The mechanics underneath belong to the provider: quality, price, and speed vary widely between image models.

## The generate_image tool

`generate_image` takes one thing — a prompt describing the picture to make. That prompt is self-contained, because the image model never sees the conversation: the agent folds everything you said about style, mood, composition, and colour into the single description it sends. The result comes back as a file, renders inline, and the agent's text wraps around it.

Being an ordinary tool means everything true of the rest of the tool surface is true here. The model decides when to call it from the list its agent was granted, the call and its result appear in the conversation like any other tool call, and an agent that was never granted it cannot reach it at all.

## Grant it or withhold it

Open the agent's **Tools** tab and grant `generate_image` where the job involves pictures; leave it off for an agent that should only ever answer in text. There is nothing else to configure — no per-agent image setting, no image-only persona, and no type to switch an agent into.

The model behind the picture comes from the same place as every other model: whoever sends the message picks it in the composer, rather than the agent pinning one. An organization whose providers offer nothing image-capable gets a clear refusal instead of a guess, which is the cue for an admin to add one under [Providers](/platform/admin/providers).

## How the image lands in the reply

The generated image renders inline next to the agent's text and opens full size when you click it. The file is stored alongside the conversation's attachments and inherits the same retention rules, so a generated picture is exactly as durable — and as deletable — as anything you uploaded to that chat yourself.

Because the image arrives through a tool call, it is auditable like one: the prompt the model actually sent is visible in the call, which is usually the fastest way to work out why a picture came back different from what you pictured.

## Cost and budget

Image models cost more per call than text models, sometimes by an order of magnitude. The organization's [Policies and limits](/platform/admin/governance/policies-and-limits) cap spend per user, per team, and per agent, and hitting a cap surfaces in the chat instead of rendering a picture. Spend shows up in [Usage analytics](/platform/admin/governance/usage-analytics) in the same tables as text usage.

## Where this fits

Image generation is one entry on one list, and that is the whole point: an agent that should draw gets `generate_image`, an agent that should not does not, and no part of the persona has to be reshaped around pictures. The drift candidates here are provider and model names — pair this page with the running list in [Providers](/platform/admin/providers) rather than memorising model strings, and with [Agent tools](/platform/agents/tools) for the rest of the catalog.
