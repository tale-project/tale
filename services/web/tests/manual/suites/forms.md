# Forms

> **Prefix** `FORM-` · **Reset** none · **Cost** 21 boxes

Exercise the two marketing forms — **Contact** and **Request demo** —
end-to-end: client validation, the `/api/forms/submit` endpoint, the anti-spam
layers (honeypot, time trap, rate limit, body cap), and the Discord delivery
path. This is the pipeline whose live 503 motivated these guides: the endpoint
returns **503** whenever `WEB_DISCORD_WEBHOOK_URL` is unset.

## Scope & routes

| Surface      | Route                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Contact form | `/contact` (also `/{lang}/contact`)                                                                                       |
| Demo form    | `/request-demo` (also `/{lang}/request-demo`)                                                                             |
| Submit API   | `POST /api/forms/submit` (`server.ts` → `lib/forms/schemas.ts`, `lib/forms/rate-limit.ts`, `lib/forms/discord-embeds.ts`) |

## Preconditions

Bring the site up per [SETUP.md](../setup.md). Delivery rows (FORM-F2/FORM-F3)
need **mode B** with `WEB_DISCORD_WEBHOOK_URL` pointing at a **throwaway**
Discord webhook you can read. Mode C (vite dev) has **no** submit endpoint —
every submit fails with the generic error; only the validation rows
(FORM-B1–FORM-B4) are testable there.

> **Live-site safety**: on `https://tale.dev`, never complete a real
> submission — it delivers to the team's Discord. Verify endpoint health with
> the honeypot probe (FORM-F6): a honeypot-tripped request is accepted (`{ ok:
true }`) but **silently discarded**, so nothing is delivered. A **503**
> response instead means the webhook env var is missing in production — that
> is the defect to file.

> **Agent note**: the form sets `startedAt` on mount and the client rejects
> submits younger than **3 s** (`MIN_SUBMIT_DELAY_MS`) — pause ≥ 3 s between
> page load and submit or you'll hit FORM-B5 instead of the happy path. Field
> errors render via the shared `Field` component; the server error renders as
> a `role="alert"` paragraph above the submit button.

## Functional tests

- [ ] `FORM-F1` · **Contact happy path** — `/contact` (mode B): fill **Name**
  (`contact.fieldName`), **Email** (`forms.email`), optional **Company**
  (`contact.fieldCompany`), **Message** ≥ 10 chars (`contact.fieldMessage`);
  tick the privacy checkbox (**I confirm that I have read the** … **Privacy
  Policy**, `forms.privacyPrefix` + `forms.privacyLink`); wait ≥ 3 s after
  load; click **Get in touch** (`contact.submit`) → The form is replaced by a
  `role="status"` success card: **Thanks — we got it** (`forms.success.title`)
  + **We'll be in touch within one business day.**
  (`forms.success.description`) with a **Send another** button
  (`forms.success.sendAnother`); the POST returned 200 `{ ok: true }`
- [ ] `FORM-F2` · **Contact Discord embed** — After FORM-F1, open your test
  Discord channel → One message from username **Tale website** with an embed
  titled **New contact message** listing Name/Email/Company fields and the
  message body.
- [ ] `FORM-F3` · **Demo happy path + embed** — `/request-demo` (mode B): fill
  **Name**, **Email**, optional **Phone** (`requestDemo.fieldPhone`),
  **Company**, pick one or more **Interested in** options
  (`requestDemo.fieldInterests`: `requestDemo.interests.*`), optional
  **Additional comment** (`requestDemo.fieldMessage`); privacy; wait ≥ 3 s;
  **Get in touch** (`requestDemo.submit`) → Success card as in FORM-F1; the
  Discord embed is titled **New demo request** and includes the selected
  interests.
- [ ] `FORM-F4` · **Send another** — After FORM-F1, click **Send another**
  (`forms.success.sendAnother`) → The empty form returns (all fields reset to
  defaults, privacy unchecked); a second valid submit succeeds again.
- [ ] `FORM-F5` · **Privacy policy link** — On either form, click **Privacy
  Policy** (`forms.privacyLink`) → Lands on `/legal/privacy-policy` and the
  document renders. Note: the link is a plain `<a
  href="/legal/privacy-policy">` — on `/de/contact` it still targets the
  **English** legal page (candidate localization finding)
