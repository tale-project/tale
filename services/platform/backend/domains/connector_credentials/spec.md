# Connector credentials — what a stored connection secret is held to

> **Prefix** `CCRED-` · **Docs** [`admin/connectors`](../../../../../docs/en/platform/admin/connectors.md)

A connector reaches an outside system, such as a mail account or a ticketing tool, with a
credential the organization stores for it: a key, a user name and password, a sign-in the
outside system lets Tale renew, or the organization's own app, which signs in as itself. A connector can have several credentials, one of which is its
default. These rules cover what is shown of a credential, which credential is the default,
what keeps a renewable sign-in working, which settings a credential keeps for its life, how a
GitHub App the organization registers gets its access, and what the audit log records. Who
can manage
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
alone are no value. A mailbox is named by its address: anything else, such as the mailbox's
directory object ID, is refused when the credential is added (`CREDENTIAL_CONFIG_INVALID`),
and **Connect** stays unavailable until the field holds an address.

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

## Credentials an agent pins

### CCRED-R13 · Renaming a credential keeps the agents that pin it acting as it

A project agent pins a credential by its name (`PROJ-R23`). Renaming the credential moves
every such pin to the new name in the same save, so the agents keep acting as that credential.
Deleting it leaves the pins naming nothing, and those agents get no access through that
connector until someone pins another (`SBX-R41`).

- **Example**: The Client A Coder pins Forgejo credential "Client A". Ada renames it to
  "Client A (deploy)" → the Coder's pin reads "Client A (deploy)", and its next turn pushes with
  it as before.

## GitHub Apps

An organization can connect GitHub through its own GitHub App instead of a person's token: it
registers the app on GitHub from Settings → Connectors and installs it on its account, and each
call then acts as the app with a short-lived token Tale asks GitHub for. Until the app is
installed, its credential waits as needing reconnection. A person's token for the connector
keeps working beside it.

### CCRED-R14 · Only GitHub's registration flow creates a GitHub App credential

The app's IDs, name and private key come from GitHub when the app is registered from Settings →
Connectors; nobody types or pastes them. Adding a GitHub App credential any other way is
refused, and so is replacing its key (`AUTH_METHOD_NOT_SUPPORTED`). A deployment's declaration
can neither state one nor read one back (`CREDENTIAL_NOT_DECLARABLE`, as in `CCRED-R8`).

- **Example**: Ada tries to replace the private key of the "Tale bot" credential through the
  API → the request is refused: the key of a GitHub App comes only from registering the app in
  Settings → Connectors.

### CCRED-R15 · A GitHub App's private key never leaves the encrypted store

Of what GitHub hands over at registration, Tale keeps the app's IDs, name, owner and private
key, and drops the app's client and webhook secrets. The key is stored encrypted with the
credential and used only to sign the app's own requests to GitHub (`CCRED-R17`). It is never
shown, sent with a call or handed to a sandbox, and neither it nor a token minted with it
reaches the audit log, the server log or the credential's row, which shows the app, its owner
and its installation instead of an excerpt.

- **Example**: Lena opens Settings → Connectors after registering the app "tale-acme" → its
  row names the app, its owner and its installation on acme, and shows no part of the key.

### CCRED-R16 · An installation token asks only for the connector's permissions the app holds

Each call through a GitHub App acts with an installation token Tale asks GitHub for. The token
asks for each permission the connector needs at the lower of the level it needs and the level
the installation grants, and for none the installation does not grant. It is stored with the
credential and reused until a minute before it expires; two calls at the same moment store one
token, and the second uses what the first stored.

- **Example**: The GitHub connector needs to write pull requests, and Lena installed the app
  with read access to them → the token reads pull requests and cannot write them, and later
  calls reuse it until it nearly expires.

### CCRED-R17 · The app's JWT is RS256, issued a minute back and valid under ten minutes

To list or read its installations or ask for a token, the app signs a JWT with its private key:
RS256, issued by its client ID, dated a minute back so that a server clock slightly ahead of
GitHub's is still accepted, and expiring nine minutes from now, inside GitHub's ten-minute limit.
A JWT is signed when it is needed and never stored.

- **Example**: The Tale server's clock runs 30 seconds ahead of GitHub's → GitHub still
  accepts the app's JWT, and the call gets its token.

### CCRED-R18 · A call whose token cannot be minted is refused with GitHub's reason

