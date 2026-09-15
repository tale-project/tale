---
title: TLS and domains
description: Choose certificate handling, configure public origins, and verify browser and identity-provider access after a domain change.
---

Choose the URL users will open and the service that terminates TLS before configuring sign-in or inviting people. Tale's Caddy proxy can use its internal certificate authority, obtain public certificates, or serve HTTP behind your own TLS proxy.

## Choose a TLS mode

| `TLS_MODE` | Use it when | What you operate |
| --- | --- | --- |
| `selfsigned` | Developing locally or using a private environment whose clients trust your CA. | Install Caddy's root certificate in each client trust store. |
| `letsencrypt` | Serving a public hostname through Tale's proxy. | Public DNS, reachable ports 80/443, and persistent Caddy certificate storage. |
| `external` | A load balancer or reverse proxy already handles TLS. | The upstream certificate, trusted forwarding, and the private HTTP connection to Tale. |

Keep `SITE_URL` as the public URL and `HOST` as its hostname. Applying new environment values requires recreating the affected services. With the workspace CLI, use the deployment workflow and include `--stop` when the proxy must be recreated; inspect the preview and allow for downtime. With your own Compose file, the service is `proxy`, not the generated container name.

## Trust a private development certificate

`TLS_MODE=selfsigned` makes Caddy issue certificates from its internal CA. A browser warning means that client does not trust the issuing CA or the hostname does not match; check both.

Copy the **public root certificate** from the running proxy container. Set `TALE_PROXY_CONTAINER` to the actual container name from your deployment:

```bash
docker cp "$TALE_PROXY_CONTAINER:/data/caddy/pki/authorities/local/root.crt" ./tale-local-root.crt
```

Verify that the certificate came from your own instance, then install it using the operating system's or browser's trusted-certificate settings on each client that needs access. Do not distribute the CA's private key. Running `caddy trust` through `docker exec` affects the container's trust store, not your workstation's. See [Caddy's local HTTPS guidance](https://caddyserver.com/docs/automatic-https#local-https) for the trust boundary.

## Obtain a public certificate

1. Point the hostname's public DNS records at the intended host. Check both A and AAAA records when IPv6 is configured.
2. Make ports 80 and 443 reachable at that proxy, and preserve its `caddy-data` volume across replacements.
3. Configure the public URL and certificate mode:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=letsencrypt
TLS_EMAIL=ops@example.com
```

4. Apply the configuration, inspect `tale logs proxy`, and open the public URL from another machine. Check the hostname and certificate chain in the browser.

Caddy handles issuance and renewal. DNS, firewall, ACME, and storage problems can delay or prevent them, so monitor certificate expiry and proxy errors rather than assuming a fixed issuance time. `TLS_EMAIL` provides the ACME contact address; it is not a substitute for expiry monitoring. [Caddy's automatic HTTPS requirements](https://caddyserver.com/docs/automatic-https) describe the public network prerequisites.

## Use an upstream TLS proxy or custom certificate

Set `TLS_MODE=external` when another proxy terminates TLS, while keeping the browser-facing HTTPS URL:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
TLS_MODE=external
TRUSTED_PROXIES=10.20.0.0/16
```

Tale's Caddy instance serves HTTP inside this arrangement, so your proxy has to report how the browser connected. Forward the original `Host` header and send `X-Forwarded-Proto: https`; Tale uses both to keep each browser on the origin it opened. Caddy accepts forwarded headers only from the addresses in `TRUSTED_PROXIES`: CIDR ranges separated by spaces, or `private_ranges` for every private and loopback address, which is the default when the variable is unset. Set it to the range your proxy connects from. The proxy refuses to start on any other value, and the other TLS modes ignore the variable.

Keep the HTTP hop private. The proxy container publishes port 80, so allow only your TLS proxy to reach it: a client inside a trusted range could otherwise claim an HTTPS connection it never made. Verify sign-in callbacks, secure cookies, uploads, and streaming through the complete path. A custom certificate installed on the upstream proxy is independent of Tale's TLS mode.

If you maintain a custom Tale proxy image and Caddyfile instead, mount your certificate and private key read-only and configure Caddy's `tls <cert-file> <key-file>` directive yourself. Merely mounting the files or setting `TLS_MODE=external` does not make Caddy load them. The custom configuration must retain Tale's routes, health behavior, and metrics protection.

## Change the public domain or base path

Update `HOST` and `SITE_URL` together, plus any browser-facing storage endpoint and identity-provider callback registrations that use the old origin. Recreate the affected application and proxy services, then test sign-in, an existing file download, an upload, and a live-updating page at the new URL.

For a managed deployment created with `identity.bootstrap: "fresh"`, follow the [managed hostname migration procedure](/self-hosted/install/cli-install#managed-origin-migration) as part of this transition. It requires the retained deployment state and an explicit `identity.migrateOriginFrom`; changing only `HOST` and `SITE_URL` does not update the managed identity and client journals. Keep the existing account, organization and client credentials, then export the consumer configuration for the new issuer after the deployment is ready.

For a subpath such as `https://example.com/app`, also set `BASE_PATH=/app`. Keep that prefix on requests sent to Tale's proxy: its generated routing strips the prefix internally. Check absolute links and callbacks rather than verifying only the home page. Keep the old domain available during a planned transition if users still need its existing links or sessions.

## Serve several domains {#several-domains-at-once}

List additional bare origins in `ADDITIONAL_SITE_URLS`, separated by commas or whitespace:

```bash
HOST=tale.example.com
SITE_URL=https://tale.example.com
ADDITIONAL_SITE_URLS=https://tale.partner.example,https://app.example.org
```

An origin has a scheme, host, and optional port, but no path. Caddy serves the listed origins and requests their public certificates in `letsencrypt` mode. Configure DNS and reachability for each. These origins are separate entry points, with cookies scoped to the domain where the user signs in.

Tale accepts only configured origins when deriving browser-facing URLs; an unrecognized host falls back to `SITE_URL`. Do not use that fallback as a domain-configuration shortcut.

### Keep canonical settings stable

| Setting | Why the canonical domain matters |
| --- | --- |
| E-mail links and notifications | Background work has no browser origin to use. |
| SAML SP entity ID | The identity provider identifies one stable service provider. |
| SCIM resource locations | Directory synchronization needs stable resource URLs. |
| Passkeys | Credentials are bound to a relying-party domain and do not transfer automatically between domains. |
| Public object-storage endpoint | Background work signs file links for this endpoint. A link handed to a browser uses the domain the browser is on when the endpoint is one of this deployment's origins; review a separate file host when changing domains. |

### Register every provider callback

Open **Settings > Enterprise SSO** to copy each domain's OIDC redirect or SAML ACS URL. SAML metadata includes the configured ACS entries. For connector consent, use the per-domain redirect URLs under **Settings > Connectors > OAuth apps**. Register the required URLs with each provider and test a fresh sign-in from every supported origin.
