# Agent connections — who sees a coding agent's connection, and how it ends

> **Prefix** `AGCONN-`

A person can connect a coding agent to an organization by signing in from the agent on Tale's
MCP endpoint. The organization keeps one record of each connection: who connected which app, with
which access, and when and why it ended; the endpoint's own count of calls says when it was last used.
These rules cover who may connect an agent and with which access, who sees a connection and who ends
it, what ending one takes away, what ends one without anyone asking, and whether the access token the
agent then presents opens the endpoint, and what the page of connected agents in Settings shows and
does.

## Connecting an agent

|                                            | Owner, admin or developer | Member with a key-using competence | Any other member |
| ------------------------------------------ | ------------------------- | ---------------------------------- | ---------------- |
| Connect an agent to this organization      | yes                       | yes                                | no               |
| Allow "Edit" and "Edit and deploy"         | yes                       | no                                 | no               |
| Allow reading, testing and reading settings | yes                       | yes                                | no               |

### AGCONN-R7 · A person connects an agent only to an organization they may hold an API key in

Connecting an agent takes what holding a personal API key takes, read for that one organization: the
Owner, Admin or Developer role there, or a live competence there whose door is reached with a key.
The person chooses the organization on the consent page (`AGENT_CONSENT_ORG_REQUIRED`), must be an
active member of it (`ORG_FORBIDDEN`) and may connect an agent there (`AGENT_CONNECT_FORBIDDEN`); an
unverified address or a two-factor enrollment that is due refuses it too (`IDENTITY_NOT_ELIGIBLE`).
Another organization's role or competence never counts.

- **Example**: Noah is a member of Acme with no such competence, and a developer at Beta. He connects
  Cursor to Acme → refused. He connects it to Beta → connected.

### AGCONN-R8 · A connection never gets more access than the person's role allows

The consent offers only the access the role allows in that organization, and an agent is always
allowed to read and test. Asking to allow more than the role allows is refused
(`AGENT_SCOPE_NOT_ALLOWED`, naming it), and so is allowing access that leaves out reading and
testing (`AGENT_SCOPE_MCP_REQUIRED`). Staying signed in is not a choice: an agent that asked for it
keeps it.

- **Example**: Mia, a member, asks to let Claude Code edit automations → refused, naming the edit
  access. She allows reading and settings reading → connected.

### AGCONN-R9 · Access beyond reading needs a sign-in from the last day

Allowing an agent to edit, deploy or change settings takes a session that began within the last day
(`SESSION_NOT_FRESH`); the person confirms their password first. Reading and testing, and reading
settings, do not.

- **Example**: Ada signed in two days ago and picks "Edit" → she confirms her password first. Picking
  "Read and test" needs nothing more.

### AGCONN-R10 · The connection is recorded before the agent's code is handed over

When the person allows an agent, the connection is recorded first, for the organization they chose,
with the app, where it came from, the access allowed and the host Tale sends them back to. If it cannot
be recorded, the agent gets no code and the person is told to try again
(`AGENT_CONNECTION_UNAVAILABLE`).

- **Example**: Ada allows Claude Code while the database is unreachable → she is told to try again, and
  Claude Code never receives a code to sign in with.

### AGCONN-R25 · An agent that asks for more than the endpoint grants is given what it grants

A coding agent that asks to sign in, or to register, for every scope the sign-in server lists is not
refused: Codex asks for `openid`, `profile`, `email` and `tale:organization` beside the agent scopes
and `offline_access`. Tale takes what the endpoint grants — the agent scopes a tool of the endpoint
takes, and `offline_access` — and leaves the rest out, so the consent page offers exactly those, the
connection holds only those and the token says which. An agent is never granted an identity scope, nor
`tale:subscriptions.connect` while no tool takes it; asking for it is no error. An agent that asks for
nothing the endpoint grants — identity scopes alone — is refused with `invalid_scope`, not given the
agent scopes in their place.

- **Example**: Codex asks for `openid profile email tale:organization offline_access tale:mcp
  tale:automations.write` → the consent page offers Read and test or Edit automations, Ada allows Edit
  automations, and the token's scope is `tale:mcp tale:automations.write offline_access`; no `id_token`.
- **Example**: Claude Code asks for every agent scope and `offline_access` → the consent page offers
  the three levels, Read settings and Change settings, and Ada allows them all; the connection and the
  token hold everything but `tale:subscriptions.connect`.

## Who sees and ends a connection

