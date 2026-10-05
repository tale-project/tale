# Conversations — who can read and answer the shared Inbox, and what a reply guarantees

> **Prefix** `CONV-` · **Suite** [`conversations`](../../../tests/manual/suites/conversations.md)

A conversation is a thread with someone outside the organization: an email exchange synced
from a connected mailbox, or a thread that another system mirrors in over the REST API. The
members of the organization work these threads in the shared Inbox. These rules cover who can
read a conversation, who can change and assign one, what the chat assistant finds, how an
incoming email reaches its conversation and its contact, how routing assigns a new
conversation, what sending a reply guarantees, what marking as spam and deleting do, and what
a mirrored conversation can do. The mailbox sync itself, Inbox triage, the delivery of replies
to a mirroring system and the trash are not covered; see Not yet.

## Who can read a conversation

Reading follows assignment, not the role alone. A conversation can be assigned to a person, to
a team, or to both.

| The conversation is assigned to | Who can read it |
| --- | --- |
| nobody | owners and admins |
| a person | that person, and owners and admins |
| a team | the members of that team, and owners and admins |
| a person and a team | that person, the members of that team, and owners and admins |

### CONV-R1 · You can read a conversation assigned to you or to a team you are in

Owners and admins read every conversation, and a conversation assigned to nobody stays with
them. For everyone else, a conversation they cannot read is not in the Inbox list and not in
its counts, and opening it by its link answers as if it did not exist
(`conversation_not_found`).

- **Example**: A conversation is assigned to the Support team. Mia is in Support and Noah is
  not. Each of them opens its link → Mia reads it, and Noah is told it was not found.
- **Example**: A new conversation is assigned to nobody. Mia opens the Inbox → it is not
  listed and not counted for her. Ada, an admin, sees it.

### CONV-R2 · The chat assistant finds only conversations the person asking can read

The assistant can search conversations by subject, by contact name and by the text of their
messages, and it can list them. `CONV-R1` is applied to every match for the person who is
asking: a match they cannot read is left out, and nothing in the answer says that something
was left out. Someone who is not an active member of the organization gets nothing. A match
gives the assistant the subject, the status, the channel, the time of the last message and
who it is assigned to, never the contact.

The search is bounded. It looks at the 300 most recently active conversations of the
organization and, for message text, at the organization's 400 newest messages; an older
match is not found. An answer cut short by one of these two limits is marked as partial.

- **Example**: A conversation about a refund is assigned to Noah. Mia asks the assistant what
  happened with the refund → the assistant finds no conversation, and nothing tells Mia that
  one was withheld.
- **Example**: Zoe is an admin of another organization and asks her assistant about refunds →
  no conversation of this organization is found.
- **Example**: The only conversation assigned to Mia is older than the 300 most recently
  active ones of the organization. She asks about it → it is not found, and the answer is
  marked as partial.

## Who can change a conversation

| | Owner, admin | Developer, editor | Member |
| --- | --- | --- | --- |
| Reply, close, reopen, mark as spam, archive, delete | yes | in the conversations they can read | no |
| Start a new email | yes | yes | no |
| Assign to a person or a team | yes | no | no |

### CONV-R3 · Editors and higher roles can change the conversations they can read

Changing covers replying, starting a new email, adding a message by hand, marking as read,
closing, reopening, marking as spam, archiving, deleting, and undoing, retrying or discarding
a send. Someone with the member role can read the conversations assigned to them and change
none (`FORBIDDEN`). An API key is held to the same role when it mirrors conversations over
the REST API (`ROLE_FORBIDDEN`).

The role is not enough on its own: the conversation must be one the person can read
(`CONV-R1`). A change to any other conversation answers as if it did not exist
(`conversation_not_found`), and nothing happens. A bulk action carries out the rest and
reports that conversation as failed.

- **Example**: A conversation is assigned to Mia, who has the member role. She writes a reply
  and sends it → refused (`FORBIDDEN`), and nothing is sent.
- **Example**: Noah is an editor. He closes a conversation that is assigned to a team he is
  not in → he is told it was not found, and it stays open.

### CONV-R4 · Only owners and admins can assign a conversation

They assign it to a person, to a team or to both, and clear either one. Anyone else is
refused (`FORBIDDEN`), an editor included. The person must be an active member of the
organization (`user_not_in_org`) and the team one of its teams (`team_not_in_org`); otherwise
nothing is saved. Over the REST API a mirrored conversation can be given a team, not a
person, and only with an owner's or admin's key (`ROLE_FORBIDDEN`); a team of another
organization is refused there as `TEAM_NOT_IN_ORG`.

