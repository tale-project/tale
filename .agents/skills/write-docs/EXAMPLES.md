# Worked examples

Three canonical before/after pairs. Use them when you need a concrete case; the [contract](SKILL.md) names the rule, the examples here show what passing it looks like.

## Example 1 — Opening rewrite

**Drift.**

```markdown
# Members and roles

This page covers members and roles.
```

**Tale voice.**

```markdown
# Members and roles

Members are the people in your organisation who can sign in to Tale. Roles control what each member can do — read, write, deploy, administrate. Admins and Owners read this page when they're setting up a team for the first time or when an audit asks who has access to what. Five roles cover almost every team Tale ships to; the sixth (`Disabled`) revokes access without deleting the account.
```

**Why this works.** Four sentences answering _what_, _who_, _why_. No `simply`, `easy`, or `we recommend`. The narrator names the audience (Admins and Owners) and the load-bearing distinction (five active roles, one revocation role) in the same breath as the definition. The drift version fails Rule 2 — one sentence, no _who_, no _why_.

## Example 2 — Closing rewrite

**Drift.**

```markdown
## Next

- [Configuring SSO](/platform/admin/sso)
- [API keys](/platform/admin/api-keys)
```

**Tale voice.**

```markdown
## Where this fits

Members and roles are the access surface every other admin page touches — SSO authenticates them, API keys belong to them, audit logs name them. The next page worth reading depends on what you're doing next. If you're rolling out the team from scratch and want to skip the password-and-magic-link layer, [configuring SSO](/platform/admin/sso) is the natural follow-up; if you're wiring an external system to act on a member's behalf, [API keys](/platform/admin/api-keys) cover the per-role permission rules.
```

**Why this works.** The heading is named for what the section does (`Where this fits`), not for an action (`Next`). The body recaps the load-bearing idea (members are the access surface), then contextualises each next-read by the reader's actual decision (rolling out a team vs. wiring an external system). The drift version fails Rule 2 — stub heading, bare links, no recap.

## Example 3 — Walkthrough rewrite (effect-first)

**Drift, action-first.**

```markdown
Click **Settings**, then **Members**, then **Invite member**. This adds a person to your organisation.
```

**Tale voice, effect-first.**

```markdown
To add a person to your organisation, open **Settings > Members** and click **Invite member**. The new member receives an email link valid for 24 hours and lands in the default role you pick — change it on the form before sending if they should not be a Member.
```

**Why this works.** Effect-first phrasing — outcome before the click. Single navigation move via `>`. The consequence (24-hour expiry, default role) appears inline rather than as a "more on this later" promise. The drift version reads like a recipe; the rewrite reads like the page already knew the question the reader landed with.

## When to read this file

When you're about to write an opening, a closing, or a walkthrough and want to see what passing prose looks like. Don't read it up front — read the [contract](SKILL.md) first, then come here when you need a concrete case.
