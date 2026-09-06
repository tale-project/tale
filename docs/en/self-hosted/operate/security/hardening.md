---
title: Hardening
description: The hardening checklist for a production Tale instance — non-root user, firewall, TLS, secret storage, audit-log retention, backups.
---

The defaults Tale ships with are safe for development and reasonable for a small production install. Going from "reasonable" to "ready for the regulator" is a checklist, not a configuration flag — every row below tightens one specific attack surface. Walk the list once before opening the URL to real users, and run it again after every major upgrade.

The reference detail for each row lives elsewhere — TLS in [TLS and domains](/self-hosted/configuration/tls-and-domains), backups in [Backups and restore](/self-hosted/operate/backups-and-restore), retention in [Retention](/self-hosted/configuration/retention). This page is the index that names what to harden and points at the page that walks it.

## Host

| Item                           | Why it matters                                          |
| ------------------------------ | ------------------------------------------------------- |
| Non-root operator user         | Limits blast radius if the platform user is compromised |
| SSH key auth only              | Password auth is the open door bots scan for            |
| Unattended security updates    | Patches the OS without waiting for a maintenance window |
| Host firewall (ufw / nftables) | Closes everything that is not 22, 80, 443               |
| Disk encryption at rest        | Required if you run SOPS in plaintext mode              |

The non-root user is the one most teams skip. Tale's containers run their own non-root processes inside, but the docker daemon itself runs as root — operating that daemon as the operator user (member of the `docker` group, not as root) is the cheapest tightening on this page. The full walk lives in [Production Linux server install](/self-hosted/install/linux-server).

## Network

The proxy is the only inbound surface. Block everything else.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

If you run trusted-headers auth, the platform port must not be reachable directly from anywhere except the upstream proxy — anything that can hit it with the right headers becomes that user. A Docker network or a host firewall rule both work; pick one and verify it from outside the host.

## TLS

`TLS_MODE=selfsigned` is for development. Production runs `letsencrypt` (or `external` if you front Tale with your own TLS-terminating proxy). The renewal cron is automatic; the alert that fires when renewal fails is what saves you 90 days later. See [TLS and domains](/self-hosted/configuration/tls-and-domains).

## Secrets

Every secret in `.env` is sensitive — the auth signing secret, the encryption key, the database password, the age key, the metrics bearer token. The minimum bar:

- `.env` is mode 0600 and owned by the operator user.
- `BETTER_AUTH_SECRET`, `ENCRYPTION_SECRET_HEX`, `INSTANCE_SECRET` are rotated off the example values that ship in `.env.example`.
- `DB_PASSWORD` is changed from the default placeholder.
- `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` is set — leaving both unset is supported but reserved for disk-encrypted hosts with external secret management.

The full SOPS walk and rotation procedure lives in [Secrets with SOPS](/self-hosted/configuration/secrets-with-sops).

## Audit logs

Audit logs are immutable and retention-bound. Compliance frameworks expect at least a year; the bound is enforced per-deployment, so the strictest org's setting is what actually runs. Set the floor in your operator config to match the loosest framework you support, and make sure backups capture audit-log rows along with the rest of the database. The retention reference lives in [Retention](/self-hosted/configuration/retention).

## Backups

A backup that has not been restored is a hope, not a backup. The minimum: daily Postgres dumps written by the `tale-db` cron, copied off-host within the hour, and a quarterly restore drill that rebuilds a working instance from the snapshot. The full procedure is in [Backups and restore](/self-hosted/operate/backups-and-restore).

## Sandbox isolation

Run-code is the riskiest surface in the product — the only place where user-supplied input becomes executed code. `tale-sandbox` runs with no privileged caps, its network is internal-only, and `tale-sandbox-egress` is its only outbound path. At the hostname layer that path is open by default: sandboxed code reaches any public host over HTTPS, while cloud-metadata endpoints and private address ranges are always blocked at the IP layer — that floor holds in every configuration.

The hardening lever is `SANDBOX_EGRESS_ALLOWLIST`. Set it in `.env` to a pipe-separated list of hostname regexes and recreate `tale-sandbox-egress`, and the proxy flips to default-deny — only matching hosts are reachable. A registry-only lockdown that keeps pip, npm, uv, and git-over-HTTPS working:

```bash
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$|^registry\.npmjs\.org$|^objects\.githubusercontent\.com$|^codeload\.github\.com$|^github\.com$|^api\.github\.com$
```

Keep the list short and prefer specific hosts over wildcards.

## Monitoring

`METRICS_BEARER_TOKEN` is unset in `.env.example` — that is intentional, so a fresh install does not leak metrics. Set the token, scrape from your Prometheus, and the alert thresholds in [Operations](/self-hosted/operate/observability/operations) cover the customer-impacting signals.

The audit-log hash chain is verified automatically every night by a scheduled integrity check. A genuine break raises a critical security alert to the organisation's admins — in the notification bell, and in your Slack channel when one is connected — so tampering surfaces even when nobody is watching the logs; a signed checkpoint that can't be verified because `TALE_AUDIT_SIGNING_KEY` is unset alerts more calmly, as the configuration gap it is. The alert fires once when a break is first detected or when it changes, not every day for the same break. Admins re-run the verification on demand from the **Chain integrity** panel on **Settings > Governance > Logs** — a status badge, the last-check time, and a **Verify now** button. When one fires, work the [audit-log integrity runbook](/self-hosted/operate/security/audit-log-integrity) to tell a real break from a benign retention or configuration artifact.

## HTTP security headers

Every HTML response carries a strict set of security headers, and the set is locked by tests so an upgrade cannot silently drop one. The platform web client (`services/platform`) sends a nonce-based Content-Security-Policy with no `unsafe-inline` scripts, HSTS on HTTPS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` alongside CSP `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`, and `X-Permitted-Cross-Domain-Policies: none`. It scores A+ on the MDN HTTP Observatory, and that grade is asserted by the CI test suite — the scoring is re-implemented in tests that fail the build on any regression. The marketing site and the docs site ship the same header family, adding `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` set to `same-origin`.

Verify it against your own deployment:

- `curl -sI https://<your-host>/ | grep -iE 'content-security|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy|cross-origin'`
- Scan the host on [securityheaders.com](https://securityheaders.com) or the [MDN HTTP Observatory](https://developer.mozilla.org/en-US/observatory).

<!--
  The MDN Observatory UI is only localized in some languages. When adding a new
  docs language, check whether developer.mozilla.org/<lang>/observatory exists
  and fall back to the en-US analyze links if it does not.
-->

The public demo is the live reference for what a correct deployment reports: the [Observatory scan of demo.tale.dev](https://developer.mozilla.org/en-US/observatory/analyze?host=demo.tale.dev) came back A+ on 15 July 2026 — score 115/100, all ten tests passed. The one header the report lists as not implemented, `Cross-Origin-Resource-Policy`, costs no points; it is the deliberate exception described below.

Cross-origin isolation (COOP/CORP) is deliberately left off on the platform app: `Cross-Origin-Opener-Policy: same-origin` would sever the live window handle an OAuth sign-in popup uses to hand the finished sign-in back to the app, and `Cross-Origin-Resource-Policy` would block branding assets loaded from a second host. The content sites, which do neither, enable both. HSTS is emitted only when `SITE_URL` is `https://`.

## Where this fits

Hardening is not a one-pass task — the list above is what to walk before launch, and re-walk after every upgrade or after every change to the network shape. The next thing worth reading after this is whichever row above you have not done yet.
