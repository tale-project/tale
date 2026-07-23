---
title: Connect a local LLM provider
description: Declare a local Ollama, LM Studio, or vLLM server as a custom provider connector on a self-hosted Tale instance, store its credential, and verify that a chat reaches it without leaving your network.
---

A local provider is the path to running models inside your own perimeter — no outbound API calls, no per-token bill, no third-party transcript. This walk takes a self-hosted Tale instance from "I have an Ollama, LM Studio, or vLLM endpoint" to "a chat in the org calls a local model and the reply streams back." The walk is for an Admin on a self-hosted install; Cloud orgs do not reach onto your network and skip this page.

You need the Admin role in Tale, a local inference server reachable from the `tale-platform` container over TLS, and a model already pulled or loaded on that server. The connector format and the credential model are documented in [Providers](/self-hosted/configuration/providers); this page walks one end-to-end path and verifies the result.

## Before you begin

Confirm four things. Your role is Admin or Owner — **Settings > AI providers** is hidden below that. Your local inference server answers `GET /v1/models` (or the Ollama equivalent `GET /api/tags`) from inside the Tale Docker network. At least one model is loaded — Ollama users have run `ollama pull llama3.1:8b` or similar, LM Studio users have a model loaded in the server tab, vLLM users have started the server with `--model` pointed at a checkpoint. And the server is reachable over `https://`: a connector's base URL must be an HTTPS URL, so terminate TLS in front of the inference server — a reverse proxy with an internal certificate is the usual answer — rather than exposing it in the clear.

## Step 1 — Make the inference server reachable from Tale

The first move is confirming that `tale-platform` can reach the inference server by hostname over TLS. Without that, every model call surfaces a connection error and no model is callable.

When the inference server runs behind a proxy in the same Docker network, the reachable hostname is that proxy's service name. Run a one-shot curl from the `tale-platform` container to verify before you write any configuration:

```bash
docker compose exec platform curl -sf https://ollama.internal/api/tags
```

A JSON list of pulled models is the success signal. A connection error means the hostname is wrong, the certificate is not trusted, or the inference server is not listening on the interface the container can reach.

## Step 2 — Declare the connector

Shipped connectors cover the public vendors; a machine on your own network is an org-defined connector — one YAML file in the organisation's config tree. The file tells Tale where to send requests, which wire dialect the endpoint speaks, and where its model list comes from.

Write `$TALE_CONFIG_DIR/<orgSlug>/providers/local-ollama.yml`. The `name` must match the filename stem, and it must not collide with a shipped connector's name:

```yaml
name: local-ollama
displayName: Local Ollama
apiFormat: openai
baseUrl: https://ollama.internal/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
```

`apiFormat: openai` is right for Ollama, LM Studio, and vLLM — all three expose the OpenAI Chat Completions shape. `catalog.source: models-endpoint` tells Tale to list models from `GET {baseUrl}/models` instead of shipping a static list, which is what you want when the loaded models change. A file that fails to validate is skipped and the reason is logged, so read the platform log if the connector does not appear.

## Step 3 — Store the credential

A connector on its own calls nothing. What authorises a request is a credential stored against that connector, and a connector holds as many as you need.

Open **Settings > AI providers**. The new connector sits beside the shipped ones; click **Add credential** on it. Pick **API key** and paste whatever token your server expects — LM Studio ignores the value, vLLM wants the token you passed to `--api-key`. Name the credential for the machine it reaches (`GPU box, rack 2`), and leave the **Model allowlist** empty to expose everything the server lists, or pick the subset the org may call. The first credential on a connector becomes its default.

Prefer the key to live on the deployment instead? Pick **Environment variable** and name a deployment variable under the reserved `TALE_PROVIDER_KEY_` prefix. The secret then never enters Tale's own store, and your operations team owns rotation.

## Step 4 — Verify with a chat

The proof the wiring works is one chat reply streaming from the local server. Without this step you only know the configuration parses.

Open a new chat, open the model picker, and pick one of the local models by name — a model is always chosen explicitly, so there is no routing layer to rule out. Send a short prompt (`Reply with the single word "ready"`). The reply streams in within a few seconds.

Tail the inference server log on the host while you send the prompt — Ollama logs the request line, LM Studio prints a request summary, vLLM prints the generation latency. Seeing the request hit the local server is the verification that traffic is staying inside your network, not bouncing through an external API.

## Troubleshooting

- **Symptom:** the connector never appears under **Settings > AI providers**. **Cause:** the YAML failed to validate, or its `name` does not match the filename stem. **Fix:** read the platform log — a rejected connector is logged with the file and the reason — and correct the file.
- **Symptom:** the connector appears but its model list is empty. **Cause:** the inference server is reachable but has no models loaded, or its `/models` endpoint answered an error. **Fix:** load a model, then click **Refresh catalogs** on the providers page. Catalogs update only when you refresh them.
- **Symptom:** the file is rejected because the base URL is not HTTPS, or points at `localhost`, `127.0.0.1`, or a private IP. **Cause:** connector base URLs are HTTPS-only, and the host policy blocks loopback and private addresses. **Fix:** put a TLS-terminating reverse proxy in front of the inference server and use its in-network hostname.
- **Symptom:** the chat reply is an error naming the model. **Cause:** the model id does not match the upstream one. **Fix:** re-pick from the model picker — Ollama tags like `:latest` matter to the upstream and must match exactly.

## Where this fits

A local provider is the seam between Tale and your own GPUs — the same connector-and-credential shape as a public vendor, but no traffic leaves your network. The natural next reads are [Providers](/self-hosted/configuration/providers) for the connector format in full and the environment-variable credential path, and [Hardening](/self-hosted/operate/security/hardening) for the egress guarantees that keep an agent from reaching a cloud model you did not intend.
