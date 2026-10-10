# Trusted headers — who can let a proxy sign members in, and as what

> **Prefix** `THDR-` · **Docs** [`admin/enterprise-sso`](../../../../../docs/en/platform/admin/enterprise-sso.md)

An application that already authenticates its users can hand them into an organization through
its reverse proxy. The organization gives the proxy a key, and the proxy names each user and
their role in request headers. These rules cover what an admin manages on the **Trusted
headers** card, and the role a proxy can give someone. What the sign-in itself does with a
member, a new address or a revoked key is not covered; see Not yet.

## Who can manage trusted headers

### THDR-R1 · Only owners and admins can see or change the trusted-header settings

This covers the whole card: reading it, the switch, the role ceiling, creating a key and
revoking one. Anyone else is refused (`ROLE_FORBIDDEN`) and nothing is read or changed.

- **Example**: Mia is a member. She opens the trusted-header settings of her organization →
  refused, and nothing is shown.

## Keys

### THDR-R2 · A key is shown once, when it is created

Only a fingerprint of the key and its first characters are kept, so nobody can read the key
again, an admin included.

- **Example**: Ada creates a key and closes the dialog without copying it → the key cannot be
  shown again. She revokes it and creates another.

### THDR-R3 · An organization holds at most 10 live keys

The next one is refused (`TRUSTED_HEADER_KEY_LIMIT`) and nothing is created.

- **Example**: Ada's organization has 10 live keys. She creates one more → refused.

### THDR-R4 · Revoking a key marks it as revoked and keeps its record

The revocation is written to the audit log. Revoking a key that is already revoked changes
nothing.

- **Example**: Ada revokes the key of a proxy that was retired → the key is marked as revoked,
  its record stays, and the audit log names Ada.

### THDR-R5 · An admin can revoke only the keys of their own organization

A key of another organization is answered as not found (`TRUSTED_HEADER_KEY_NOT_FOUND`).

- **Example**: Zoe, an admin of another organization, revokes Ada's key by its ID → not found,
  and the key stays live.

## What a proxy can do with a key

### THDR-R6 · The key a proxy presents decides the organization it signs members in to

The organization is the one that issued the key. An empty key, and a key nobody issued, match
no organization.

- **Example**: A proxy presents a key that no organization issued → it matches no
  organization.

### THDR-R7 · A proxy can never give a role above the organization's ceiling, or Owner

The ceiling is the **Highest role a proxy may assert**. A role above it is lowered to it.

| The proxy asks for | Under the ceiling | The person gets |
| --- | --- | --- |
| Admin | Admin | Admin |
| Admin | Member | Member |
| Developer | Editor | Editor |
| Editor | Developer | Editor |
| Owner | Admin | Member |
| no role, or one Tale does not know | any | Member |

- **Example**: The ceiling is Editor. A proxy asks for Developer for Mia → she gets Editor.

### THDR-R8 · Trusted headers are off until an admin turns them on

An organization that never touched the card reads as switched off, with Member as its ceiling
and no keys.

- **Example**: A new organization opens the card for the first time → the switch is off and
  the ceiling is Member.

### THDR-R9 · Each save of the settings writes one audit entry

The entry is named for the switch when the save turned it on or off, and for the ceiling when
the switch stayed where it was.

- **Example**: Ada turns the switch on and raises the ceiling in one save → one audit entry,
  recorded as trusted headers turned on.

### THDR-R10 · A session keeps a proxy's role only while the organization still allows it

A session carries the role a proxy asserted at sign-in. It counts only while trusted headers
are on, a key is not revoked, and the role is one a proxy may assert under the current ceiling —
never Owner. Otherwise the member's own seat decides. Nobody can write that role into a session
but the sign-in itself.

- **Example**: A session row says Owner for a member's organization → the member gets their own
  seat, because no proxy can assert Owner.

## Not yet

- **The sign-in itself**: what happens to a member, to an address Tale has never seen, to an
  account of another organization, and to a sign-in with a revoked key or while the switch is
  off. That is the SSO domain's (`domains/sso/trusted-headers.ts`).
- **Sessions a revoked key already started** stay signed in, as the user docs say. No test
  here holds it.
- **The names of the headers** a proxy sends: set by the operator
  (`core/trusted_headers_auth/header_names.ts`).