A new email is the one exception: the conversation it starts is assigned to its sender. An
owner or admin can name another person or a team for it; the same choice by anyone else is
ignored.

- **Example**: Noah, an editor, assigns an unassigned conversation to himself → refused
  (`FORBIDDEN`), and it stays unassigned.
- **Example**: Ada assigns a conversation to a colleague whose membership was disabled →
  refused (`user_not_in_org`), and the conversation keeps the assignee it had.
- **Example**: Noah starts a new email to a customer → the new conversation is assigned to
  Noah.

## Incoming email

A sync reads each connected mailbox and files what it finds: into the conversation an email
belongs to, or into a new one.

### CONV-R5 · A reply joins the conversation of the email it answers

An email that answers another one names it. It joins the conversation that holds the email it
names; when that email is not stored, the earlier emails of the thread that it lists are
tried as well. An email that names nothing it answers starts a new conversation, even when it
lists earlier emails: newsletters and invitations fill that list with unrelated mail.

- **Example**: A customer answers the reply Noah sent yesterday → her email appears in the
  same conversation.
- **Example**: A newsletter arrives that answers no email and lists an old invitation among
  its earlier emails → it becomes a conversation of its own.

### CONV-R6 · An email is stored once, however often its mailbox is read

Emails of one organization are told apart by the ID the sending mail server gave them (the
Message-ID). Reading an email that is already stored updates that message. When two runs of
the sync read the same new email at the same moment, the second one finds the message the
first one stored: there is one message, and neither run fails.

- **Example**: Two runs of the sync overlap and both read this morning's email from a
  customer → the email is in its conversation once.

### CONV-R7 · The contact of a conversation is the other party, never the mailbox itself

The sync tells a mailbox's own email from everyone else's by the mailbox's address. An email
from another address is incoming, and its sender is the contact. An email the mailbox sent is
outgoing, and its recipient is the contact. The same holds for every later email of the
conversation: the mailbox's own are outgoing, the other party's incoming. A contact that is
created this way is recorded as coming from a conversation. The rule needs the mailbox's
address to be known; see Not yet.

- **Example**: A customer writes to the support mailbox for the first time → a new
  conversation with the customer as its contact, and her email in it as incoming.
- **Example**: Noah answers her from his mail program instead of the Inbox, and the sync
  picks his answer up → it joins the conversation as an outgoing message, and the customer
  stays the contact.

## Routing

A routing rule names where a conversation arrives and who it goes to: a team, a person or
both. For an email, the rules are tried in this order and the first one that matches assigns
it:

| Order | A rule for |
| --- | --- |
| 1 | one mailbox and the exact address the email was sent to |
| 2 | one mailbox and that address without its tag (`support+billing@` counts as `support@`) |
| 3 | any mailbox and the exact address |
| 4 | any mailbox and the address without its tag |
| 5 | one mailbox, whatever the address |

### CONV-R8 · A new incoming conversation is assigned by the most specific routing rule

Between two rules of the same kind, the one listed first wins. Addresses match whatever
their capitalization. A conversation mirrored over the REST API is routed only by a rule for
the app that mirrors it. A rule that names neither a team nor a person is skipped, and
switching routing off stops every rule.

Routing only fills an empty assignment: a conversation that already has a person or a team is
left alone. A rule that names a team the organization does not have assigns nothing, the
person it names included, and the conversation arrives unassigned instead of failing.

- **Example**: One rule sends `support@acme.example` to the Support team and another sends
  `support+billing@acme.example` to the Billing team. A customer writes to
  `support+billing@acme.example` → the conversation goes to Billing. Another writes to
  `support+returns@acme.example` → that one goes to Support.
- **Example**: A conversation is assigned to Noah. The customer's next email in it is sent to
  an address that a rule routes to the Sales team → the conversation stays with Noah.
- **Example**: A rule names a team that is not one of the organization's teams → the next
  email it matches arrives as a conversation assigned to nobody.

## Sending a reply

### CONV-R9 · A reply waits 10 seconds, and can be undone until it starts to send

Undoing a reply in that time removes the message, sends nothing, and gives its text and its
attached files back to the person. Once sending has started, undo is refused
(`undo_window_closed`) and the message stays in the conversation. The two never both happen:
a reply is either undone or sent.

- **Example**: Noah sends a reply and notices a wrong price three seconds later. He undoes it
  → the customer receives nothing, and the reply is back in his editor with its attachment.
- **Example**: Noah undoes a reply at the moment it has started to send → refused, and the
  reply is sent.

