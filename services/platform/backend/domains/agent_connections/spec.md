# Agent connections — who sees a coding agent's connection, and how it ends

> **Prefix** `AGCONN-`

A person can connect a coding agent to an organization by signing in from the agent on Tale's
MCP endpoint. The organization keeps one record of each connection: who connected which app, with
which access, and when and why it ended; the endpoint's own count of calls says when it was last used.
These rules cover who may connect an agent and with which access, who sees a connection and who ends
it, what ending one takes away, what ends one without anyone asking, and whether the access token the
agent then presents opens the endpoint. What the consent page looks like is left to Not yet.

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

Allowing an agent to edit, deploy, change settings or connect a subscription takes a session that
began within the last day (`SESSION_NOT_FRESH`); the person confirms their password first. Reading
and testing, and reading settings, do not.

- **Example**: Ada signed in two days ago and picks "Edit" → she confirms her password first. Picking
  "Read and test" needs nothing more.

### AGCONN-R10 · The connection is recorded before the agent's code is handed over

When the person allows an agent, the connection is recorded first, for the organization they chose,
with the app, where it came from, the access allowed and the host Tale sends them back to. If it cannot
be recorded, the agent gets no code and the person is told to try again
(`AGENT_CONNECTION_UNAVAILABLE`).

- **Example**: Ada allows Claude Code while the database is unreachable → she is told to try again, and
  Claude Code never receives a code to sign in with.

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

## Not yet

- What the consent page shows and how it reads is not covered yet.
- A password change or reset, an admin's sign-out of every session, and an account's deletion should
  disconnect the person's agents too; only leaving an organization does today.
- A refresh token that is used twice, which should disconnect the agent and tell the person, is not
  handled yet.
- The daily clean-up of old connections and of apps nobody connected is not covered yet.
