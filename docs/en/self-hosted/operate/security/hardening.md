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

Recreate the egress service with the updated environment. Confirm required destinations work and an unlisted destination is refused. Add other registries or source hosts only when your workloads need them. Model traffic uses the separate sandbox model gateway, so this allowlist is not a policy for every outbound connection in Tale.

## Monitor and investigate

Configure authenticated metrics access with `METRICS_BEARER_TOKEN` and connect your monitoring system. Test that an alert reaches the responsible operator. [Operations](/self-hosted/operate/observability/operations) covers useful signals.

A daily job verifies retained audit rows incrementally and notifies admins of detected hash-chain breaks. **Verify now** under **Settings > Governance > Logs > Chain integrity** checks at most 1,000 entries. Follow [Audit-log integrity](/self-hosted/operate/security/audit-log-integrity) for the limits and evidence-preservation procedure.

## Check the deployed response

Inspect security headers at the public address after proxy changes. A proxy can alter the headers produced by Tale, so source configuration alone is insufficient. Check content-security policy, framing restrictions, HTTPS transport policy and content-type handling alongside actual sign-in behavior.

Do not copy cross-origin isolation or HSTS preload settings from another deployment without reviewing your callbacks, external assets and subdomains. Keep the results with your deployment record and repeat the checks after upgrades.