### CONV-R10 · A queued email is handed to the mail provider at most once

Before an email goes out, the send takes the queued message for itself. An attempt that finds
the message already taken, already sent or undone sends nothing, so a send that is started
twice reaches the mail provider once. A send that was interrupted before it finished is not
sent again on its own: it is marked as failed, and a person retries or discards it.

- **Example**: The job that sends Noah's reply is started twice by mistake → the customer
  gets one email.
- **Example**: The server restarts in the middle of sending a reply → after a while the reply
  shows as failed, and Noah decides whether to retry it.

### CONV-R11 · You can attach only files you uploaded yourself, within the email's limits

Every file on a reply or on a new email must be an upload of the person who sends it. Any
other file is refused (`ATTACHMENT_NOT_OWNED`). An email carries at most 10 files
(`CONVERSATION_ATTACHMENTS_TOO_MANY`) and 200 MB in all
(`CONVERSATION_ATTACHMENTS_TOTAL_SIZE_EXCEEDED`). One file can be up to 100 MB, and an audio
or video file as large as the total allows (`CONVERSATION_ATTACHMENT_TOO_LARGE`). Its type
must be one that chat accepts as an attachment (`CONVERSATION_ATTACHMENT_TYPE_INVALID`). An
email refused for one of these reasons is not queued, and nothing is sent.

- **Example**: Noah's reply names a file that a colleague uploaded → refused
  (`ATTACHMENT_NOT_OWNED`), and nothing is sent.
- **Example**: Noah attaches 11 files to a new email → refused
  (`CONVERSATION_ATTACHMENTS_TOO_MANY`), and no conversation is created.

### CONV-R12 · Sending a reply settles the drafted reply waiting on the conversation

An automation can leave a drafted reply on a conversation for a person to use. A draft holds
1 to 25,000 characters after trimming spaces; an empty one (`draft_empty`) and a longer one
(`draft_too_long`) are refused. When a person sends a reply in that conversation, the waiting
draft is marked as completed in the same step: by whom, when, and with what was actually
sent, beside what was drafted. With no draft waiting, sending changes nothing else.

- **Example**: An automation drafts an answer to a customer's question. Noah rewrites half of
  it and sends it → the draft is recorded as completed by Noah, with the text he sent.

## Spam and deleted conversations

Who finds an email in search is a rule of the knowledge domain (`KNOW-R5`). This one says
what marking and deleting do to a conversation's emails there.

### CONV-R13 · Marking as spam, or deleting, takes a conversation's emails out of search

Marking a conversation as spam takes the text of its emails, and the files that were attached
to them, out of search with the mark. An email that arrives in it afterwards is not added.
Reopening it has them indexed again. Closing a conversation changes nothing in search.
Deleting a conversation removes it for good, not to the trash, and takes its emails and their
attached files out of search in the same step.

- **Example**: Noah marks a conversation as spam by mistake and reopens it → its emails are
  indexed for search again.
- **Example**: Ada deletes a conversation → it is gone from the Inbox for good, and its
  emails are taken out of search.

## Conversations mirrored over the REST API

Another system can mirror its own conversations into the Inbox with an API key: it sends each
conversation as a whole, with a version number, and sends it again when it changes. Over the
API a mirror can be sent, listed, closed and given a team (`CONV-R4`). Its messages cannot be
read back; see Not yet.

### CONV-R14 · Only the API key user that mirrored a conversation can change its mirror

A mirrored conversation belongs to the user whose API key first sent it. When another key
user of the same organization sends that conversation again, closes it or assigns it, the
call is refused (`INTEGRATION_NOT_OWNED`) and nothing changes. A key user's list of mirrors
holds only their own.

- **Example**: Two integrations of one organization run under two service users. The second
  one sends a new version of a conversation that the first one mirrored → refused, and the
  conversation is unchanged.

### CONV-R15 · A mirror its source closed keeps its messages and takes no new content

A source closes its mirror by sending it as deleted. The conversation is closed in the Inbox
and keeps every message it had. From then on a version with content is refused
(`CONVERSATION_CLOSED`) and does not reopen it; to mirror that conversation again, the source
sends it under a new ID. The mirror's state, read back over the API, says that its source
closed it.

- **Example**: A helpdesk deletes a ticket and closes its mirror. A week later the helpdesk
  sends the same ticket again with one more message → refused, and the conversation stays
  closed with the messages it had.

## Limits