A call through a GitHub App goes out with an installation token or not at all: it never falls
back to another credential of the connector, and never goes out unsigned. An app nobody has
installed yet, or that GitHub no longer finds installed, is marked as needing reconnection and
refused (`CREDENTIAL_NEEDS_REAUTH`); installing it again brings it back. A suspended
installation, one that grants none of the permissions the connector needs, or a token GitHub
refuses is refused with GitHub's reason and what to check (`CREDENTIAL_APP_REFUSED`), and the
credential stays active. GitHub out of reach, or answering without a usable token, is a
retryable refusal (`CREDENTIAL_REFRESH_FAILED`), as is a call that kept losing the race to store
a token. A credential that changed while its token was asked for is judged as it is now.

GitHub can turn a stored token away (401) before it expires: the app uninstalled, its
installation suspended, or the token revoked. The token then leaves the store, unless another
call has replaced it meanwhile, and a new one is asked for, once: the call is sent once more
with it — as safe for a write as for a read, since GitHub did nothing with the first — or
refused as above. What GitHub answers the second time is the call's answer, and nothing is sent
a third time. An app's token is handed out only where it is minted and renewed, and is never
sent when it expires within the minute.

- **Example**: Lena uninstalls the app from acme on GitHub at 9:10, while its token is good
  until 10:00. An automation then comments on an issue → GitHub turns the token away, Tale
  drops it and asks for a new one, GitHub no longer finds the app installed, so the step is
  refused, the credential shows that the app must be installed again, and no person's token
  comments instead.
- **Example**: GitHub revokes the app's token at 9:10. Lena's automation then comments on an
  issue → Tale gets a new token and the comment is posted once.

### CCRED-R19 · Connecting, changing and disconnecting a GitHub App are audited

As for every credential (`CCRED-R7`), each is recorded with who did it, and none records the
private key or a token. Registering the app records its ID, name and owner. Recording an
installation, even one that changed nothing, records the account, whether the app covers all
or chosen repositories, the chosen ones as GitHub listed them, and the installation the app
left when it moved. When a new token finds GitHub reporting the installation otherwise — its
account renamed, all repositories where chosen ones were, or the reverse — the change is
recorded as the system's, with the installation before and after: its ID, its account, and
whether it covers all or chosen repositories. Disconnecting records the app, its installation
with whether it covered all or chosen repositories, and the credential that became the default.

- **Example**: Ada installs the app on two repositories of acme → the audit log says that Ada
  changed the credential's installation, names acme and the two repositories, and contains no
  key and no token.
- **Example**: Lena gives the app every repository of acme on GitHub. Once its token expires,
  an automation calls GitHub through it → the audit log says that the system changed the
  credential's installation on acme from chosen repositories to all of them.

### CCRED-R20 · A mint is logged with its installation, repositories and expiry, never the token

Each token Tale gets from GitHub, for a connector's call or to list the repositories an
installation covers, leaves one line in the server log: the credential, what the token is for
(`connector call` or `repository list`), the app, the installation, whether the token covers
`all` or `selected` repositories — with how many and the first twenty of their full names
(`selected (2: acme/api, acme/site)`) whenever GitHub's answer lists them — and when it
expires. The token, the JWT that asked for it and the private key are never logged, and a token
reused from the store logs nothing.

- **Example**: An automation opens a pull request through the app at 9:00 UTC → the server log
  gains one line, `[connector-credentials] minted a GitHub App token for credential cred_app
  (connector call): app 4242, installation 777, repositories selected, expires
  2026-11-02T10:00:00.000Z`, and no token.
- **Example**: Ada opens the app's repositories in Settings → Connectors at 11:00 UTC, after
  that token expired → the server log gains the same line with `(repository list)` and the new
  expiry, and no token.

## Not yet

- **Who can manage a connector's credentials** (`routes.ts`).
- **How a connector sends a credential**: as a header or inside the request, per kind of
  credential (`core/connector_credentials/auth_injection.ts`).
- **A credential's expiry date** and the limits on it.
- **The catalog of connectors** and which of them take an instance address: see the
  connectors spec.
- **A sandbox's git access through a GitHub App**: a sandbox gets nothing of the app yet
  (#5295).
- **GitHub's notices of a changed installation**: the app sends Tale no webhooks, so an
  uninstall, a suspension or a change of repositories shows at the app's next call, not when it
  happens.
