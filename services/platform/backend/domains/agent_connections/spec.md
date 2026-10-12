# Agent connections — who sees a coding agent's connection, and how it ends

> **Prefix** `AGCONN-`

A person can connect a coding agent to an organization by signing in from the agent on Tale's
MCP endpoint. The organization keeps one record of each connection: who connected which app, with
which access, and when and why it ended; the endpoint's own count of calls says when it was last
used. These rules cover who sees a connection and who ends it, what ending one takes away, and what
ends one without anyone asking. How an agent signs in, what the consent page offers and what a call
may do with the access it was given are left to Not yet.

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

### AGCONN-R6 · An app is connected once for a person and an organization; allowing again changes its access

When a person allows an app that is already connected to this organization, the same connection takes
the access they allow now, rather than a second connection appearing. Two consents at once leave one.
An app that was disconnected and is allowed again makes a new connection.

- **Example**: Ada allows Claude Code to read, then allows it to edit → one connection, now with edit
  access. She disconnects it and allows it again → a new connection, and the old one stays in the
  history an admin can read.

## Not yet

- How an agent signs in and what the consent page offers, the organization a connection is made for
  and the access it is given, and what a call may do with that access are not covered yet.
- A password change or reset, an admin's sign-out of every session, and an account's deletion should
  disconnect the person's agents too; only leaving an organization does today.
- A refresh token that is used twice, which should disconnect the agent and tell the person, is not
  handled yet.
- The daily clean-up of old connections and of apps nobody connected is not covered yet.
