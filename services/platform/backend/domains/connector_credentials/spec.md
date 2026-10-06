# Connector credentials — what a stored connection secret is held to

> **Prefix** `CCRED-` · **Docs** [`admin/connectors`](../../../../../docs/en/platform/admin/connectors.md)

A connector reaches an outside system, such as a mail account or a ticketing tool, with a
credential the organization stores for it: a key, a user name and password, or a sign-in the
outside system lets Tale renew. A connector can have several credentials, one of which is its
default. These rules cover what is shown of a credential, which credential is the default,
what keeps a renewable sign-in working, and what the audit log records. Who can manage
credentials and how a connector uses one are not covered; see Not yet.

## What is shown of a credential

### CCRED-R1 · A stored secret is shown only as its first four and last two characters

For a user name and password the excerpt is of the password, never the user name. For a
renewable sign-in it is of the access token, never the token that renews it. A secret too
short to excerpt safely is not shown at all.

- **Example**: Ada stores an API key for a ticketing connector → the list shows the first four
  and last two characters of the key.

## The default credential

### CCRED-R2 · Deleting the default credential makes the oldest working one the new default

A credential that is disabled, or whose sign-in must be renewed by a person, is never picked.
When no working credential is left, the connector has no default. The list says on the
default credential which one would take over, so the delete holds no surprise. Deleting a
credential that is not the default changes nothing about the default.

- **Example**: A connector has three credentials: the default, an older disabled one and a
  newer working one. Ada deletes the default → the newer working one becomes the default.

## Sign-ins that are renewed

### CCRED-R3 · A sign-in that is still valid is used as it is

No request goes to the outside system, and nothing is saved.

- **Example**: A connector's access is valid for another hour when an automation uses it → it
  is used directly.

### CCRED-R4 · An expired sign-in is renewed when it is needed, once

When the access has expired, or is about to, it is renewed with the outside system and the
new access is stored. Two uses at the same moment do not renew twice: the second takes what
the first stored.

- **Example**: Two automations use a connector at the same moment, just after its access
  expired → the access is renewed once, and both runs carry on.

### CCRED-R5 · A sign-in the outside system no longer accepts is marked as needing reconnection

This is the case when there is nothing to renew it with, or when the outside system rejects
the renewal. The credential is marked, and using it is refused (`CREDENTIAL_NEEDS_REAUTH`)
until a person reconnects it. A sign-in an admin renewed in the meantime is not marked.

- **Example**: Someone revokes Tale's access in the outside system. An automation uses the
  connector → the step is refused, and the credential shows that it must be reconnected.

### CCRED-R6 · An outage of the outside system does not mark a sign-in as broken

When the outside system cannot be reached, the use is refused as something to try again
(`CREDENTIAL_REFRESH_FAILED`), and the credential stays active.

- **Example**: The outside system is down for ten minutes while an automation runs → the step
  fails with an error that can be retried, and the credential is still active afterwards.

## What the audit log records

### CCRED-R7 · Every change to a credential is written to the audit log, never its secret

Creating, changing and deleting a credential are each recorded with the connector's name and
who did it. A change records which fields changed and their values before and after; a change
of the secret is recorded by the field's name only. A delete records what it removed and
which credential became the default. A change made by the system itself, not a person, is
recorded as the system's.

- **Example**: Ada replaces a connector's API key → the audit log says that Ada changed the
  secret of that connector's credential, and contains neither the old nor the new key.

## Not yet

- **Who can manage a connector's credentials** (`routes.ts`).
- **How a connector sends a credential**: as a header or inside the request, per kind of
  credential (`core/connector_credentials/auth_injection.ts`).
- **A credential's expiry date** and the limits on it.
- **The catalog of connectors** and which of them take an instance address: see the
  connectors spec.
