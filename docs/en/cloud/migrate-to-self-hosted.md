---
title: Plan a move to self-hosted Tale
description: Prepare an assisted Cloud migration, validate the destination, and agree on a recovery plan.
---

Moving from Cloud to self-hosted Tale transfers responsibility for the infrastructure to your team. Plan the move with Tale and the operator of the destination so application data, knowledge, files, configuration, and encryption keys remain consistent.

This is an operator-assisted migration. The shared product does not provide the organization-wide **Export** and `/_internal/import` workflow described in older documentation. Exporting individual records through the API is not a full instance backup.

## Decide what the move must preserve

List the organizations and data to move, the permitted downtime, the target version, and the people who will approve the result. Confirm the infrastructure requirements in the [self-hosted installation guide](/self-hosted/install/quickstart).

| Area | Questions to resolve before the move |
| --- | --- |
| Application database | Which backup is the consistent source, and which versions can restore it? |
| Knowledge stores | Which per-organization stores, indexes, and embedding settings must move? |
| Files and configuration | Which object-store data and configuration directories belong to the deployment? |
| Encryption | Which encryption and signing keys must be retained securely? |
| External services | Which callback URLs, webhook destinations, credentials, or network rules change? |
| Background work | Which runs must finish or be paused before the final copy? |

Use the [backup and restore guide](/self-hosted/operate/backups-and-restore) with your operator. Do not substitute a collection of API exports for that plan.

## Rehearse on an isolated destination

Restore a copy into an isolated environment before the cutover. Keep outbound automations and scheduled jobs controlled so the rehearsal cannot send duplicate messages or make unintended external changes.

Verify sign-in, roles, representative documents, project files, a chat response, and the configuration of critical integrations. Compare counts and selected records with the source. A service that boots has passed only the first check.

## Agree on the cutover and recovery

Write down who freezes writes, takes the final copy, changes routing, and validates the new instance. Agree on what triggers a rollback and how to prevent both instances accepting changes at once. Keep the source and verified backups available until the migration is accepted.

Update public origins, TLS, SSO callbacks, and integration destinations as required by the new address. Existing sessions or external credentials may need renewal; test them rather than assuming they transfer.

## Hand over operation

Confirm monitoring, backup schedules, restore ownership, upgrade procedures, and support contacts. Record the accepted checks and tell the team which address to use. Your next ongoing responsibilities are [upgrades](/self-hosted/operate/upgrades), [observability](/self-hosted/operate/observability/operations), and rehearsed restores.
