---
title: Configure video transcript ingestion
description: Diagnose transcript retrieval, configure the token provider or proxy, and manage organization-scoped browser sessions.
---

Tale uses `yt-dlp` to retrieve content for video-link ingestion. Availability depends on the video, supported captions or extraction path, and the source platform's access checks. A video that plays on your laptop may still reject the server's network or session.

This operator guide covers transcript retrieval configuration. Start with a public video you can access and inspect its ingestion error before adding credentials or changing egress.

## Identify the failing stage

| Observation | Check first |
| --- | --- |
| One video fails | Whether the URL is supported, the content is still available, and a usable transcript or audio path exists. |
| Many videos fail from one host | Worker extractor errors, source-platform responses, and that host's network path. |
| Videos meet a bot check through your proxies | The worker's `[ytdlp] outbound proxy entry` lines, and whether each listed proxy keeps one address ([egress proxy](#egress-proxy)). |
| Retrieval works but knowledge search does not | The organization's embedding configuration and indexing status. |
| Failures begin after a session worked | Session expiry, source-account state, and cooling or retirement in the pool. |

Read `tale logs backend-worker --tail 200` and the item's failure reason. Keep the URL and error category, but remove account cookies, signed URLs, and credentials before sharing diagnostics. Retries may help a transient failure; repeated identical refusals need investigation.

## Check the built-in token provider

The platform image includes the token plugin, and the packaged deployment starts `bgutil-provider` on the internal network. The default endpoint is `http://bgutil-provider:4416`. It supplies proof-of-origin tokens used by supported extractor requests; it does not grant access to private content or guarantee that a source accepts the request.

Check `tale logs bgutil-provider` and whether the worker can reach the service. The sidecar is best-effort: its failure does not prevent the core deployment from starting, though transcript retrieval may degrade.

`VIDEO_INGEST_POT_PROVIDER_URL` selects another provider endpoint. `VIDEO_INGEST_PO_TOKEN` supplies a manually obtained token. Keep token material in your secret configuration. The [environment reference](/self-hosted/configuration/environment-reference) also lists extractor-client and plugin options; change them only when the observed error calls for it.

## Configure an egress proxy {#egress-proxy}

Video retrieval goes through the deployment's [outbound proxies](/self-hosted/configuration/environment-reference#outbound-proxies) when `OUTBOUND_PROXY_URLS` lists any. A video keeps one proxy for its metadata, captions, and audio. It starts on the proxy through which its platform last served a video, or else on the next one in turn, because a proxy the platform has just served is the likeliest to serve it again.

When the platform turns the video away through that proxy, with a bot check, a rate limit, or a refused request, or when the proxy cannot carry the request, the worker moves the video to the next proxy in turn that has not failed it. Each step of the video (metadata, captions, audio) makes at most five attempts and starts none after 90 seconds. The worker log names each move by the proxy's position in the list, never by its credentials:

```text
[ytdlp] outbound proxy entry 3 (http://gateway.example:80) failed (botDetection); the video goes on through entry 7 (http://gateway.example:80)
```

When the attempts run out, the step ends as it would without proxies, with the platform's reason. With a single listed proxy, the worker does not repeat a refused attempt.

Each listed proxy must keep one public address. YouTube signs its media for the address that requested it and can refuse the download from another, so a rotating endpoint, which gives every connection a new address, cannot be relied on for video. List the provider's fixed-address endpoints instead. Many providers serve them from one gateway, numbered in the user name:

```bash
OUTBOUND_PROXY_URLS=http://user-1:password@gateway.example:80,http://user-2:password@gateway.example:80,http://user-3:password@gateway.example:80
```

Requests to websites still take these proxies in turn. Platforms refuse many data-center addresses; if the log shows moves for most videos, proxies on residential or ISP networks are refused less often.

Set `VIDEO_INGEST_PROXY_URL` when video retrieval needs an approved proxy of its own instead. It replaces the outbound proxies for video only, so the outbound list can then keep a rotating endpoint. As a single proxy, it does not repeat a refused attempt. Supported schemes include `http`, `https`, `socks4`, `socks4a`, `socks5`, and `socks5h`; the latter resolves DNS at the proxy.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Add credentials through your secret-management workflow if the proxy requires them. An invalid or unsupported proxy URL is ignored with a warning, and retrieval goes through the outbound proxies, if any, as if it were unset. Confirm the applied configuration and a real retrieval result. Recreate the worker after changing its container environment; restarting the existing container does not import a changed `.env`.

A different route is not a promise of access. Confirm that your proxy and the source account are authorized for the content you need. If the source remains unavailable, import a transcript you already have as a [Knowledge document](/platform/knowledge/documents).

## Import an authorized browser session

The server can draw cookies from a session pool keyed by **organization and domain**. It encrypts cookie jars using `ENCRYPTION_SECRET_HEX` and does not return those cookies in list responses. Pool access is part of server-side video ingestion, not a cookie export to agent scripts.

There is no in-app import form. The REST write requires a key whose user is an organization administrator and is on `TALE_DEPLOYMENT_CONFIG_ADMINS`; the key must also resolve the target organization. `GET /api/v1/me` reports `capabilities.deploymentEditor` for the key. Name the organization explicitly with `X-Organization-Slug`, especially when the user belongs to several organizations.

1. Export a Netscape-format cookie jar from an authorized browser session for the source domain. Treat the file as account credentials and keep it outside source control.
2. Set `TALE_URL`, `TALE_API_KEY`, and `TALE_ORG_SLUG` for the intended instance and organization. Keep `cookies.txt` readable only by the operator's account.
3. Import the jar without placing its content in command arguments:

```bash
jq -n --arg domain youtube.com --rawfile cookiesJar cookies.txt \
  '{domain: $domain, cookiesJar: $cookiesJar, label: "operator-managed session"}' |
  curl --fail-with-body -sS -X POST "$TALE_URL/api/v1/browser-sessions/import" \
    -H "Authorization: Bearer $TALE_API_KEY" \
    -H "X-Organization-Slug: $TALE_ORG_SLUG" \
    -H 'Content-Type: application/json' \
    --data-binary @-
```

A successful import returns HTTP 201 with a `sessionId`. Invalid data returns a validation refusal; a permission failure returns 403. Resolve the named gate rather than granting a broader role just to make the request pass.

## Check and retire sessions

```bash
curl --fail-with-body -sS "$TALE_URL/api/v1/browser-sessions" \
  -H "Authorization: Bearer $TALE_API_KEY" \
  -H "X-Organization-Slug: $TALE_ORG_SLUG"
```

The list shows metadata such as status, expiry, and failure count. The default lifetime is 14 days; an import can set positive `ttlMs` up to 180 days. Source cookies can expire earlier, so an unexpired pool record does not prove the account session still works.

Blocked retrieval cools a session; repeated blocks can retire it, and a scheduled sweep handles cooled or expired records. A later retry can use another healthy session for the same organization and domain. If no session is available, retrieval can continue without one using the other configured options.

To revoke an imported session, use `DELETE /api/v1/browser-sessions/<sessionId>` with the same organization scope and write permissions. Confirm the ID from the list first. Rotate or revoke the source account's session as well if its cookie jar was exposed. Finally, retry a controlled video and verify the transcript and indexing result; importing cookies alone does not prove ingestion succeeded.
