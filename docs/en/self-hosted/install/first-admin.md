---
title: Create the first admin
description: Walk a brand-new self-hosted instance through its one-time setup wizard — first account becomes Owner with no key, new people join by invite, and the admin key is only for the Convex dashboard.
---

A brand-new Tale instance has no users. The first person to open it runs a one-time setup wizard that creates their account, signs them in, makes them the **Owner**, and names the first organization — no bootstrap key, no manual promotion. This walk covers that first run, how teammates join afterward, and where to get the Convex dashboard admin key if you ever need to inspect the backend directly.

The one thing to unlearn from older instructions: the first sign-up no longer asks for an admin key. Tale is invite-only after the first account, so there is no open sign-up page to lock down either.

## Before you begin

Have the instance running and reachable on `SITE_URL`. Verify with:

```bash
docker compose ps
```

Every service should show `running` or `healthy`. If any is unhealthy, [troubleshooting](/self-hosted/operate/observability/troubleshooting) names the four common causes.

## Run the setup wizard

Open `SITE_URL`. With no users yet, Tale sends you straight to the setup wizard — there is no separate sign-up page to hunt for, because the log-in screen redirects an empty instance into setup automatically. The wizard creates your account and signs you in mid-flow, then names your first organization.

The provider step is optional: skip it and add a key later under **Settings > AI providers**, or connect OpenRouter now to start chatting immediately. Get a key at [openrouter.ai/keys](https://openrouter.ai/keys). The finish step drops you in the dashboard.

## Confirm you're the Owner

The first account on a fresh instance is the **Owner** automatically — there is no key to paste and no promotion step. Confirm under **Settings > People** that your row carries the Owner badge.

## How new people join

There is no self-service sign-up. Once an Owner exists, `SITE_URL/sign-up` redirects visitors to the log-in page, so nobody can create an account on their own. Add teammates by invite under **Settings > People**; each invite carries the role the new member lands with. The full role model is in [Members and roles](/platform/admin/members-and-roles).

## Get the Convex dashboard admin key

The admin key plays no part in the steps above — it only unlocks the **Convex dashboard**, the low-level view of the backend database. The key is deterministic: it is derived from `INSTANCE_SECRET`, so it stays the same across restarts rather than rotating.

Get it whichever way fits how you installed:

- With the CLI: `tale convex admin` finds the platform container and prints the key. `tale dev` also prints it once services are healthy.
- From a git clone: `./scripts/get-admin-key.sh` from the repo root.

Open `SITE_URL/convex-dashboard`, enter `SITE_URL` as the deployment URL, and paste the key when prompted.

## Troubleshooting

- **The wizard didn't appear — you landed on the log-in page.** Users already exist on this instance; the wizard only runs on a truly empty one. Sign in instead, or have an existing Owner invite you under **Settings > People**.
- **A service is unhealthy.** The platform container is not fully up. `docker compose ps` says which service is failing; `docker compose logs platform` shows why.
- **The dashboard rejects the admin key.** The key is deterministic from `INSTANCE_SECRET`, so a rejection usually means `INSTANCE_NAME` and `INSTANCE_SECRET` differ between the platform and Convex services, or the deployment URL is wrong — use `SITE_URL`. Regenerate with `tale convex admin` to be sure you copied the current value.

## Where this gets used

You now have an Owner and an org, and you know the admin key is a backend-inspection tool, not part of sign-in. The first run is keyless by design: open the URL, the wizard makes you the Owner, and everyone else joins by invite.

The next steps that belong on the calendar are inviting the rest of the admins (under **Settings > People**), adding a model provider, and publishing the first agent — the [Cloud onboarding](/cloud/onboarding) walk is identical from this point on except for the URL.