| What | Limit | Rule |
| --- | --- | --- |
| Conversations in one bulk action | 200 in one request | `CONV-R16` |
| Files on one email | 10 files, 200 MB in all | `CONV-R11` |
| One file on an email | 100 MB; audio and video up to the total | `CONV-R11` |
| A drafted reply | 1 to 25,000 characters, after trimming spaces | `CONV-R12` |
| The wait before a reply is sent | 10 seconds | `CONV-R9` |
| What the chat assistant's search looks at | the 300 most recently active conversations, the 400 newest messages | `CONV-R2` |

### CONV-R16 · A bulk action takes at most 200 conversations in one request

This holds for closing, reopening, marking as spam, archiving and unarchiving in bulk. A
longer list is refused as a whole, before any conversation is read or changed. A larger
selection has to be sent in parts.

- **Example**: A request names 201 conversations to close → refused, and none of them is
  closed.

## Not yet

- **The mailbox sync**: which folders a run reads, where the next run resumes, what one
  failing mailbox does to the others, and how attachments are stored
  (`backend/core/conversations/sync_mailbox.ts`, and `materialize_email_attachments.ts`,
  `reuse_stored_attachments.ts` and `bind_email_attachments.ts` under
  `backend/core/conversations/ingest/`).
- **The mailbox's own address** behind `CONV-R7`: how the sync learns it
  (`resolve_connector_account_email.ts` under `backend/core/conversations/ingest/`), and
  which direction an email gets while it is not known (`create_conversation_from_email.ts`
  and `create_conversation_from_sent_email.ts` there). No test holds the second part.
- **Which conversations are routed** (`CONV-R8`): one that starts with an incoming email and
  a new mirror are; one that the mailbox itself started is not, and arrives unassigned
  (`shim.ts`, `api-sync.ts`). The code keeps it; no test holds it.
- **Which mailbox a reply leaves from** when a connector has several, and the Inbox's mailbox
  filter (`thread-mailbox.ts`).
- **Inbox triage and the AI rewrite of a draft** (`triage.ts`, `improve.ts`).
- **Unread counts, the order of messages, and who closed a conversation and when**
  (`service.ts`).
- **A failed send, and an email of files alone**: what marks a send as failed, retrying or
  discarding it, and sending an email that has attachments and no text (`send.ts`,
  `routes.ts`).
- **The delivery of Inbox replies to a mirroring system**: that a reply to a mirrored
  conversation is queued for its source instead of being emailed, claiming, acknowledging
  and failing a delivery, the source's own limits on a reply, and when a delivery is given
  up (`api-sync.ts`, `backend/rest/v1-conversations.ts`).
- **A mirror's versions**: what a repeated or an older version does, a version that
  contradicts a stored one, and that a mirror takes no more content while its contact is in
  the trash (`api-sync.ts`). Only the integration lane proves these
  (`api-sync.integration.ts`), which the guard does not read, so they are not rules here.
- **A drafted reply sends nothing by itself, and a conversation holds one waiting draft at a
  time** (`draft.ts`). Only the integration lane proves both.
- **A legal hold refuses the delete of a conversation** (`deleteConversation` in
  `service.ts`). The code keeps it; no test of this domain holds it.
- **Length limits of a reply's text and subject, and the bulk reply door with its limit of 50
  conversations** (`routes.ts`, `bulkReplyToConversations` in `send.ts`). No test holds them,
  and the Inbox does not use that door.
- **Conversations in the trash**: nothing in this domain moves a conversation there, since
  deleting is permanent (`CONV-R13`). A conversation reaches the trash only when the
  retention policy expires it, and is restored from there
  (`backend/domains/retention/service.ts`, `backend/domains/governance/trash.ts`).
- **Undecided: does a conversation that the retention policy expired still show in the
  Inbox?** Search and the list of email attachments treat it as gone (`KNOW-R5`, `FMETA-R5`),
  and the Trash page of the user docs tells an admin to look for a restored record "in its
  original location" (`docs/en/platform/admin/governance/trash.md`), as if it were not
  there while it is expired. The Inbox list, its counts and the read of one conversation
  apply no such filter (`listConversationsPage`, `countConversationsByStatus` and
  `loadVisibleConversation` in `service.ts`), so an expired conversation is still listed,
  opened and answered, and no test covers it either way. One of the two is the intended
  rule.
- **Unreadable matches can empty a member's search.** Beside the two limits in `CONV-R2`, the
  search stops at 50 conversations matched by message text and at 25 matched contacts before
  `CONV-R1` is applied, and does not mark that answer as partial. The contract debt ledger
  in [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
- **A mirror cannot read its messages back.** `GET /api/v1/conversations` lists the mirrors
  of `CONV-R14` without their messages; the same ledger records it.
