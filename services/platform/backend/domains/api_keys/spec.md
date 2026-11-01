# API keys — whose a key is, what it reaches, and whose limits its spend counts toward

> **Prefix** `APIKEY-` · **Docs** [`admin/api-keys`](../../../../../docs/en/platform/admin/api-keys.md)

An API key lets a program call Tale's REST API, its MCP server and its model endpoints. A person
can make their own key, which works wherever they are a member, unless an Owner or Admin there
has turned members' own keys off. An Owner or Admin can also make a key for another member, for
a team, for a project or for the organization itself; such a key works in that one organization
only. These rules cover who can make which key, what a key acts as and reaches, when it stops
working, who sees it, and whose limits its spend counts toward. A project's own limit, which
binds its keys too, is the governance spec's (`GOV-R14`).

## Who can make a key, and for whom

| Key for          | Who makes it                  | Acts as                              | Works in                                                       |
| ---------------- | ----------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Yourself         | anyone the create rule admits | you, with your role                  | every organization you belong to that admits members' own keys |
| Another member   | an Owner or Admin             | that member, with their role         | this organization                                              |
| A team           | an Owner or Admin             | its own identity, with a chosen role | this organization                                              |
| A project        | an Owner or Admin             | its own identity, with a chosen role | this organization                                              |
| The organization | an Owner or Admin             | its own identity, with a chosen role | this organization                                              |

### APIKEY-R1 · Only owners and admins make a key for someone or something else

Anyone may make a key of their own. A key for another member, a team, a project or the
organization is made by an Owner or Admin of that organization (`API_KEY_OWNER_FORBIDDEN`).

- **Example**: Mia, a member, opens Create API key → she can make only her own key. Ada, an
  admin, can also make one for Mia, the Finance team, the Launch project or Acme.

### APIKEY-R2 · A key made for a member acts as that member, in this organization only

The key has the member's live role and teams, and stops working when they leave or are disabled
here — or once whoever made it is no longer an Owner or Admin above them: a key never carries
more authority than its maker could hand out today, and the keys a maker made end when the maker
leaves. It authenticates as an identity of its own, so it never works in another organization the
member belongs to, not even on an image that does not know about it. The member is told the key
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
e-mail reaches and which can never be made a member (`MEMBER_ADD_FORBIDDEN`), and it keeps working
when the person who made it leaves. Its role is Member, Editor or Developer — or Admin for the
organization's key alone (`API_KEY_ROLE_FORBIDDEN`) — on every door it reaches, the MCP tools
included.

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
route is refused (`API_KEY_SCOPE_FORBIDDEN`). Through the chat assistant it reads its project's
files and tasks, and none of the organization's contacts, products, websites, inbox, knowledge
entries or hub documents. Organization-wide knowledge entries stay out of both search and
listing, including the user-keyed sandbox entry finder. The organization's key sees what its role
sees across the organization.

- **Example**: The Launch project's key calls `GET /contacts` → 403 `API_KEY_SCOPE_FORBIDDEN`.

### APIKEY-R12 · An Owner or Admin can refuse every member's own key in their organization

The switch Members' personal keys work here, on Settings > API > REST, is on until an Owner or
Admin of the organization turns it off; no one else sees or changes it. While it is off, every
member's own key, the Owner's and the Admins' included, is refused on every request that
addresses this organization, over REST, MCP and the model endpoints (`API_KEY_PERSONAL_REFUSED`).
Over REST and MCP the refusal lists the holder's organizations that still let their own keys in,
and the key keeps working there. A key made here for a member, a team, a project or the
organization, a signed-in session and a coding agent connected by sign-in keep working; a key
whose holder is not a member is refused as before (`ORG_FORBIDDEN`) and learns nothing of the
setting. While the setting cannot be read, members' own keys stay out
(`PERSONAL_KEYS_POLICY_UNAVAILABLE`, a 503 that says when to retry). The audit log records each
change with the state before and after. A member whose own keys are refused here is told so on
the page; making one stays open as before, for use in their other organizations.

- **Example**: Ada turns off Members' personal keys work here in Acme → Mia's own key, and
  Ada's, get 403 `API_KEY_PERSONAL_REFUSED` there; Mia's lists `beta` and still works in it, and
  "Billing sync" keeps working in Acme.
- **Example**: Acme's setting cannot be read → Mia's own key gets 503
  `PERSONAL_KEYS_POLICY_UNAVAILABLE` there until it can, and "Billing sync" keeps working.

## When a key stops working

### APIKEY-R7 · A key ends when it is revoked or when what it belongs to is gone

Deleting the team or the project, or removing the member, revokes its keys at once, each recorded
in the audit log by the system with the reason; the team's delete confirmation says how many keys
it ends. Deleting the organization deletes its keys with it. A revoked key, or a team's or
project's key whose team or project is gone, is refused on its next request.

- **Example**: Ada deletes the Finance team → its key is refused from the next call on, and the
  audit log records the revocation by the system.

### APIKEY-R10 · A key expires on the day its maker picks, at most a year away, or never

The choices are 7, 30, 90 or 365 days, a day picked in a calendar between tomorrow and a year
from today, or never (`API_KEY_EXPIRY_INVALID`). A picked day is the day the key stops working
where its maker is, even with a clock change in between. The calendar offers only the days on
which a lifetime of 24 hours to 365 days can end, so after a clock change the first day may be
the one after tomorrow, and a form left open is checked again when it is sent. The list shows
when each key expires.

