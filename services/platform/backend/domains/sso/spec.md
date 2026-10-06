# SSO — who an identity provider or a proxy can sign in, and as what

> **Prefix** `SSO-` · **Docs** [`admin/enterprise-sso`](../../../../../docs/en/platform/admin/enterprise-sso.md)

An organization can let its identity provider sign members in, map the provider's groups to
teams, and let an authenticating proxy hand its users in. These rules cover who gets signed in
and into which organization, what a sign-in changes about roles and teams, and what the proxy
hand-off accepts. Setting up the connection itself is mostly not covered; see Not yet.

## Signing in through the identity provider

### SSO-R1 · An existing account signs in through SSO only as a member of that organization

Someone who has an account on the deployment and no seat in the organization of the connection
is refused: no session is created and nothing is changed. The refusal says what to do next.

- **Example**: Zoe has an account in another organization. She signs in through Ada's
  organization's identity provider → refused, and she is not added to Ada's organization.

### SSO-R2 · Someone new to the deployment becomes a member of that organization

- **Example**: A new colleague signs in through the identity provider for the first time → an
  account is created for them as a member of that organization.

### SSO-R3 · An SSO sign-in opens the organization of the connection

The session starts in that organization, whichever one the person used last.

- **Example**: Mia belongs to two organizations. She signs in through the identity provider of
  the second → she lands in the second.

### SSO-R4 · A linked account cannot be taken over by another identity

Once an account is linked to an identity at the provider, a sign-in under a different identity
for the same email is refused before anything is changed, and so is the linked identity
arriving under another local email.

- **Example**: Mia's account is linked to her identity at the provider. A different identity
  there signs in with Mia's email → refused.

### SSO-R5 · A role mapped from the provider updates the member's role, never the owner's

When the connection assigns roles automatically, a member whose mapped role differs is moved
to it at sign-in, up or down. The owner's role is never changed. With automatic assignment
off, no role is touched.

- **Example**: The provider maps Mia's group to Editor, and she is a Member. She signs in →
  she is an Editor.

## Teams from the provider's groups

### SSO-R6 · Team sync gives a person the teams named by their groups

A team that does not exist is created. A team an admin built is joined, and stays the admin's.
A group whose name differs from a team's only in upper and lower case or in spacing is that
team.

- **Example**: Mia's groups include `finance`. A team named Finance exists → she joins it, and
  no second team is created.

### SSO-R7 · Team sync takes away only what it gave

When a group disappears from a person's sign-in, the membership the sync had granted is
removed, and a team the sync had created is deleted once it is empty. A membership an admin or
SCIM granted is never removed, and is not treated as the sync's afterwards.

- **Example**: An admin added Mia to the Legal team by hand. Her identity provider sends no
  Legal group → she stays in Legal.

### SSO-R8 · A group the connection excludes is left alone

The sync neither grants nor removes membership for it.

- **Example**: The connection excludes the group `all-staff`. Mia stops being in it at the
  provider → her membership of the team of that name is unchanged.

### SSO-R9 · Team sync writes what it changes to the audit log

Each team it creates or deletes and each membership it grants or removes is recorded as done
by the sync. A sign-in that changes nothing records nothing.

- **Example**: Mia signs in with a new group → the audit log records the team created for it
  and her membership, in the sync's name.

## Two-factor authentication

### SSO-R10 · An SSO sign-in starts the two-factor grace period once

When the organization requires two-factor authentication, a person's grace period starts at
their first SSO sign-in and is not restarted by later ones. Someone the policy exempts gets
none.

- **Example**: The organization requires two-factor authentication. Mia signs in through SSO
  on Monday and again on Tuesday → her grace period still counts from Monday.

## Signing in through a trusted proxy

### SSO-R11 · A proxy's hand-off needs a live key of an organization that accepts it

A hand-off with no key, with an unknown key, or with the key in the wrong header is refused,
and so is the key of an organization that has switched trusted headers off. Each refused key
counts against the network address it came from; past the allowance, further attempts are
refused without being checked. A hand-off that names no email is refused.

- **Example**: A proxy presents its key after Ada switched trusted headers off → refused, and
  nobody is signed in.

### SSO-R12 · A proxy signs in members, and adds people the deployment has never seen

A member of the key's organization is signed in to it. An email the deployment has never seen
becomes a new member of that organization. Someone who has an account and no seat in that
organization is refused, and nothing is changed.

- **Example**: Zoe has an account in another organization. A proxy holding Ada's key hands her
  in → refused, and she is not added.

### SSO-R13 · The role a proxy names moves a member's seat, never an owner's

The role is first held to the organization's ceiling. A member whose seat differs is moved to
it and the change is written to the audit log. An owner keeps the Owner role whatever the
proxy names.

- **Example**: Ada is the owner. The proxy hands her in as Member → she is signed in, still as
  Owner.

### SSO-R14 · A proxy's headers sign someone in only on a page load

A request that changes something, and a request made from another site, are never signed in by
the proxy's headers. A request that already carries a session is left to that session.

- **Example**: A page on another site makes the browser send a request that carries the
  proxy's headers → no session is created.

### SSO-R15 · A hand-off page can be framed only by the origins the organization allows

Without an embedding policy, every answer of the hand-off forbids framing. With one, the
allowed origins are named on every answer, refusals included. An unknown key never unlocks
framing.

- **Example**: Ada's organization allows `https://portal.example`. The hand-off is opened in a
  frame on another site → the browser refuses to show it.

## The connection's settings

### SSO-R16 · Requiring encrypted SAML answers needs a key that can decrypt them

Turning the requirement on without a private key stored or supplied in the same save is
refused (`sso_sp_key_required`).

- **Example**: Ada turns on **Require encrypted assertions** and has never uploaded a key →
  refused.

### SSO-R17 · Settings that cannot be read are never overwritten

When the stored connection cannot be read, a save is refused (`sso_config_unreadable`) instead
of replacing it.

- **Example**: The stored connection is damaged. Ada saves a change → refused, and the stored
  connection is left for an operator to repair.

## Not yet

- **Who can set up a connection**, and testing it before it is saved (`admin-routes.ts`,
  `admin.ts`).
- **The sign-in protocols themselves**: the checks on a SAML or OIDC answer, and that a SAML
  request is answered once (`saml-request-cache.ts`, `shim.ts`).
- **Which organization a sign-in page offers** when several have SSO turned on (`routes.ts`).
- **Sessions a proxy already started** when its key is revoked: they stay signed in, as the
  user docs say. No test holds it.
