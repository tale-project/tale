---
title: Harden a production deployment
description: Protect host access, network exposure, secrets and recovery before opening Tale to users.
---

Review these controls before launch and after changes to your host, network or identity setup. You need operator access to the deployment and a recovery route that remains available while you change access rules.

## Restrict host administration

Use named operator accounts, SSH keys and a supported, patched operating system. Limit access to the host, configuration directory, backups and Docker socket to the people who operate the deployment.

Membership in the `docker` group grants root-level capabilities through the Docker daemon. Running the CLI as a non-root account does not remove that authority. Treat Docker access as privileged administration, as described in [Docker’s post-installation guidance](https://docs.docker.com/engine/install/linux-postinstall/).

## Check public exposure

Allow the intended public proxy ports and restrict administrative access to trusted sources. Keep databases, object-store administration, backend internals and sandbox services off the public network unless a separately reviewed design requires them.

Inspect the ports published by your actual Compose configuration and verify reachability from outside the host. Host firewall rules alone can be misleading because Docker manages forwarding and port-publication rules; follow [Docker’s firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

If you use trusted-header authentication, only the trusted upstream proxy may reach the application. That proxy must remove caller-supplied identity headers before setting its own. See [Authentication](/self-hosted/configuration/authentication).

The platform’s `robots.txt` discourages indexing of the application but explicitly allows public developer and status paths, including `/docs`, `/openapi.json`, `/llms.txt`, `/llms-full.txt` and `/status`. These crawler instructions are not access controls. Keep confidential data behind authentication and review what your public status report exposes.

## Decide whether coding agents may sign in {#agent-sign-in}

[Coding-agent sign-in](/self-hosted/configuration/authentication#coding-agent-sign-in) lets a person connect Claude Code, Codex, Cursor or another agent to the MCP endpoint without an API key, and it is on unless you turn it off. It adds public surfaces: the `/.well-known/oauth-*` discovery documents, the sign-in server's `/api/auth/oauth2/*` endpoints (self-registration among them, rate-limited) and the consent page at `/oauth/consent`. A connection never does more than its person's role allows, belongs to one organization and the access the person chose, and every connect, change and disconnect is in the audit log. Removing the person, a new password or a refresh token used twice disconnect it.

If you keep it on, check three things:

- **Reachability.** Agents that run on a person's computer (Claude Code, Codex, Cursor, VS Code, Gemini CLI) reach Tale through that person's browser and a loopback redirect, so they need no exposure beyond the public address people already use. claude.ai, Claude Desktop and mobile connect from Anthropic's cloud instead. For them, allow inbound HTTPS from Anthropic's published outbound range — currently `160.79.104.0/21`, see [Anthropic's IP addresses](https://platform.claude.com/docs/en/api/ip-addresses) — to `/.well-known/oauth-protected-resource*`, `/.well-known/oauth-authorization-server*`, `/api/auth/.well-known/openid-configuration`, `/api/auth/oauth2/token`, `/api/auth/oauth2/register` and `/api/v1/mcp`. A deployment reachable only on a private network cannot be used from those hosted apps.
- **Egress.** The backend fetches an agent's client metadata document from the agent's own host, `claude.ai` for Claude Code and `chatgpt.com` for Codex. If you restrict the backend's outbound traffic, allow those hosts, or list the hosts you accept in `TALE_MCP_CLIENT_METADATA_HOSTS`. When the backend cannot fetch the document, the agent is told only that it could not be fetched. The backend log says why, on a line that starts with `[agent-oauth] client metadata document fetch failed`, for example a resolver that answers with a private address for the agent's host, which Tale refuses.
- **Who can connect.** An Owner, Admin or Developer, and a member holding a competence that is used with an API key. The person needs a verified address and a finished two-factor enrolment where it is enforced, and allowing more than reading takes a sign-in from the last day. Review who holds those roles and competences as you would for API keys.

To keep agents on API keys, set `TALE_MCP_CLIENT_METADATA_DOCUMENTS=false` and `TALE_MCP_DYNAMIC_CLIENT_REGISTRATION=false` and recreate the backend.

## Verify TLS at the public address

Use a trusted certificate for the address people actually open. Configure `TLS_MODE=letsencrypt` for the bundled public TLS path, or `TLS_MODE=external` when your edge terminates TLS. A self-signed local setup does not establish public certificate trust.

Check the certificate chain, expiry and renewal process, then exercise sign-in and callbacks through the public address. [TLS and domains](/self-hosted/configuration/tls-and-domains) explains the configuration.

## Protect secrets and keys

Replace the example values before production. Give each deployment its own database password, authentication secrets and encryption key. Restrict `.env` and secret files to the operator; store recovery copies in your secret-management system.

Use [SOPS](/self-hosted/configuration/secrets-with-sops) for supported file-based secrets when appropriate. SOPS does not encrypt every application record or the whole disk. Preserve the matching keys for retained backups. Rotate deliberately using [Cryptography](/self-hosted/operate/security/cryptography); an arbitrary key replacement can invalidate sessions or make stored credentials unreadable.

Set `TALE_AUDIT_PEPPER` for failed-sign-in pseudonymization. Audit retention is organization-scoped: review each organization’s applied policy and your required evidence period in [Retention](/self-hosted/configuration/retention).

## Prove recovery

Choose a backup frequency and retention period that match the data loss your organization can tolerate. Include database, configuration, object storage and the secrets needed to restore them. External storage needs its own coordinated backup.

Keep protected copies off the deployment host and restore to an isolated destination periodically. Verify sign-in, files and essential workflows after recovery. [Backups and restore](/self-hosted/operate/backups-and-restore) explains the CLI snapshot’s scope and service interruptions.

## Limit sandbox destinations

The sandbox egress proxy allows public HTTPS destinations by default while enforcing its private-address and metadata-address restrictions. Set `SANDBOX_EGRESS_ALLOWLIST` to restrict hostnames further. This example belongs in the project’s `.env` and permits two Python package hosts:

```dotenv .env
SANDBOX_EGRESS_ALLOWLIST=^pypi\.org$|^files\.pythonhosted\.org$
```

Recreate the egress service with the updated environment. Confirm required destinations work and an unlisted destination is refused. Add other registries or source hosts only when your workloads need them. The built-in document skills need none to create and read Word, PowerPoint, Excel and PDF files: the libraries they use ship in the sandbox image. Text recognition (OCR) for scanned PDFs is not included. Model traffic uses the separate sandbox model gateway, so this allowlist is not a policy for every outbound connection in Tale.

`SANDBOX_EGRESS_DENIED_HOSTS` works the other way round: it keeps egress open and refuses the hosts it lists, comma-separated host names that also cover their subdomains. A sandbox that installs through package caches you run (the Incus backend's `SANDBOX_INCUS_NPM_REGISTRY` and `SANDBOX_INCUS_PYPI_INDEX` in the [environment reference](/self-hosted/configuration/environment-reference)) lists the public registries there, so that a package manager that ignores its configuration fails visibly. Do not set it together with `SANDBOX_EGRESS_ALLOWLIST`: the proxy refuses to start.

Review private-network opt-ins separately. `TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` admits model-provider destinations, including the sandbox model gateway; it does not open general sandbox egress. `TALE_ALLOW_PRIVATE_CRAWL_HOSTS=1` admits intranet crawl targets and private product image URL values. Enable only the needed path and keep its configuration under operator control. [Providers](/self-hosted/configuration/providers) explains the model checks; the [environment reference](/self-hosted/configuration/environment-reference) distinguishes both flags.

## Monitor and investigate

Configure authenticated metrics access with `METRICS_BEARER_TOKEN` and connect your monitoring system. Test that an alert reaches the responsible operator. [Operations](/self-hosted/operate/observability/operations) covers useful signals.

A daily job verifies retained audit rows incrementally and notifies admins of detected hash-chain breaks. **Verify now** under **Settings > Governance > Logs > Chain integrity** checks at most 1,000 entries. Follow [Audit-log integrity](/self-hosted/operate/security/audit-log-integrity) for the limits and evidence-preservation procedure.

## Check the deployed response

Inspect security headers at the public address after proxy changes. A proxy can alter the headers produced by Tale, so source configuration alone is insufficient. Check content-security policy, framing restrictions, HTTPS transport policy and content-type handling alongside actual sign-in behavior.

Do not copy cross-origin isolation or HSTS preload settings from another deployment without reviewing your callbacks, external assets and subdomains. Keep the results with your deployment record and repeat the checks after upgrades.
