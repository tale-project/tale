# Video-link ingestion — Manual Test Plan

> **Purpose**: Pasting a video URL in chat creates a chip that fetches the
> video's transcript (captions, else audio → Whisper) and indexes it for the
> agent. This plan exercises the happy path and — the reason it exists — the
> YouTube bot-detection failure and the anti-bot env options that mitigate it.
> Precondition: a deployment with `yt-dlp` + `ffmpeg` (the shipped image), and
> outbound network. The bot-wall behaviour depends on the deployment's egress
> IP, so results differ between a laptop (residential IP) and a datacenter host.

## Scope & routes

| Surface | Route                   |
| ------- | ----------------------- |
| Chat    | `/dashboard/{org}/chat` |

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Open a chat thread with
a normal chat agent (not an external/sandbox agent — those file-stage
attachments instead of indexing). Have ready: a public YouTube video URL with
captions, a public YouTube URL without captions (forces the Whisper path), and a
public Vimeo URL (a non-YouTube control).

> **Agent note**: the chip is the source of truth — drive on its visible state
> label, not on wall-clock time. Terminal states are `Ready` (success) and the
> localized error strings under `chat.videoLink.errors.*`. Ingestion is
> never-retried for `botDetection`/`rateLimited`, so those chips settle fast.

## Automated coverage

| Case(s) | Status         | Test                                            |
| ------- | -------------- | ----------------------------------------------- |
| F5, F6  | ✅ automated   | `convex/video_links/ytdlp.test.ts` (flag build) |
| B1–B3   | ✅ automated   | `convex/video_links/ytdlp.test.ts` (classifier) |
| F1–F4   | ⛔ manual-only | — (needs live network + real egress IP)         |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only.

## Functional tests

| ID  | Test                 | Steps (route + control)                                                                                                                                                            | Expected (verifiable)                                                                                                                                |
| --- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Captions path        | In `/dashboard/{org}/chat`, paste a YouTube URL **with** captions into the chat input.                                                                                             | A chip appears, progresses through reading states, and reaches **Ready**. Send a message asking about the video; the agent cites transcript content. |
| F2  | Whisper fallback     | Paste a YouTube URL **without** captions.                                                                                                                                          | Chip reaches **Ready** via the audio→Whisper path (slower). Transcript is usable by the agent.                                                       |
| F3  | Non-YouTube control  | Paste a public Vimeo URL.                                                                                                                                                          | Chip reaches **Ready** (Vimeo does not bot-wall server IPs the way YouTube does).                                                                    |
| F4  | Proxy mitigation     | On a datacenter host where F1 shows the bot-detection error, set `VIDEO_INGEST_PROXY_URL=socks5h://…` to a residential proxy, restart the `convex` container, re-paste the F1 URL. | Chip now reaches **Ready** instead of the bot-detection error.                                                                                       |
| F5  | Player-client tuning | Set `VIDEO_INGEST_PLAYER_CLIENT=default,mweb` (with a PO-token provider via `VIDEO_INGEST_POT_PROVIDER_URL`), restart, re-paste.                                                   | Ingestion succeeds; `docker logs` shows the provider consulted.                                                                                      |
| F6  | Cookies jar          | Set `VIDEO_INGEST_COOKIES_FILE` to a guest cookie jar, restart, re-paste.                                                                                                          | Ingestion succeeds and no cookie contents appear in logs.                                                                                            |

## Boundary & error tests

| ID  | Test                      | Input                                                                                    | Expected                                                                                                                                  |
| --- | ------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Bot wall on datacenter IP | Paste a YouTube URL from a flagged/datacenter egress with **no** proxy/cookies.          | Chip shows the localized **botDetection** message ("blocked automated access — try again later or use another platform"). No retry storm. |
| B2  | Invalid proxy value       | Set `VIDEO_INGEST_PROXY_URL=not-a-url`, restart, paste a URL.                            | The invalid value is ignored (a redacted `console.warn` in `convex` logs), ingestion proceeds as if unset — it does not crash.            |
| B3  | Secret hygiene            | Set a proxy URL with inline credentials `socks5h://user:pass@host`, trigger any failure. | `docker logs tale-convex` never prints `user`/`pass` or the raw proxy URL (sanitizer redacts them).                                       |

## Accessibility (WCAG 2.1 AA)

| ID  | Check                          | Expected                                                                                                      |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| A1  | Chip is reachable and labelled | The video chip and its Retry control are keyboard-focusable with a visible focus ring and an accessible name. |

## Performance

| ID  | Metric                  | Target                                                     |
| --- | ----------------------- | ---------------------------------------------------------- |
| P1  | Captions ingestion (F1) | Reaches **Ready** within a few seconds on an unflagged IP. |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Video-link ingestion
Functional: ___/6   Boundary: ___/3   A11y: ___/1   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