- [ ] `FORM-F6` · **Endpoint probe (live-safe)** — `curl -X POST
  {base}/api/forms/submit -H 'content-type: application/json' -d
  '{"form":"contact","payload":{"name":"probe","email":"probe@example.com","message":"manual-test
  endpoint
  probe","privacy":true,"startedAt":0,"website":"http://spam.example"}}'` →
  HTTP 200 `{"ok":true}` and **nothing** arrives in Discord (honeypot
  `website` non-empty → silently discarded). HTTP **503**
  `{"ok":false,"error":"not_configured"}` = `WEB_DISCORD_WEBHOOK_URL` unset —
  file it. (`startedAt: 0` is fine: the 3 s trap only rejects **recent**
  timestamps)

## Boundary & error tests

- [ ] `FORM-B1` · **Required fields** — Submit an empty contact form → Inline
  field errors: **Required** on Name and Email, **Tell us a bit more (10+
  characters)** on the empty Message (the min-length rule fires first —
  verified live), and **You must accept the privacy policy**
  (`forms.privacyRequired`); no request is sent.
- [ ] `FORM-B2` · **Invalid email** — `not-an-email` in **Email** → Inline
  error **Invalid email**; no request sent.
- [ ] `FORM-B3` · **Short message** — Contact **Message** = `too short` (< 10
  chars) → Inline error **Tell us a bit more (10+ characters)**.
- [ ] `FORM-B4` · **Invalid phone** — Demo **Phone** = `abc` (letters) and
  `12` (< 4 chars) → Inline errors **Invalid phone number** / **Too short**;
  empty phone is allowed.
- [ ] `FORM-B5` · **Time trap** — Fill a valid contact form and submit
  **within 3 s** of page load → `role="alert"` error **Hold on — review your
  details before submitting.** (`forms.errors.tooFast`); the same submit
  succeeds after waiting.
- [ ] `FORM-B6` · **Rate limit** — Mode B: 6 valid submits from one IP within
  60 s (use **Send another** or curl F6-style payloads **without** the
  honeypot… mode B only) → The 6th returns HTTP **429** with a `retry-after`
  header; the UI shows **Too many submissions. Wait a moment, then try
  again.** (`forms.errors.rateLimited`); after the window it succeeds again
  (limit: 5/min/IP)
- [ ] `FORM-B7` · **Oversize payload** — curl a body > 4 KiB (e.g. a 5000-char
  `message`) → HTTP **413** `Payload too large`; via the UI the 2000-char Zod
  cap yields **Too long** first.
- [ ] `FORM-B8` · **Malformed JSON** — `curl -X POST {base}/api/forms/submit
  -d 'not json'` → HTTP **400** `Invalid JSON`; a schema-invalid JSON body
  returns **400** `Validation failed`; `GET` returns **405**.
- [ ] `FORM-B9` · **Dev server (mode C)** — Valid submit against `bun run dev`
  → The generic error **Something went wrong. Try again.**
  (`forms.errors.generic`) — the endpoint only exists in `server.ts`;
  environment, not a bug.
- [ ] `FORM-B10` · **Webhook unset (503)** — Mode B with
  `WEB_DISCORD_WEBHOOK_URL` empty: submit a valid contact form after ≥ 3 s →
  HTTP **503** `{"ok":false,"error":"not_configured"}`; `role="alert"` shows
  **This deployment has no form delivery configured yet, so your message was
  not sent. Please use another channel to reach the team.**
  (`forms.errors.notConfigured`). A 503 **without** that code (e.g. from a
  proxy mid-deploy) still shows `forms.errors.serverUnavailable`. With
  `WEB_FORMS_REQUIRED=true`, `GET /api/health` also returns **503** and
  `checks.forms.ok: false`

## Accessibility (WCAG 2.1 AA)

- [ ] `FORM-A1` · **Field labels** → Every visible input has a programmatic
  label (the `Field` component wires `label[for]`); the honeypot block is
  `aria-hidden` with `tabindex="-1"` — invisible to AT and skipped by Tab.
- [ ] `FORM-A2` · **Error announce** → Field errors are associated with their
  inputs; the server error is `role="alert"`; the success card is
  `role="status"`
- [ ] `FORM-A3` · **Keyboard only** → Complete FORM-F1 with the keyboard alone
  — Tab order: Name → Email → (Company/Phone/interests) → Message → privacy
  checkbox → **Get in touch**; Space toggles the checkbox.
- [ ] `FORM-A4` · **Submit state** → While submitting, the button shows its
  loading state and a second Enter doesn't double-submit (one POST in the
  network log)

## Performance

- [ ] `FORM-P1` · **Submit roundtrip** → Success card visible **< 2 s** after
  clicking submit (mode B, local webhook; server aborts the webhook call at 10
  s)