|                                                       | The person who connected it | Owner or admin | Anyone else |
| ----------------------------------------------------- | --------------------------- | -------------- | ----------- |
| See it in the organization's list                     | yes                         | yes            | no          |
| See everyone's, and the ended ones                    | —                           | yes            | no          |
| Disconnect it                                         | yes                         | yes            | no          |

### AGCONN-R1 · A person sees their own connections; owners and admins can see everyone's

The list a person opens shows the connections they made in this organization, each with when its
agent last called — the endpoint's own count of the calls it answered with that connection, never
something the agent says, and nothing before the first call. An owner or admin can ask for everyone's,
and for the ones that ended; anyone else who asks gets their own, and the live ones only.

- **Example**: Ada, a developer, opens the list and asks for everyone's → she sees her two agents.
  Olav, the owner, asks the same → he sees Ada's, Mia's and his own, and can add the disconnected ones.
- **Example**: Ada's agent called an hour ago, and Mia connected hers this morning without a call yet →
  Olav's list says "an hour ago" for Ada's and nothing for Mia's.

### AGCONN-R2 · A person or an admin disconnects an agent; for anyone else it does not exist

A person ends their own connection. An owner or admin ends anyone's in their organization. A
connection that belongs to someone else, to another organization, or that already ended answers
"not found" (`AGENT_CONNECTION_NOT_FOUND`), never "forbidden": the answer reveals nothing of what
the caller may not see.

- **Example**: Mia, a member, disconnects Ada's agent → not found, and Ada's agent stays connected.
  Olav disconnects it → it ends, recorded as an admin's doing.

### AGCONN-R3 · Disconnecting ends the agent's sign-in for this organization only

Ending a connection removes the consent the person gave and every refresh token the app holds for
them in this organization, so the agent cannot sign itself in again. The same app connected to
another organization by the same person stays as it is.

- **Example**: Ada connected Claude Code to Acme and to Beta. She disconnects it from Acme → Acme's
  consent and tokens are gone, and Beta's are untouched.

### AGCONN-R4 · Leaving the organization disconnects every agent of that person there

When a member is removed or de-provisioned, the agents they connected to that organization end with
the seat, recorded as the platform's doing. Their agents in other organizations stay.

- **Example**: Noah is removed from Acme → his Cursor connection to Acme ends. His connection to Beta
  stays.

### AGCONN-R5 · Every connect, access change and disconnect writes an audit row

The audit log records who connected which app and with which access, any later change of that
access (before and after), and every disconnect with who ended it and why: the person, an admin, or
the platform, with the reason.

- **Example**: Ada connects Claude Code with "Edit", later allows "Edit and deploy", then Olav
  disconnects it → three rows: connected, access changed, disconnected by an admin.

### AGCONN-R6 · Allowing an app again changes its access; it never adds a second connection

When a person allows an app that is already connected to this organization, the same connection takes
the access they allow now, rather than a second connection appearing. Two consents at once leave one.
An app that was disconnected and is allowed again makes a new connection.

- **Example**: Ada allows Claude Code to read, then allows it to edit → one connection, now with edit
  access. She disconnects it and allows it again → a new connection, and the old one stays in the
  history an admin can read.

## Using a connection

The MCP endpoint takes a coding agent's access token in place of an API key, once the operator lets
agents sign in. What a call may do with the access the token carries is the [MCP spec](../mcp/spec.md)
(MCP-R40–R42); these rules cover whether the token opens the endpoint at all.

### AGCONN-R15 · A token opens the endpoint only if this server issued it for this endpoint

The endpoint proves the token itself, asking the sign-in server nothing: its signature against the
keys the server publishes (RS256 only), its issuer, its audience — the MCP endpoint, on an address the
deployment answers on —, its type, and that it has not run out. A token made by anyone else, for another
endpoint, of another type, signed another way (no signature, a shared secret) or bound to a key of the
agent's is refused. If the keys cannot be fetched, the endpoint is unavailable; the token is not
called wrong.

- **Example**: A token signed by an unknown key, one meant for another site's endpoint and one with no
  signature at all → each refused with 401. The sign-in server's own token for Acme's endpoint → opens it.

### AGCONN-R11 · A token works only while its connection lives and its person keeps a seat

On every call the endpoint reads the connection the token was issued under: it must not have ended,
must have been made no later than the token (a token from before a disconnect belongs to the earlier
connection of the same app), and its person must still have a seat in that organization, which was not
switched off. The call acts as that person with the role they have now, not the one in the token. The
access it may use is what the token carries and the connection still holds.

