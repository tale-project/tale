---
title: Configure video transcript ingestion
description: Diagnose transcript retrieval, configure the token provider or proxy, and manage organization-scoped browser sessions.
---

Tale uses `yt-dlp` to retrieve content for video-link ingestion. Availability depends on the video, supported captions or extraction path, and the source platform's access checks. A video that plays on your laptop may still reject the server's network or session.

This operator guide covers transcript retrieval configuration. Tale runs each retrieval in a sandbox session of its own, apart from the backend; [Where retrieval runs](#where-retrieval-runs) says what that asks of a deployment. Start with a public video you can access and inspect its ingestion error before adding credentials or changing egress.

## Identify the failing stage

| Observation | Check first |
| --- | --- |
| One video fails | Whether the URL is supported, the content is still available, and a usable transcript or audio path exists. |
| Many videos fail from one host | Worker extractor errors, source-platform responses, and that host's network path. |
| A YouTube link says the server was asked to prove it isn't a bot | The token provider, which is off until you [turn it on](#token-provider). |
| Videos meet a bot check through your proxies | The worker's `[ytdlp] outbound proxy entry` lines, and whether each listed proxy keeps one address ([egress proxy](#egress-proxy)). |
| A link stays **Queued** for minutes, then fails as a temporary issue | The organization's **Render sessions** limit and the sandbox host's capacity ([where retrieval runs](#where-retrieval-runs)). |
| Every link says video processing is not enabled yet | The sandbox runtime image: one from before this release carries no `yt-dlp`. |
| A link says the video is too large to process | The [limits on length and size](#limits). |
| Retrieval works but knowledge search does not | The organization's embedding configuration and indexing status. |
| Failures begin after a session worked | Session expiry, source-account state, and cooling or retirement in the pool. |

Read `tale logs backend-worker --tail 200` and the item's failure reason. Keep the URL and error category, but remove account cookies, signed URLs, and credentials before sharing diagnostics. Retries may help a transient failure; repeated identical refusals need investigation.

## Where retrieval runs {#where-retrieval-runs}

For each video link, the worker starts a sandbox session, runs `yt-dlp` in it, and removes the session when the link is ready or has failed. `yt-dlp` fetches pages from whatever address a member pastes and runs the platform's own JavaScript to reach its streams. In a session it does so as an unprivileged user on a read-only root filesystem, and the sandbox host admits its memory instead of the backend carrying it.

A deployment has to provide three things for that:

- **A running sandbox.** Packaged deployments always start one. Its session image carries `yt-dlp`, the JavaScript runtime `yt-dlp` needs, and the token provider's plugin. A link that fails with "Video processing is not enabled yet — contact your administrator" ran in a session image from before this release: run the sandbox runtime image of the same release as the backend.
- **A free render session.** Each link in progress holds one of the organization's **Render sessions**, the limit under **Settings > Sandboxes** that website crawling draws on too. When none is free, or the sandbox host has no room for another session, the link stays **Queued** and asks again every 5 to 60 seconds. Waiting does not count as one of the link's attempts. A link that has waited 15 minutes fails with "Temporary issue — try again". [Manage sandbox capacity](/platform/admin/sandboxes) describes the limit and the host's capacity.
- **A way out for the session.** Without a [proxy for video](#egress-proxy), requests leave through the sandbox's egress proxy, which opens tunnels to ports 443 and 80 only. If `SANDBOX_EGRESS_ALLOWLIST` restricts sandbox destinations, add the video platforms your members use and the hosts those platforms serve media from; otherwise every link fails at its first request. [Limit sandbox destinations](/self-hosted/operate/security/hardening#limit-sandbox-destinations) explains the setting.

## Limits on length and size {#limits}

Tale reads captions that a platform serves as WebVTT or SubRip. When a video has none in either format, the worker downloads its audio for the transcription model. It stores the audio as the platform serves it, typically as a WebM, M4A or MP4 file, and prefers a stream of up to 200 MiB: the best audio-only stream that fits, or the smallest one where none does. From a platform that serves audio only together with a picture, it takes a small picture: at most 480 pixels high, or 480 pixels wide for a portrait video.

| Limit | Value | Beyond it |
| --- | --- | --- |
| Video length | 4 hours | The link fails with "Video exceeds the 4h length limit" once its metadata is read, before anything is downloaded. |
| Audio as the platform serves it | 1 GiB | The link fails with "Video is too large to process" and is not retried. Attach the recording itself, or its transcript, instead. |
| One caption track | 5 MiB | The track is passed over and the audio is transcribed. |

## Turn on the token provider {#token-provider}

YouTube asks some addresses, data-center addresses above all, to prove that a request does not come from a bot. A link then fails, and the member reads that YouTube asked this server to prove it isn't a bot and that an administrator can turn on the token provider.

The provider is `bgutil-provider`, a service on the internal network that supplies the proof-of-origin tokens such a request needs. The sandbox runtime image includes its plugin. A packaged deployment does not start it unless asked: it is one more container, about 60 MiB at rest, and only a deployment that YouTube challenges has a use for it. To turn it on, add this line to the workspace's `.env` and run `tale deploy`:

```dotenv
VIDEO_INGEST_POT_PROVIDER=true
```

The deploy starts the provider. From then on a video's session asks it through the backend, which reaches it at `http://bgutil-provider:4416`. Remove the line, or set it to `false`, and the next deploy removes the provider again. A token does not grant access to private content or guarantee that a source accepts the request.

Check `tale logs bgutil-provider` and whether the backend can reach the service. The provider is best-effort: its failure does not prevent the core deployment from starting, though transcript retrieval may degrade.

`VIDEO_INGEST_POT_PROVIDER_URL` names a provider of your own instead, and needs no other setting; the backend must be able to reach it, a session need not. `VIDEO_INGEST_PO_TOKEN` supplies a manually obtained token. Keep token material in your secret configuration. The [environment reference](/self-hosted/configuration/environment-reference) also lists extractor-client and plugin options; change them only when the observed error calls for it.

## Configure an egress proxy {#egress-proxy}

Video retrieval goes through the deployment's [outbound proxies](/self-hosted/configuration/environment-reference#outbound-proxies) when `OUTBOUND_PROXY_URLS` lists any. A video keeps one proxy for its metadata, captions, and audio. It starts on the proxy through which its platform last served a video, or else on the next one in turn, because a proxy the platform has just served is the likeliest to serve it again.

A video's session never connects to a proxy itself. It sends its requests to the backend, which opens the connection to the proxy the video is on and passes the traffic both ways. A proxy must therefore be reachable from the backend, and its credentials never enter a session. Where the API and the worker run as separate services, give both the same proxy settings: the worker chooses a video's proxy, and the API process only connects to a proxy that its own settings list.

When the platform turns the video away through that proxy, with a bot check, a rate limit, or a refused request, or when the proxy cannot carry the request, the worker moves the video to the next proxy in turn that has not failed it. Fetching the metadata, the captions, or the audio makes at most five attempts, and retries only within the first 90 seconds of that step. When fetching a Vimeo video from its page fails, the metadata step also tries Vimeo's embedded player, which makes up to five attempts of its own. The worker log names each move by the proxy's position in the list, never by its credentials:

```text
[ytdlp] outbound proxy entry 3 (http://gateway.example:80) failed (botDetection); the video goes on through entry 7 (http://gateway.example:80)
```

When the attempts run out, the step ends as it would without proxies, with the platform's reason. With a single listed proxy, the worker does not repeat a refused attempt.

Each listed proxy must keep one public address. YouTube signs its media for the address that requested it and can refuse the download from another, so a rotating endpoint, which gives every connection a new address, cannot be relied on for video. List the provider's fixed-address endpoints instead. Many providers serve them from one gateway, numbered in the user name:

```bash
OUTBOUND_PROXY_URLS=http://user-1:password@gateway.example:80,http://user-2:password@gateway.example:80,http://user-3:password@gateway.example:80
```

Requests to websites still take these proxies in turn. Platforms refuse many data-center addresses; if the log shows moves for most videos, proxies on residential or ISP networks are refused less often.

To keep proxies for video alone, such as residential or ISP proxies billed per address or per gigabyte, list them in `VIDEO_INGEST_PROXY_URLS` instead. Video retrieval then goes through these proxies only, while requests to websites and sandbox sessions keep the outbound proxies, which may then include a rotating endpoint. A video moves along this list as described above, and each entry must keep one public address. When every proxy in the list has failed the video, the step ends with the platform's reason; it never falls back to the outbound proxies or a direct connection. In the worker log, a move along this list reads `video proxy entry` where one along the outbound list reads `outbound proxy entry`.

Separate the entries with commas or spaces. Each one is written `scheme://[user:password@]host[:port]`, with one of the schemes `http`, `https`, `socks4`, `socks4a`, `socks5`, and `socks5h`; the latter resolves DNS at the proxy. A malformed entry stops the backend from starting, and the message names the entry by its position.

```bash
VIDEO_INGEST_PROXY_URLS=socks5h://user-1:password@residential.example:1080,socks5h://user-2:password@residential.example:1080
```

For a single approved proxy reserved for video, set `VIDEO_INGEST_PROXY_URL` instead. It replaces the outbound proxies for video only and takes the same schemes, but as a single proxy it does not repeat a refused attempt. Set either `VIDEO_INGEST_PROXY_URL` or `VIDEO_INGEST_PROXY_URLS`: with both set, the backend does not start.

```bash
VIDEO_INGEST_PROXY_URL=socks5h://proxy.example.com:1080
```

Add credentials through your secret-management workflow if a proxy requires them. An invalid or unsupported `VIDEO_INGEST_PROXY_URL` is ignored with a warning, and retrieval goes through the outbound proxies, if any, as if it were unset. Confirm the applied configuration and a real retrieval result. Recreate the worker after changing its container environment; restarting the existing container does not import a changed `.env`.

A different route is not a promise of access. Confirm that your proxy and the source account are authorized for the content you need. If the source remains unavailable, import a transcript you already have as a [Knowledge document](/platform/knowledge/documents).

## Import an authorized browser session

The server can draw cookies from a session pool keyed by **organization and domain**. It encrypts cookie jars using `ENCRYPTION_SECRET_HEX` and does not return those cookies in list responses. Pool access is part of server-side video ingestion, not a cookie export to agent scripts. For a video, the worker writes the jar it drew into that video's sandbox session, which runs nothing but `yt-dlp` and is removed when the link is done.

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
