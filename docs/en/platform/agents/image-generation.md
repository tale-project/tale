---
title: Image-generation agents
description: Configure agents that generate or edit images with FLUX, Imagen, Nano Banana, GPT-Image, or any compatible model.
---

Image-generation agents take a prompt, optionally a reference image, and produce a new image as the assistant turn. They reuse the standard agent configuration (instructions, knowledge, tools, conversation starters) but bind to a model tagged `image-generation` or `image-edit` instead of a chat model. Picture an agent for marketing thumbnails, product mock-ups, social cards, or quick concept art — whatever the team needs as a one-message round-trip rather than a full image-editing workflow.

The model picker in chat shows image-generation agents alongside chat agents. When a user picks one, the composer switches to an image-aware mode: a thumbnail picker for reference images, a prompt placeholder that says _Describe an image to create…_, and a preview pane on assistant replies.

## Image generation modes

Every image model is wired to one of two invocation modes. The mode is set per model in **Settings > Providers** and determines which OpenAI-compatible endpoint Tale calls.

| Mode              | Endpoint                 | Used by                        | Edit pathway                                          |
| ----------------- | ------------------------ | ------------------------------ | ----------------------------------------------------- |
| `images-api`      | `/v1/images/generations` | FLUX, Imagen, OpenAI DALL-E    | `/v1/images/edits` with reference image               |
| `chat-multimodal` | `/v1/chat/completions`   | Nano Banana, GPT-Image, Gemini | Reference image as a content part in the user message |

Pick the mode that matches your provider's documentation. `images-api` is simpler — input is a string, output is an image — and works for any provider that exposes the OpenAI Images endpoint shape. `chat-multimodal` is required for models like Gemini that emit images directly from the chat-completion endpoint and accept reference images as inline message parts.

## Configure the model in your provider

Open **Settings > Providers**, edit the provider, and add a model with the `image-generation` tag (or `image-edit` if it can revise an existing image). For each image model, set:

- **Image generation mode** — one of `images-api` or `chat-multimodal`. Tale shows a help line under the field describing what each mode means; pick whichever your provider documents.
- **Default models** — set the provider's preferred image model in the **Default models** section so users land on the right model when they pick the agent.

Image models are billed per generated image rather than per token, so the usage ledger records image count and any provider-side cost separately from chat tokens.

## Create an image-generation agent

Start from **Agents > New Agent** and fill in the basics — name, slug, description. On the **Instructions** tab:

- **Model preset** — pick the image model you registered above. Only models tagged `image-generation` or `image-edit` appear in the picker.
- **System instructions** — describe what the agent should be good at. _"You produce minimalist marketing thumbnails: flat colour, single subject, no text overlay"_ steers far more reliably than no instructions.

Knowledge, tools, conversation starters, delegation, and webhook tabs work the same as for chat agents — see [Create an agent](/platform/agents/create).

## Use it in chat

Pick the image-generation agent from the agent selector. The composer behaviour adapts:

- **Create mode** — the placeholder reads _Describe an image to create…_. Type a prompt and send.
- **Edit mode** — click an image earlier in the thread, or attach a reference image with the thumbnail picker, and the placeholder switches to _Describe the edit…_. The reference image is sent to the edit endpoint (or as a content part for `chat-multimodal` models).
- **Model can't edit** — if the picked model is `image-generation` only, the composer shows _This model creates new images only. Switch to an editing model to apply changes._ Pick a model with the `image-edit` tag instead.

Generated images are saved as message attachments, stored under the same retention policy as other attachments, and can be downloaded, opened in Canvas, or referenced again as edit input for follow-up turns.

## Where this fits

Image-generation agents are the one-turn image surface inside chat — a quick way to produce a marketing thumbnail, a product mock-up, a concept sketch. They're not a replacement for a dedicated image-editing tool; the trade-off is speed and conversational reachability, not pixel-level control. For team-wide imagery workflows that need iteration tracking, an agent that hands off to an external image service via an [integration](/platform/integrations/overview) is a better fit.

To configure the underlying models, an Admin sets up image-generation and image-edit model tags under [AI providers](/platform/admin/providers).
