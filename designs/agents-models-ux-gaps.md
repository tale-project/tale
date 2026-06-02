# Agents & Models — UX Gaps

A working list of friction points in how Tale surfaces agents, their capabilities, and the models that back them. Ordered by impact, not by effort.

## Top three (start here)

### 1. "Auto" model selection is opaque

Chat agents default to **Auto** mode and silently pick a model. The user never sees which one ran. When a response is bad, they can't tell whether it's the model, the agent, or the prompt.

**Fix idea:** show the actual model name on each AI message — a small "via deepseek-v4-flash" chip below the bubble, optionally clickable to reveal "Auto picked this because cost / latency / context length."

### 2. Capabilities aren't scannable or persistent

The agent picker shows real descriptions today — "Image Creator generates and edits images from text prompts using FLUX, Imagen, or Nano Banana," "Researcher: live planning, web search via Tavily, cited sources," etc. That covers more than I initially gave it credit for.

What's still missing:

- **Only visible at picker time.** Once you've selected an agent and are in the conversation, you can't see its tools anymore. Forget whether Researcher has web access? You have to re-open the picker to check.
- **Prose, not structured flags.** Descriptions read well but aren't scannable. Comparing two agents means reading two paragraphs. A visual capability strip (`📡 Web · 📄 Docs · 🖼 Vision`) lets users diff agents at a glance.
- **Inconsistent depth.** Descriptions are admin-authored, so quality varies. "Automation Assistant — creates and manages automation workflows" is vague compared to Image Creator's specific model list. Structured capability flags would be uniform regardless of who wrote the agent.

**Fix idea:** keep the existing descriptions in the picker, but also surface a structured capability strip on the agent row (in the picker) and a small persistent indicator on the active-agent chip during chat (clickable to reveal full details).

### 3. No cross-agent suggestion when you hit a wall

Ask Assistant for an image, it politely declines. There's no _"looks like you want an image — try the Image Creator agent"_ link. High-impact discoverability moment, zero built today.

**Fix idea:** when an agent refuses a task that another agent can do, surface a one-line suggestion + "Switch agent" button under the refusal.

---

## Why models don't show up (the original question)

When the user switches agents and the model dropdown changes silently, three things are happening invisibly:

1. The new agent has a different `supportedModels` allowlist
2. Models must match the agent's capability tag (`chat` vs `image-generation`)
3. Governance policies (`model_access`) filter further

When the result is zero models, the UI just shows **"No models available"** with a red triangle. That single string covers four very different situations:

- No providers configured at all
- Providers exist but none offer the required capability (e.g. no image-gen provider for Image Creator)
- All models blocked by governance
- Tag mismatch (dev-only)

**Fix idea — reason-aware empty state.** Branch on the actual cause:

- _No providers:_ "No models available — connect a provider in Settings → Providers."
- _Capability mismatch:_ "Image Creator needs image-generation models. None of your configured providers offer them — try adding Vercel Gateway or OpenRouter."
- _Blocked by governance:_ "None of this agent's models are approved by your organization. Ask an admin to update the model access policy."

Each one points to a different next action; the current single string forces guessing.

**Related:** when switching agents drops the user's previous selection, say so. Currently it changes without notice. A toast like _"Switched to FLUX 2 Pro — Image Creator doesn't use Claude Opus"_ would convert silent loss into noticed swap.

---

## The rest of the gap list

### 4. Quantization variants are jargon

The picker shows "GLM 5.1 (fp8)" vs "GLM 5.1 (fp4)". Most users don't know what this means. Either explain (hover tooltip: _"fp8 = higher quality, slower; fp4 = faster, cheaper"_) or hide variants behind a developer toggle.

### 5. No model count at agent-picker time

You pick an agent and _then_ discover whether it has 17 models, 4 models, or zero. Showing "Researcher · 17 models" / "Image Creator · 0 (admin blocked)" on the agent row sets expectations before the click.

### 6. No agent discovery surface

Outside the settings page, agents aren't browseable. New users don't learn what exists. A first-run agent picker with descriptions and example use cases would help.

### 7. No model history per message

After a long chat you can't see which model produced which response. Critical for trust, retrospection, and debugging "why was that answer worse." Subtle "via {model}" footer per AI message solves it.

### 8. No graceful model degradation

If FLUX 2 Pro is rate-limited or down, the user probably sees a generic "something went wrong." There's no built-in fallback ("FLUX 2 Pro hit rate limit — try FLUX Kontext Pro?") or auto-switch notice.

### 9. Agent switching mid-conversation is ambiguous

Unclear whether context carries over and whether the change is signaled visibly. A divider in the message stream ("Switched to Image Creator") would make it traceable.

### 10. No agent personality preview

Agents that differ in tone (Sales vs Researcher vs Assistant) look identical at the picker. One-line excerpts or example outputs would set expectations.

### 11. Costs are invisible

Some models cost meaningfully more per call. No preview before send, no running total, no "you've used $X this month." For paying teams, this is a glaring miss.

### 12. End users can't tweak agents

Only admins can create/edit. Power users with a niche need (different instructions, fewer tools) have no path. A "duplicate this agent and modify" affordance would unlock a lot.

---

## Framing for the design exploration

The unifying principle behind most of these:

> **Agents define a curated model space. The model picker is the result, not a generic chooser.**

Once that framing lands — through reason-aware empty states (#3-style), capability strips (#2), and visible model attribution (#1) — most of the "why is my model gone" / "what does this agent do" confusion evaporates.

The exploration in `untitled.pen` should focus on three small frames showing this principle in practice:

1. Reason-aware empty state (the "no models available" rewrite)
2. AI message bubble with the "via {model}" attribution chip (#1)
3. Agent row with capability strip and model count (#2 + #5)

Three frames, same design language, demonstrating the explicit-relationship pattern.