- **Example**: Ada disconnects Cursor while its token has four minutes left → Cursor's next call is
  refused with 401, and its refresh no longer works. Olav demotes Ada from admin to member → her
  agent's next call acts as a member.

### AGCONN-R12 · A connection works in the organization it was made for, and in no other

A call acts in the organization of the connection, whichever organizations its person belongs to. A
call that names another organization is refused with 403 `ORG_MISMATCH`, which names the organization
the connection is for and nothing of what was asked; naming the right one, in any case, is fine. A
person who wants an agent in two organizations connects it to each.

- **Example**: Noah belongs to Acme and Beta and connected Cursor to Acme. A call that names Beta →
  403 `ORG_MISMATCH` naming Acme. A call that names Acme, or none → acts in Acme.

### AGCONN-R13 · Only the MCP endpoint takes an agent's token

On every other route a value of that shape is read as the API key it can only be, and refused as one.
While the operator keeps agents out, the MCP endpoint reads it the same way.

- **Example**: Cursor presents its token at the automations list → 401 "Invalid API key". The operator
  has not let agents in, and Cursor presents it at the MCP endpoint → the same.

### AGCONN-R14 · A refusal on the endpoint tells an agent where to sign in

When agents may sign in, every 401 on the MCP endpoint carries a challenge that names where the
endpoint's metadata is and which scopes to ask for, and says `invalid_token` when a credential was
presented and refused. A token that has merely run out is refused without counting against its source,
since refreshing is what an agent does next; a token that was never good counts, like a wrong key. The
challenge holds nothing a caller wrote.

- **Example**: A request with no credentials → 401 naming the metadata address and the scopes. A token
  that ran out → 401 `invalid_token` saying so, not counted against its source. A token no one issued
  → 401, counted, and 429 once the source has failed too often.

## Keeping connections honest

### AGCONN-R16 · A refresh token used twice disconnects the agent everywhere

When an agent presents a refresh token it already used — outside the few seconds in which a retried
refresh is answered with the same result — the sign-in server ends the whole sign-in of that app for
the person, and so does Tale: every connection of that person and app, in every organization, ends as
the platform's act with the reason "refresh reuse", with its consent and tokens. A refresh that fails
for any other reason ends nothing.

- **Example**: Ada connected Claude Code to Acme and to Beta. A copy of its refresh token from last
  week is presented → both connections end. A retry two seconds after a refresh gets the same answer
  again and ends nothing.

### AGCONN-R17 · A new password or a removed sign-in method disconnects every agent

When a person changes their own password (replacing an expired or admin-set one included), when an
admin sets it for them, or when an admin removes their passkey or resets their two-factor sign-in,
every agent they connected, in every organization, ends for account security beside the sessions that
already end: as the platform's act when the person changed their own password, as the admin's when an
admin did it. A change that was refused ends nothing.

- **Example**: Olav resets Mia's two-factor sign-in because her phone was stolen → Mia's sessions end,
  and so do the agents she connected to Acme and to Beta, with Olav named in the trail.

### AGCONN-R18 · Erasing a person deletes their connections in that organization

A data-subject erasure in an organization deletes the person's connections there — the live ones with
their consent and tokens, and the ended ones that are history — and keeps nothing of them but the
audit rows, which lose their personal data like every other. Their connections in other organizations
stay.

- **Example**: Noah's erasure in Acme → his Cursor connection to Acme is gone, with its consent and
  tokens; his connection to Beta stays, and the audit rows in Acme no longer say who he was.

### AGCONN-R19 · Old connections and unused apps are cleaned up every day

A connection that ended is removed 90 days later; the audit log keeps its trace. An app that
registered itself, or identified itself by a document, and that nobody connected is removed a day
after it appeared, with its consent and tokens. An app with a live connection or a refresh token that
still works is never removed, and neither is an organization's own sign-in application. Refresh and
access tokens that expired or were retired a month ago go too.

- **Example**: A connection ended on 1 July → on 30 September it is gone from the history an admin
  reads. An app that registered on Monday and nobody connected → gone on Wednesday. Cursor, which Ada
  connected, stays.

### AGCONN-R20 · A disconnect the person did not make is told to them

When an agent a person connected is disconnected by a refresh token that was used twice, by a change
of their password or sign-in method, or by an owner or admin, the person finds a notice in their bell,
in the organization the connection was to, saying which agent was disconnected and why — an admin by
name. A person who disconnects an agent themselves, leaving an organization and an erasure leave no
notice. It is never e-mailed and never shown to anyone else, and one that cannot be written does not
undo the disconnect. The notice opens the person's connected agents.

