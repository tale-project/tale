# API keys — whose a key is, what it reaches, and whose limits its spend counts toward

> **Prefix** `APIKEY-` · **Docs** [`admin/api-keys`](../../../../../docs/en/platform/admin/api-keys.md)

An API key lets a program call Tale's REST API, its MCP server and its model endpoints. A person
can make their own key, which works wherever they are a member. An Owner or Admin can also make
a key for another member, for a team, for a project or for the organization itself; such a key
works in that one organization only. These rules cover who can make which key, what a key acts
as and reaches, when it stops working, who sees it, and whose limits its spend counts toward.
Capping what one project spends is not covered; see Not yet.

## Who can make a key, and for whom

| Key for          | Who makes it                  | Acts as                              | Works in                         |
| ---------------- | ----------------------------- | ------------------------------------ | -------------------------------- |
| Yourself         | anyone the create rule admits | you, with your role                  | every organization you belong to |
| Another member   | an Owner or Admin             | that member, with their role         | this organization                |
| A team           | an Owner or Admin             | its own identity, with a chosen role | this organization                |
| A project        | an Owner or Admin             | its own identity, with a chosen role | this organization                |
| The organization | an Owner or Admin             | its own identity, with a chosen role | this organization                |

### APIKEY-R1 · Only owners and admins make a key for someone or something else

Anyone may make a key of their own. A key for another member, a team, a project or the
organization is made by an Owner or Admin of that organization (`API_KEY_OWNER_FORBIDDEN`).

- **Example**: Mia, a member, opens Create API key → she can make only her own key. Ada, an
  admin, can also make one for Mia, the Finance team, the Launch project or Acme.

### APIKEY-R2 · A key made for a member acts as that member, in this organization only

The key has the member's live role and teams, and stops working when they leave or are disabled
here. It never works in another organization the member belongs to. The member is told the key
exists, sees it in their list and can end it. Its spend counts toward the member's own limits.

- **Example**: Ada makes "Billing sync" for Mia → Mia gets a notification; the key reads what
  Mia can read in Acme, and Mia's limits apply to what it spends.

### APIKEY-R3 · An admin makes a key only for a member whose role is below their own

Acting as someone takes more authority than they hold. A key for yourself is made as your own
key (`API_KEY_MEMBER_SELF`); one for an admin or the owner, by an admin, is refused
(`API_KEY_MEMBER_FORBIDDEN`), and so is one for someone who is not an active member
(`API_KEY_MEMBER_NOT_FOUND`).

- **Example**: Ada, an admin, picks Olav, the owner → refused. Olav picks Ada → allowed.

### APIKEY-R4 · A team's, a project's or the organization's key acts with the role it was given

Such a key is not a person: it acts as an identity of its own, which no member list, picker or
e-mail reaches, and it keeps working when the person who made it leaves. Its role is Member,
Editor or Developer — or Admin for the organization's key alone (`API_KEY_ROLE_FORBIDDEN`).

- **Example**: Ada makes the Finance team's key as an Editor → it edits what an editor of the
  Finance team can. She cannot make it an Admin.

## What a key reaches

### APIKEY-R5 · A key made for others works in its own organization alone

It needs no `X-Organization-Slug`. A slug naming another organization is refused with its own
organization listed (`ORG_FORBIDDEN`), and `GET /me` lists that one organization, with the role
the key acts with, and names whose key it is.

- **Example**: Acme's own key sends `X-Organization-Slug: beta` → 403 `ORG_FORBIDDEN`, listing
  `acme`.

### APIKEY-R6 · A team's key sees what its team sees; a project's key reaches its project alone

A team's key sees the team's projects, documents and inbox. A project's key reaches its project,
the project list (which shows that project only), `GET /me` and the model endpoints; any other
route is refused (`API_KEY_SCOPE_FORBIDDEN`), and it reads no conversation or e-mail. The
organization's key sees what its role sees across the organization.

- **Example**: The Launch project's key calls `GET /contacts` → 403 `API_KEY_SCOPE_FORBIDDEN`.

## When a key stops working

### APIKEY-R7 · A key ends when it is revoked or when what it belongs to is gone

Deleting the team or the project, removing the member, or deleting the organization ends its
keys at once, and each ending is recorded in the audit log, saying why. A revoked key is refused
on its next request.

- **Example**: Ada deletes the Finance team → its key is refused from the next call on, and the
  audit log records the revocation by the system.

### APIKEY-R10 · A key expires on the day its maker picks, at most a year away, or never

The choices are 7, 30, 90 or 365 days, a day picked in a calendar between tomorrow and a year
from today, or never (`API_KEY_EXPIRY_INVALID`). The list shows when each key expires.

- **Example**: Ada picks Custom date and November 20 → the key works until then, and the list
  says so.

## Seeing and ending keys

### APIKEY-R8 · Admins see and end every key made here; members see the keys made for them

Everyone sees their own keys. An Owner or Admin also sees every key bound to the organization;
a member sees the keys made for them here. A key bound to an organization is ended at that
organization's door, never through a person's own key settings (`API_KEY_ORGANIZATION_MANAGED`),
and the audit log names who made and who ended it.

- **Example**: Mia opens Settings > API > REST → she sees her own keys and "Billing sync", and
  can end it; she does not see the Finance team's key.

## Whose limits a key's spend counts toward

### APIKEY-R9 · A key that is not a person spends under its own name

No personal, role or default limit applies to it. The organization's limits and the limits set
for the key itself do, and a team's key counts toward, and is held to, its team's limit. On the
usage page its spend is a row of its own, never an active user.

- **Example**: The Finance team's key spends 30 → the Finance team's total grows by 30, and no
  member's own total changes.

## Not yet

- **A project's own limit**: a project's key is held to the organization's limits and to its own
  key limits; there is no limit for everything one project spends.
- **Renaming a key, or changing its role or expiry** after it is made: make a new key and end the
  old one.
- **The live-schema proof**: the binding table's constraints and the cascades are proven against
  Postgres by the `backend:integration` check, not by a test named here.
