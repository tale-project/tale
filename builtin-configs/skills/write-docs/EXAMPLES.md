# Worked examples

Four canonical before/after pairs. The [contract](SKILL.md) names the rules; the examples show
what passing them looks like. Don't read this file up front — come here when you're about to write
an opening, a closing, a walkthrough, or a text-heavy→journey transformation and want a concrete
case.

## Example 1 — Opening rewrite

**Drift.**

```markdown
# Members and roles

This page covers members and roles.
```

**The voice.**

```markdown
# Members and roles

Members are the people in your organisation who can sign in. Roles control what each member can
do — read, write, deploy, administrate. Admins read this page when they're setting up a team for
the first time or when an audit asks who has access to what. Five roles cover almost every team;
the sixth (`Disabled`) revokes access without deleting the account.
```

**Why this works.** Four sentences answering _what_, _who_, _why_. No `simply`, `easy`, or "we
recommend". The narrator names the audience and the load-bearing distinction (five active roles,
one revocation role) in the same breath as the definition. The drift version fails the opening
rule — one sentence, no _who_, no _why_.

## Example 2 — Closing rewrite

**Drift.**

```markdown
## Next

- [Configuring SSO](/admin/sso)
- [API keys](/admin/api-keys)
```

**The voice.**

```markdown
## Where this fits

Members and roles are the access surface every other admin page touches — SSO authenticates them,
API keys belong to them, audit logs name them. The next page worth reading depends on what you're
doing next. If you're rolling out the team from scratch and want to skip the password layer,
[configuring SSO](/admin/sso) is the natural follow-up; if you're wiring an external system to act
on a member's behalf, [API keys](/admin/api-keys) cover the per-role permission rules.
```

**Why this works.** The heading is named for what the section does, not `Next`. The body recaps
the load-bearing idea (members are the access surface), then contextualises each next-read by the
reader's actual decision. The drift version is a stub heading over bare links.

## Example 3 — Walkthrough rewrite (effect-first)

**Drift, action-first.**

```markdown
Click **Settings**, then **Members**, then **Invite member**. This adds a person to your
organisation.
```

**The voice, effect-first.**

```markdown
To add a person to your organisation, open **Settings > Members** and click **Invite member**.
The new member receives an email link valid for 24 hours and lands in the default role you pick —
change it on the form before sending if they should not be a Member.
```

**Why this works.** Effect first — outcome before the click. Single navigation move via `>`. The
consequence (24-hour expiry, default role) appears inline rather than as a "more on this later"
promise. The drift version reads like a recipe; the rewrite reads like the page already knew the
question the reader landed with.

## Example 4 — Text-heavy page → journey page

The flagship transformation: same facts, reshaped around the reader's task, with the component
vocabulary earning its place.

**Drift** — accurate, complete, and unread:

```markdown
## Webhook triggers

Webhook triggers allow agents to be invoked from external systems. The webhook configuration
panel is found in the agent editor under the Webhook tab. The panel contains the endpoint URL
field, the secret field, and the enable toggle. The endpoint URL is generated automatically when
the webhook is enabled. The secret is used to sign requests using HMAC-SHA256 and should be
stored securely. Requests must be sent as POST with a JSON body. Note that disabling the webhook
invalidates the endpoint URL immediately, and re-enabling it generates a new URL, so any external
system using the old URL will stop working. The payload format is described below. There is also
a test button that sends a sample payload.

## Next

- [Automations](/automations/concepts)
```

**Journey shape** — the same facts, reorganized around "I want to invoke my agent from an
external system":

````markdown
## Invoke an agent from an external system

A webhook turns your agent into an HTTP endpoint: an external system POSTs a JSON payload, the
agent runs with it. You need write access to the agent and a system that can send authenticated
POST requests.

<Steps>

<Step title="Enable the webhook">

To get an endpoint, open the agent's **Webhook** tab and switch on **Enable webhook**. The
endpoint URL and signing secret generate immediately — both appear in the panel.

<Frame caption="The Webhook tab with the generated endpoint and secret.">

![The agent editor's Webhook tab showing the generated endpoint URL, the signing secret, and the enabled toggle.](/images/agents-webhook-panel.webp)

</Frame>

<Warning>

Disabling the webhook invalidates the URL immediately, and re-enabling generates a new one —
every external caller must be updated.

</Warning>

</Step>

<Step title="Send a signed request">

Requests are POST, JSON-bodied, and signed with HMAC-SHA256 using the panel's secret:

```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -d '{"message": "Summarize today's open tickets"}'
```

<Check>

Click **Send test payload** in the panel — a sample delivery appears in the run log within a few
seconds, which proves the endpoint is live before you wire the real caller.

</Check>

</Step>

</Steps>

## Where this fits

The webhook is the push entry point into an agent; scheduled and event triggers live in
[Automations](/automations/concepts), and the payload reference below covers every field.
````

**Why this works — including what was NOT componentized.** The heading names the reader's task,
not the feature. The buried gotcha (URL invalidation) became the one `<Warning>` — it is genuinely
destructive. The test button became a `<Check>` — it is the step's verification. The conceptual
opening stayed **prose**; the payload reference stays a plain section below — reference material
is not a step. Two steps, one warning, one check, one frame: every component beats its
plain-markdown alternative, and nothing else got boxed.
