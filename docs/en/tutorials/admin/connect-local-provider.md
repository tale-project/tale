---
title: Connect a local LLM provider
description: Wire a local Ollama, LM Studio, or vLLM server into a self-hosted Tale instance, allowlist its models, and verify that agents reach it without leaving the host network.
---

A local provider is the path to running models inside your own perimeter — no outbound API calls, no per-token bill, no third-party transcript. This walk takes a self-hosted Tale instance from "I have an Ollama, LM Studio, or vLLM endpoint" to "an agent in the org calls a local model and the reply streams back." The walk is for an Admin on a self-hosted install; Cloud orgs do not reach onto your network and skip this page.

You need the Admin role in Tale, a local inference server reachable from the `tale-platform` container, and a model already pulled or loaded on that server. The underlying provider mechanic is documented in [Providers](/self-hosted/configuration/providers); this page walks the UI path and verifies the result end to end.

## Before you begin

Confirm four things. Your role is Admin or Owner — the **Providers** panel is hidden below that. Your local inference server is running and answers `GET /v1/models` (or the Ollama equivalent `GET /api/tags`) from inside the Tale Docker network. At least one model is loaded — Ollama users have run `ollama pull llama3.1:8b` or similar, LM Studio users have a model loaded in the server tab, vLLM users have started the server with `--model` pointed at a checkpoint. And the network path from `tale-platform` to the inference host is open on the inference port (typically `11434` for Ollama, `1234` for LM Studio, `8000` for vLLM).

## Step 1 — Make the inference server reachable from Tale

The first move is confirming that `tale-platform` can reach the inference server by hostname. Without that, every model call surfaces a connection error and the picker shows the provider as **error**.

When the inference server runs on the same Docker host, the reachable hostname depends on where the server itself runs. An Ollama container in the same compose network is `http://ollama:11434`. An LM Studio or vLLM server running on the host (outside compose) is `http://host.docker.internal:1234` on macOS and Windows, or the host's bridge IP on Linux. Run a one-shot curl from the `tale-platform` container to verify before opening the UI:

```bash
docker compose exec platform curl -sf http://ollama:11434/api/tags
```

A JSON list of pulled models is the success signal. A connection-refused error means the hostname is wrong or the inference server is not listening on the interface the container can reach.

## Step 2 — Register the provider in Tale

A reachable server does nothing until Tale knows the URL and the protocol shape it speaks. The provider entry tells Tale where to send requests and which OpenAI-compatible dialect to use.

Open **Settings > Providers** and click **Add provider**. Pick the provider type that matches your server: **Ollama** for an Ollama server, or **OpenAI-compatible** for LM Studio and vLLM (both expose the OpenAI `/v1` shape). Fill the **Base URL** with the value you verified in Step 1; leave the API key field empty for Ollama, set it to any string for LM Studio (the server ignores it), set it to your configured token for vLLM if you started the server with `--api-key`.

Click **Save**. Tale immediately calls the provider's model-list endpoint; the row turns green and the model picker fills with whatever the server reported.

## Step 3 — Allowlist the models you want callable

A registered provider with no allowlisted models is invisible to every agent. The allowlist is the contract between the org and the provider — picking the model is the gate.

In the provider row, expand the model picker. Each model from the upstream list shows a checkbox plus the tag Tale inferred (`chat`, `embedding`, `vision`). Tick the models you want agents to call; a chat-tagged model is what an agent binds to by default. Click **Save allowlist**.

If you want the local model to be the org-wide default for new chats, scroll to the top of the provider list and pick it under **Default model**. Existing agents keep their previous binding; new ones land on the local model on the next request.

## Step 4 — Verify with an agent chat

The proof the wiring works is one chat reply streaming from the local server. Without this step you do not know whether the model picker just _looks_ right.

Open or create an agent, set its model to one of the local models you allowlisted, and start a chat with a short prompt (`Reply with the single word "ready"`). The reply streams in tokens within a few seconds; the chat's tool-call card shows the model name and the provider you registered.

Tail the inference server log on the host while you send the prompt — Ollama logs the request line, LM Studio prints a request summary, vLLM prints the generation latency. Seeing the request hit the local server is the verification that traffic is staying inside your network, not bouncing through an external API.

## Troubleshooting

- **Symptom:** provider row shows **error** with `connection refused`. **Cause:** the base URL is unreachable from the `tale-platform` container. **Fix:** repeat the `docker compose exec platform curl` from Step 1; adjust the hostname (often `host.docker.internal` on macOS/Windows, the bridge IP on Linux).
- **Symptom:** the model picker is empty after **Save**. **Cause:** the inference server is reachable but has no models loaded. **Fix:** run `ollama pull <model>` or load a model in LM Studio / vLLM, then click **Refresh models** on the provider row.
- **Symptom:** the chat reply is one error toast (`model not found`). **Cause:** the model name the agent is bound to does not match the upstream id. **Fix:** open the agent's model dropdown and re-pick from the live list — Ollama tags like `:latest` matter to the upstream and must match exactly.

## Where this fits

A local provider is the seam between Tale and your own GPUs — same allowlist mechanics as a cloud provider, but no traffic leaves the host. The natural next reads are [Providers](/self-hosted/configuration/providers) for the file-form equivalent of what you just did in the UI, and [Hardening](/self-hosted/operate/security/hardening) for the egress-allowlist guarantees that keep an agent from accidentally falling back to a cloud model when the local one is unreachable.
