# Several origins

> **Prefix** `ORIGIN-` · **Reset** none · **Cost** 12 boxes

One deployment answers on its canonical `SITE_URL` and on every origin in `ADDITIONAL_SITE_URLS`, and each of them is a complete entry point: a browser that arrives on one origin stays there with its session, its navigation, its uploads and previews, its sign-in and consent round-trips, and its voice output. An operator or an agent drives two origins side by side, then repeats the decisive checks behind an external TLS terminator. The suite leaves behind the files it uploads, one passkey, and the sessions it opened. What the automated specs already prove (origin matching, the proxy's trust of a terminator, the host a file link is signed for) is listed under the [Seams](../reference/automation.md#seams).

## Preconditions

Run the containerized stack (mode C in [setup.md](../setup.md)) with a second origin in its `.env`, then recreate the stack so every service reads it:

```bash
ADDITIONAL_SITE_URLS=https://alt.localhost
```

Browsers resolve every `*.localhost` name to this machine, and Caddy's internal CA covers the second origin like the first; trust it as setup.md describes. Sign in as an org admin on `https://localhost` and keep a second browser window for `https://alt.localhost`. `ORIGIN-F8` needs a TTS-capable provider (mode B's credentials); `ORIGIN-F9` an identity provider with the redirect URLs of both origins registered; `ORIGIN-F10` an OAuth connector app with both callback URLs registered. `ORIGIN-F11` and `ORIGIN-B1` need a deployment whose proxy runs `TLS_MODE=external` behind a TLS-terminating proxy that forwards the original `Host` and `X-Forwarded-Proto: https` from an address in `TRUSTED_PROXIES` (see [TLS and domains](../../../../../docs/en/self-hosted/configuration/tls-and-domains.md)).

> **Agent note**: both origins render identical pages, so judge the origin by the address bar and the Network panel's request URLs, never by page content. A request that crosses to the other origin is the finding even when it succeeds.

## Sessions and links

- [ ] `ORIGIN-F1` · **Sign in on each origin** — Signed in on `https://localhost`, open `https://alt.localhost/log-in` in the second window and sign in there too → Each window keeps its own session, and **Log out** (`auth.userButton.logOut`) on `https://alt.localhost` leaves `https://localhost` signed in after a reload.
- [ ] `ORIGIN-F2` · **Stay on the origin** — On `https://alt.localhost`, open chat, documents and settings, reload each page and go Back → The address bar never leaves `https://alt.localhost`, and the Network panel shows no request to `https://localhost`.
- [ ] `ORIGIN-F3` · **The page names its origin** — On each origin, evaluate `window.__ENV__.SITE_URL` in devtools and open `/openapi.json` → Both the value and the document's server URL read the origin in the address bar.
- [ ] `ORIGIN-F4` · **Passkeys stay with the canonical origin** — Register a passkey on `https://localhost` (**Add a passkey**, `twoFactor.passkeys.addButton`), sign out, then choose **Sign in with a passkey** (`auth.login.continueWithPasskey`) on `https://alt.localhost/log-in` → The browser offers no passkey for `https://alt.localhost`, and password sign-in still works there.

## Files

- [ ] `ORIGIN-F5` · **Upload** — In chat on `https://alt.localhost`, choose **Open chat menu** (`composer.openMenu`), then **Add photos & files** (`composer.addFiles`), and pick a small PDF → The upload's PUT goes to `https://alt.localhost/tale-blobs/…` and answers 200, the chip leaves **Uploading…** (`chat.uploadingFile`), and no request reaches `https://localhost`.
- [ ] `ORIGIN-F6` · **Image preview** — On `https://alt.localhost`, attach and send a PNG, then open it with **View image** (`chat.viewImage`) → The chip and the lightbox (`chat.imagePreview`) load the image from `https://alt.localhost/tale-blobs/…`, and the console shows no CSP violation.
- [ ] `ORIGIN-F7` · **Document preview and download** — On `https://alt.localhost`, open a PDF row's preview in `/dashboard/{org}/documents`, then **Download file** (`documents.preview.downloadFile`) → The preview's file request and the download both address `https://alt.localhost`.
- [ ] `ORIGIN-F8` · **Voice output** — On `https://alt.localhost`, choose **Speak out loud** (`chat.speakOutLoud`) on an assistant reply → The reply is spoken, and its audio loads from `https://alt.localhost/api/app/tts/audio/…`.

## Sign-in and consent

- [ ] `ORIGIN-F9` · **SSO door** — Signed out, click **Continue with SSO** (`auth.login.continueWithSso`) on `https://alt.localhost/log-in` → The identity provider receives the redirect URL that **Enterprise SSO** (`navigation.enterpriseSso`) lists for `https://alt.localhost`, and the round-trip ends signed in on `https://alt.localhost`.
- [ ] `ORIGIN-F10` · **Connector consent** — On `https://alt.localhost`, open `/dashboard/{org}/settings/connectors` and **Connect** (`settings.connectors.card.connect`) an OAuth connector → The vendor is handed the `https://alt.localhost` callback, and consent returns to the connectors page on `https://alt.localhost` with the new row.

## Behind an external TLS terminator

- [ ] `ORIGIN-F11` · **The forwarded scheme holds** — Through the terminator, repeat `ORIGIN-F3` and `ORIGIN-F5` on an additional origin → `window.__ENV__.SITE_URL`, the OpenAPI server URL and the upload's PUT all use `https://` and that origin's host, never the canonical origin.
- [ ] `ORIGIN-B1` · **A forged scheme from outside** — From a host outside `TRUSTED_PROXIES`, send `curl -s -H 'Host: <additional host>' -H 'X-Forwarded-Proto: https' http://<proxy host>/openapi.json` straight to the proxy's port 80 → The document's server URL is the canonical origin, because the proxy ignored the forged scheme.