- **Example**: Ada picks Custom date and November 20 → the key works until then, and the list
  says so.

## Seeing and ending keys

### APIKEY-R8 · Admins see every key working here and end those made here; members see theirs

Everyone sees their own keys, each one this organization blocked marked so (`APIKEY-R11`). An
Owner or Admin also sees every key bound to the organization, and a member's own keys from that
member's row in Settings > Members; a member sees the keys made for them here. A key bound to an
organization is ended at that organization's door, never through a person's own key settings
(`API_KEY_ORGANIZATION_MANAGED`), and the audit log names who made and who ended it. A member's
own key is theirs alone to end; an Owner or Admin blocks it in their organization instead
(`APIKEY-R11`), or refuses every such key there (`APIKEY-R12`).

An Owner or Admin can also list every key that works here (**All keys in this organization**,
`GET /api/app/api-keys?scope=all`). It adds each member's own key, marked as a personal key, with
its holder's name and e-mail. Such a row is read-only, since only its holder ends it, and shows no
last use: the key may have been used in another organization, and nothing records its use here
alone. A disabled or expired key, a former or disabled member's key, and a member's own key this
organization blocked (`APIKEY-R11`) are not listed, since none of them can act here; a blocked key
stays in its member's row, where the block is lifted, and the viewer's own blocked key keeps its
place and its mark. While the organization refuses its members' own keys (`APIKEY-R12`), or that
setting cannot be read, no one's own key can act here, the viewer's included: the list then adds
none of them and says why (`personalKeys`). Anyone else who asks for every key gets the keys they
see already.

- **Example**: Mia opens Settings > API > REST → she sees her own keys and "Billing sync", and
  can end it; she does not see the Finance team's key.
- **Example**: Ada, an admin, picks All keys in this organization → she also sees Mia's own key
  "Laptop", with Mia's name and e-mail; it offers no way to end it.
- **Example**: Ada turns members' personal keys off, then picks All keys in this organization →
  neither Mia's "Laptop" nor Ada's own keys are listed, and the page says that members' personal
  keys are turned off here.
- **Example**: Ada blocks Mia's "Laptop" here → All keys in this organization no longer lists it,
  while Mia's own list still shows it, marked as blocked in this organization; Ada lifts the block
  → it is listed again.

### APIKEY-R11 · An Owner or Admin blocks a member's own key in this organization alone

A person's own key works in every organization they belong to. An Owner or Admin of one of them
can block it there, from the member's row in Settings > Members: its next request against that
organization is refused (`API_KEY_BLOCKED`, which lists the organizations it still works in),
while the block does not reach the holder's other organizations and the holder keeps it. The same
roles lift the block. An Admin cannot block an Owner's key or lift its block, an Owner can do
both on anyone's, and nobody blocks their own key, which they can end
(`API_KEY_BLOCK_FORBIDDEN`). A key bound to an organization is ended, not blocked
(`API_KEY_NOT_FOUND`). Each block and each lift is one audit row naming who did it and the key by
its masked ends; the holder is told in the bell, and their own key list marks the key as blocked
in that organization. Blocking or lifting again changes nothing and records nothing. Whether an
unblocked key works here also takes this organization letting members' own keys in
(`APIKEY-R12`): while it does not, the member's row marks no key as working here, and while that
cannot be read, it marks only the blocked ones.

- **Example**: Ada, an Admin of Acme, blocks Mia's own key "CI deploy" → its next call to Acme
  is refused with `API_KEY_BLOCKED`, it still works in Beta, Mia's other organization, and Mia's
  bell says that Ada blocked it in Acme.

## Whose limits a key's spend counts toward

### APIKEY-R9 · A key that is not a person spends under its own name

No personal, role or default limit applies to it. The organization's limits and the limits set
for the key itself do, a team's key counts toward, and is held to, its team's limit, and a
project's key its project's (`GOV-R14`), whatever it calls. A limit
set for the key counts everything its identity spends, whether or not the booking names the key
(a run its REST comment started), and the key stays itself after it is revoked: the work it
started before keeps spending as the key. On the usage page its spend is a row of its own, never
an active user.

- **Example**: The Finance team's key spends 30 → the Finance team's total grows by 30, and no
  member's own total changes.

## Not yet

- **Renaming a key, or changing its role or expiry** after it is made: make a new key and end the
  old one.
- **Revoking a key, or turning members' own keys off, stops what it would start, not what it
  started**: a run in flight, a REST message already accepted or an answer already streaming
  finishes and spends as the key.
- **Where a refused key still works, on the model endpoints**: their refusal keeps the code and
  the message in the interface's own error shape but drops the list of organizations, which
  only REST and MCP return.
- **What a project's key starts in its project**: an agent run or an automation it starts there
  runs with that agent's or automation's own equipment, which may reach beyond the project.
- **A blocked holder can make a new key of their own**: the block holds for the key it names, and
  a new personal key works in the organization until it is blocked too. Refusing a person's own
  keys in an organization altogether is a rule still to come.
- **The live-schema proof**: the binding table's constraints and the cascades, and the blocks
  table, are proven against Postgres by the `backend:integration` check, not by a test named
  here.
