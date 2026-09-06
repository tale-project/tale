---
title: TLS and domains
description: How the Caddy proxy terminates TLS — self-signed for development, Let's Encrypt for production, external for an upstream proxy — plus custom domain and custom certificate setups.
---

The `tale-proxy` container is Caddy. It owns TLS termination, host routing, and the metrics auth gate; every browser-facing request lands here first. The three modes — self-signed, Let's Encrypt, external — cover the three deployment shapes most operators reach for, and the variable that switches between them is `TLS_MODE` in your `.env`.

The env-var reference rows live in [Environment reference](/self-hosted/configuration/environment-reference#tls). This page is the per-mode walkthrough and the recipes for custom domains and bring-your-own certificates.

## Self-signed (default)

`TLS_MODE=selfsigned` runs Caddy with a certificate it generates from its internal CA. The browser warns the first time, and the host needs to trust the cert to suppress the warning — that is intended for local development:

```bash
docker exec tale-proxy caddy trust
```

The trust command imports Caddy's CA into the system trust store on the host running the docker daemon. Other machines on the network still see the warning unless they import the CA too. Production never uses this mode.

## Let's Encrypt

`TLS_MODE=letsencrypt` lets Caddy issue and renew a real public certificate. Three prerequisites must hold or the issuance loop fails:

- The hostname in `HOST` and `SITE_URL` resolves to the host's public IP from the public Internet.
- Ports 80 and 443 are reachable from the public Internet (port 80 carries the ACME HTTP-01 challenge).
- `TLS_EMAIL` is set to a mailbox you read — Let's Encrypt warns there before expiry.

```bash
# .env
TLS_MODE=letsencrypt
TLS_EMAIL=ops@yourdomain.com
```

The first boot blocks for about a minute while the ACME challenge runs. After that, renewals are automatic 30 days before expiry; failures land in `docker compose logs proxy`.

## External proxy

`TLS_MODE=external` makes Caddy serve plain HTTP on the inside, and you front it with your own reverse proxy that terminates TLS upstream. Pick this when:

- You already run a CDN or load balancer that handles certificates.
- You want to terminate TLS once at the edge of your VPC and run everything internal as plaintext.
- Your compliance posture requires a specific certificate authority that Caddy does not support.

```bash
# .env
TLS_MODE=external
SITE_URL=https://tale.yourdomain.com  # the URL your users hit
```

The upstream proxy needs `X-Forwarded-Proto: https` set on every request so Tale generates correct redirects and absolute URLs. Without it, sign-in links land on `http://` and the auth cookie's `Secure` flag rejects them.

## Custom domain

The domain itself is just `HOST` and `SITE_URL`. The same Caddyfile inside `tale-proxy` reads both at boot. Change them, recreate the proxy container (`docker compose up -d --force-recreate tale-proxy`), and the new domain is live within seconds. Let's Encrypt re-issues for the new name on the next request that hits the new hostname.

```bash
# .env
HOST=tale.example.com
SITE_URL=https://tale.example.com
```

Subpath deployments — Tale behind `https://example.com/app/` — set `BASE_PATH=/app` in addition. The reverse proxy upstream of Caddy strips nothing; Tale handles the prefix itself.

## Several domains at once

One deployment can answer on more than one domain — an apex and a vanity domain, a partner's
white-label host, a legacy name kept alive after a rename. List the extra origins in
`ADDITIONAL_SITE_URLS`, comma- or whitespace-separated, and keep `SITE_URL` as the canonical one:

```bash
# .env
HOST=tale.example.com
SITE_URL=https://tale.example.com
ADDITIONAL_SITE_URLS=https://tale.partner.example,https://app.example.org
```

Each entry is a bare origin — scheme, host, optional port, no path. Caddy serves every one of
them from the same site block and, under `TLS_MODE=letsencrypt`, obtains a certificate per name,
so each domain's DNS has to point at this host before you recreate the proxy.

Every listed domain is a complete entry point rather than a redirect: a visitor who signs in on
one stays on it, and the links the app builds — sign-in callbacks, connector consent flows,
audio and download URLs — keep them there, because the session cookie lives on that domain and
nowhere else.

<Warning>

A domain not in this list is never honoured, even if a request arrives carrying its `Host`
header: unrecognised hosts fall back to the canonical `SITE_URL`. That is what stops a forged
`Host` from pointing a sign-in callback at someone else's server.

</Warning>

### What stays on the canonical domain

`SITE_URL` remains the single answer wherever a deployment can only have one, so leave it
pointing at your primary domain:

| Stays canonical                | Why                                                                        |
| ------------------------------ | -------------------------------------------------------------------------- |
| E-mail links and notifications | Sent without a browser request, so there is no domain to infer.            |
| SAML SP entityID               | The identity provider knows the service provider by one stable identifier. |
| SCIM `meta.location`           | Resource URLs must stay stable across directory syncs.                     |
| Passkeys                       | WebAuthn binds a credential to one domain; one registered on the canonical host is not offered on the others. |
| `OBJECT_STORE_PUBLIC_ENDPOINT` | Defaults to `SITE_URL`; presigned URLs are signed against that origin.     |

### Register each domain with your identity and OAuth providers

A sign-in that starts on `tale.partner.example` comes back to `tale.partner.example`, so that
domain's own callback URL must be registered with the provider. The product shows the exact list
per domain, so you never have to assemble the URLs by hand:

- **Settings > Enterprise SSO** lists the redirect (OIDC) and ACS (SAML) URL for every domain.
  The SAML metadata document advertises one `AssertionConsumerService` per domain, so importing
  it registers them all at once.
- **Settings > Connectors > OAuth apps** lists every domain's connector and cloud-import
  redirect URI.

## Bring-your-own certificate

For an internal CA or a wildcard cert you already own, mount the cert and key into `tale-proxy` and add a `tls` directive to the Caddyfile:

```yaml
# compose.yml override
services:
  proxy:
    volumes:
      - ./certs/fullchain.pem:/etc/tale/cert.pem:ro
      - ./certs/privkey.pem:/etc/tale/key.pem:ro
    environment:
      TLS_MODE: external # bypasses Caddy's auto-issuance
```

Then either pre-build a `tale-proxy` image with the custom Caddyfile, or front Tale with your own reverse proxy and stick with `TLS_MODE=external` — both paths are supported and the second is simpler.

## Where this fits

The three modes cover the three deployment shapes most teams hit; the env-var rows live in [Environment reference](/self-hosted/configuration/environment-reference#tls). If you are setting up a fresh production host right now, [Production Linux server install](/self-hosted/install/linux-server) walks Let's Encrypt end-to-end with the firewall and DNS steps in order.