- **Example**: Ada connected Claude Code to Acme and to Beta, and a copy of its refresh token is
  used → the bell of Acme and the bell of Beta each say that Claude Code was disconnected because an
  old sign-in was reused. Olav disconnects Ada's Claude Code in Acme → Ada's bell there says Olav did.
  Ada disconnects it herself → she finds nothing.

### AGCONN-R21 · The consent page is told only what the gate would accept

Before the consent page of a coding agent shows its choices, the server tells it who the app is — its
name made safe to show, and whether it proved who it is by its own domain or only registered itself —,
which of the scopes the app asked for a connection can hold, and, for each organization the person
belongs to, whether they may connect an agent there, the most their role lets them allow and what they
allowed this app there before. These are the rules the consent gate applies when they choose, so the
page never offers what the gate would refuse. An account that may not sign in to an organization yet is
told so; an app the server does not know and a request that asks for no agent access are refused; a
sign-in that belongs to one organization is refused, as it may not connect an agent anywhere.

- **Example**: Ada is a Developer in Acme, a Member in Beta and has a switched-off seat in Zed, and
  Claude Code asks for edit access → Acme is offered with everything a Developer may allow and what she
  allowed before, Beta and Zed are listed as places she may not connect an agent, and none is chosen for
  her.

### AGCONN-R22 · The consent page offers what the gate accepts, and keeps the person's choice

The consent page of a coding agent says who is asking, lets the person choose the organization the
agent will work in and how much access to give, and says what that comes to. It offers only what the
app asked for and the person's role there allows, and says why for the rest. It starts on the
organization they are working in, and on what they chose there before; for an app that asks for
everything, on editing; for an app that asks for less, on what it asked for, held to their role.
Connecting sends the signed request as it came, with the organization and the access chosen. When
more than reading and reading settings is chosen and the sign-in is more than a day old, the page asks
for the password first (or sends an account without one to sign in again), and what was chosen is
still chosen on the page that follows.

- **Example**: Ada opens Claude Code's request. It asks for everything and her role in Acme is
  Developer, so Edit automations is chosen; she picks Edit and deploy while her sign-in is two days old
  → the page asks for her password, and after she gives it the page opens again with Edit and deploy
  still chosen. In Beta, where she is a plain member, Edit and deploy is unavailable and says her role
  does not allow it.

## The page in Settings

### AGCONN-R23 · Settings opens the connected agents to those who work with them

Settings › API › Connected agents exists once the deployment lets coding agents sign in. It opens for
whoever may connect an agent in this organization — an Owner, Admin or Developer, or a member with a
competence for it — and, whatever the deployment says, for a member who still holds a live connection
here, so they can see and disconnect theirs. The server answers those facts for the person asking, in
the organization they are in: another organization's connection, an ended one and another person's
never count. Anyone else finds no such page in Settings, and opening its address says why. Nothing
offers a way to connect an agent while agents may not sign in.

- **Example**: Mia is a member and an Admin withdrew her competence, but Cursor is still connected for
  her → the page stays for her, lists Cursor alone and offers no way to connect another; once she
  disconnects Cursor the page closes for her. Noah is a member with no competence and no connection →
  he finds no such page. A deployment that has not turned agent sign-in on shows Olav, the owner, no
  such page either, until an agent is connected.

### AGCONN-R24 · The connected agents page lists each agent and disconnects one once confirmed

The page lists the agents the person connected. An Owner or Admin can switch to everyone's, with who
connected each, and show the disconnected ones with when and why. A row names the app and where it is
from — the domain it proved, or "Unverified" for an app that chose its own name —, the access it was
given in the words the person chose it with, when it connected and when it last called, "Never" before
the first. Disconnecting asks first, in words that fit whose agent it is and say that it loses access at
once; a refusal keeps the question open with the reason. A screen shows as many columns as it holds,
so the menu that disconnects an agent is always in reach and the table never scrolls sideways.

- **Example**: Olav, the owner, opens the page and switches to everyone's → he sees Ada's Claude Code
  with her name and "Edit automations", Mia's Cursor, and his own. He disconnects Ada's agent after being
  told it is Ada's, and the row turns into "Disconnected" with the date and "by an Admin". On a phone
  the same page shows each agent's name and its menu.

## Not yet

- Connecting an agent from the page itself: the button leads to the MCP page, where the endpoint and the
  way to connect are shown. A member who may connect an agent cannot open that page, so the page offers
  them no button.
