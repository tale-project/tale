---
title: Image generation
description: Image generation is not part of this version — there is no generate_image tool, and no agent produces pictures inline.
---

This page used to describe `generate_image`, a tool any agent could be granted to produce a picture inline in its reply. Neither the tool nor a per-agent grant exists in this version of Tale: the chat assistant's tools are fixed and text-only, and no image model is wired to a reply. The page stays so the absence is documented rather than discovered.

<Note>

Image generation is not available in this version. Asking the assistant to draw or design something returns text, not a picture.

</Note>

## What you can do with images today

Images travel as files. Attach them to a task — the task sheet accepts images and documents by drop or paste — and a project agent working that task finds them among its input files. Documents you upload under [Knowledge](/platform/knowledge/overview) are indexed for retrieval, and the deliverables a project agent produces land on the task for review; [Task automation](/platform/projects/task-automation) covers that loop.

Which models your organization can use at all is a [Providers](/platform/admin/providers) decision, taken under **Settings > AI providers**; an image-capable model listed there does not add a drawing tool to chat.

## Where this fits

Generating pictures is not a capability this version offers, so no agent, policy, or budget has to account for it. When your workflow needs a picture, treat it like any other file: attach it to the task and review it there.
