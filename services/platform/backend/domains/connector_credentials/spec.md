# Connector credentials — what a stored connection secret is held to

> **Prefix** `CCRED-` · **Docs** [`admin/connectors`](../../../../../docs/en/platform/admin/connectors.md)

A connector reaches an outside system, such as a mail account or a ticketing tool, with a
credential the organization stores for it: a key, a user name and password, a sign-in the
outside system lets Tale renew, or the organization's own app, which signs in as itself. A connector can have several credentials, one of which is its
default. These rules cover what is shown of a credential, which credential is the default,
what keeps a renewable sign-in working, which settings a credential keeps for its life, and
what the audit log records. Who can manage
credentials and how a connector uses one are not covered; see Not yet.

## What is shown of a credential

### CCRED-R1 · A stored secret is shown only as its first four and last two characters

For a user name and password the excerpt is of the password, never the user name. For a
renewable sign-in it is of the access token, never the token that renews it. For an app that
signs in as itself it is of the client secret, never the access token fetched with it. A
secret too short to excerpt safely is not shown at all.

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

When the outside system cannot be reached, or answers that it is down or too busy, the use
is refused as something to try again (`CREDENTIAL_REFRESH_FAILED`), and the credential stays
active.

- **Example**: The outside system is down for ten minutes while an automation runs → the step
  fails with an error that can be retried, and the credential is still active afterwards.

## Apps that sign in as themselves

### CCRED-R9 · An app's access is fetched when it is needed and kept until it expires

The credential stores the app's client ID and secret, and the directory its sign-in names.
When a call finds no access, or access about to expire, Tale asks the outside system for new
access as the app and stores it with the credential; a call before it expires uses it as it
is. Only the access is sent with a call, never the client secret, and neither is written to
the log.

- **Example**: The mail sync reads the shared mailbox every few minutes → the first pass of
  the hour fetches the app's access, and the other passes of that hour use it.

### CCRED-R10 · An app the outside system refuses is refused with what to check

When the outside system refuses the app's sign-in, for example because its client secret
expired, using the credential is refused (`CREDENTIAL_APP_REFUSED`), naming the outside
system's reason and the directory ID, client ID and client secret to check. The credential
stays active, so replacing the secret is all it takes. An outside system that cannot be
reached, or is down or too busy, is a retryable refusal, as for a renewable sign-in
(`CCRED-R6`).

- **Example**: The app's client secret expired over the weekend → Monday's mail sync fails
  with `invalid_client` and the advice to replace the secret; Ada replaces it and the next
  pass reads the mailbox again.

### CCRED-R11 · An app's directory and application ID are shown, never its client secret

The two values tell an admin which app a credential signs in as, and they are what a refused
sign-in says to check, so the credential's row shows them beside the excerpt of the client
secret. Replacing the secret starts from them, and only the client secret is typed again.

- **Example**: Ada opens Settings → Connectors → the row of the shared mailbox reads "App
  1b2c… in directory contoso.onmicrosoft.com", and **Replace app credentials** opens with both
  filled in.

## A credential's settings

### CCRED-R12 · A setting a connector fixes is set when the credential is added, and kept

Some settings decide where a credential acts, and so what everything it did belongs to: an
Outlook credential's mailbox holds the mail sync's position in that mailbox, the conversations
it filed and the replies they send. Such a setting is entered when the credential is added —
for a sign-in at the outside system, beside **Connect**, so the credential exists with it from
the start — and an edit that changes or clears it is refused (`CREDENTIAL_CONFIG_INVALID`):
another value is another credential. Blanks around a value are not part of it, and blanks
alone are no value.

- **Example**: Lena enters `promotion@example.com` beside **Connect** → the credential works in
  the shared mailbox from its first sync. Later Ada tries to point it at `support@example.com`
  → the edit is refused, and she adds a second credential for the support mailbox instead.

## What the audit log records

### CCRED-R7 · Every change to a credential is written to the audit log, never its secret

Creating, changing and deleting a credential are each recorded with the connector's name and
who did it. A change records which fields changed and their values before and after; a change
of the secret is recorded by the field's name only. A delete records what it removed and
which credential became the default. A change made by the system itself, not a person, is
recorded as the system's.

- **Example**: Ada replaces a connector's API key → the audit log says that Ada changed the
  secret of that connector's credential, and contains neither the old nor the new key.

## Declared credentials

### CCRED-R8 · A declared credential reads back as a digest; a renewed one is never declared

A deployment's declaration names the environment variables a credential's secret fields are
read from, never the values. Managed configuration reads back the credential's name, sign-in
method, endpoint, default, the names of its secret fields and a slow, salted digest of their
values, so a value changed in the environment or in Tale reads as differing and the next apply
writes the declared ones. A credential keeps the sign-in method it was created with, and a
sign-in the outside system renews, or an app that signs in as itself, is connected in Tale,
never declared (`CREDENTIAL_NOT_DECLARABLE`): the access Tale renews for it would read as a
change. Before anything of the declaration is written, its plan asks
whether the connector takes the credential — the connector, its sign-in method, its endpoint —
without sending a value. A declaration states none of a connector's per-credential settings,
so a new credential for a connector that requires some, such as an IMAP/SMTP mailbox or HTTP, is
refused there (`CREDENTIAL_CONFIG_REQUIRED`) and connected in Tale instead.

- **Example**: Ada rotates the Jira token in the deployment's environment → the next plan shows
  the Ops credential changed, and its apply seals the new token; nothing records the token.

## Not yet

- **Who can manage a connector's credentials** (`routes.ts`).
- **How a connector sends a credential**: as a header or inside the request, per kind of
  credential (`core/connector_credentials/auth_injection.ts`).
- **A credential's expiry date** and the limits on it.
- **The catalog of connectors** and which of them take an instance address: see the
  connectors spec.
