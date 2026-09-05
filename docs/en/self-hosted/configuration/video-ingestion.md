---
title: Video ingestion
description: Configure how a self-hosted deployment fetches video transcripts past YouTube's bot wall — the built-in PO-token provider, an egress proxy, and the pre-warmed browser-session pool.
---

When Tale ingests a video link, it fetches the video's transcript with `yt-dlp`. Video platforms — YouTube most aggressively — challenge requests from datacenter and server IPs with a "confirm you're not a bot" wall, so a fresh self-hosted deployment on a cloud VM can see ingestion fail where a laptop on a home connection would succeed. This page covers the three layers Tale ships to get past that, from the one that needs no configuration to the one that needs the most.

<Info>

Managed **Cloud** deployments run these measures for you — this page is for operators running Tale on their own infrastructure.

</Info>

## Layer 1 — the PO-token provider (default, no config)

The single most effective measure is a **proof-of-origin (PO) token**: a signed value that makes a request look like it came from a real browser session. Tale ships a token provider wired up out of the box — the `yt-dlp` plugin is baked into the image and a `bgutil-provider` sidecar serves the tokens over the internal network. No environment variable is required; a fresh `docker compose up` or `tale deploy` has it running.

You can point `yt-dlp` at a provider on a different host with `VIDEO_INGEST_POT_PROVIDER_URL`, or supply a manually-minted token with `VIDEO_INGEST_PO_TOKEN` — both are documented in the [environment reference](/self-hosted/configuration/environment-reference). The sidecar being down never breaks the stack: ingestion simply falls back to no token, exactly as if the layer were absent.

## Layer 2 — an egress proxy

When the token alone is not enough — some IP ranges are flagged regardless — route the fetch through an **egress proxy** on an IP the platform trusts. Residential and ISP-hosted proxies work best; datacenter and commercial proxies are often flagged just like the server itself.

Set `VIDEO_INGEST_PROXY_URL` to the proxy URL. A `socks5h://` scheme resolves DNS at the proxy (the safest choice); `http`, `https`, `socks4`, `socks4a`, `socks5`, and `socks5h` are all accepted. The value can carry credentials — Tale scrubs them from every log line.

```bash .env
VIDEO_INGEST_PROXY_URL=socks5h://user:pass@residential.example:1080
```

The proxy applies to every phase of a fetch — metadata, captions, and audio — so the whole ingest shares one trusted egress path.

## Layer 3 — the pre-warmed browser-session pool

The strongest measure is to present cookies from a **real browser session that has already cleared the bot check**. Tale keeps a pool of these sessions, keyed by domain, and hands one to each fetch so the platform sees a returning visitor rather than a first-touch server.

Sessions are stored encrypted at rest (the cookie jar is sealed with the deployment's `ENCRYPTION_SECRET_HEX`) and are never exposed to agent-executed code — they live only in the server-side fetch layer. A session that starts getting blocked is cooled and then retired automatically, and expired sessions are swept on a schedule.

Populating the pool is an advanced, hands-on step, and it happens over the [REST API](/develop/api-reference) — the product has no form for it. Capture a Netscape cookie jar from a browser that has solved the challenge for the target platform, then import it for that platform's domain:

```bash
curl -sS -X POST "https://your-host.example.com/api/v1/browser-sessions/import" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: <org-slug>" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
        '{ domain: $domain, cookiesJar: $cookiesJar, label: "warmed 2026-09-05" }')"
# → 201 { "sessionId": "..." }
```

The import is the deployment's most sensitive write, so it is gated twice: the key must belong to an organization administrator, and that administrator's e-mail must be on the `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist — the same list that guards [data residency](/self-hosted/configuration/data-residency). Anyone else gets **403** with a `code` naming the gate that refused. A key whose user belongs to several organizations must name the one to import into with `X-Organization-Slug` — a write without it answers **400**; a key with a single membership can drop the header. `GET /api/v1/browser-sessions` lists the pool with each session's status, expiry, and strike count — never the cookies themselves. A session lives 14 days unless `ttlMs` says otherwise, and only the video-link ingest draws from the pool.

<Warning>

Account cookies unlock gated content but put the account at risk if the platform flags automated use. Prefer cookies from a throwaway or purpose-made account, and never commit a cookie jar to source control.

</Warning>

## Which layer do I need?

<CardGroup cols="2">

<Card title="Just deployed, some videos fail" icon="circle-play">

Layer 1 is already on. Retry — many blocks are transient. Move to Layer 2 only if failures persist.

</Card>

<Card title="Most videos fail on this host" icon="globe">

The deployment's IP is likely flagged. Add an egress proxy (Layer 2) on a residential IP.

</Card>

<Card title="A specific platform still blocks you" icon="key-round">

Warm a browser session for that platform (Layer 3) so the fetch presents cleared cookies.

</Card>

<Card title="Full variable reference" icon="settings">

Every `VIDEO_INGEST_*` knob, with defaults, lives in the [environment reference](/self-hosted/configuration/environment-reference).

</Card>

</CardGroup>

## An honest expectation

None of these layers can guarantee ingestion against a platform actively working to block automated access from arbitrary IPs. Together they make ingestion succeed wherever your egress is trusted, and every deployment has a supported path to escalate. If a platform hard-blocks your server, the transcript can still be brought in by hand — paste it into a [Knowledge](/platform/knowledge/documents) document.
