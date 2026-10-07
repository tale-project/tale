# Notifications — what a notification says, where it leads, and who can export them

> **Prefix** `NOTIF-` · **Suite** [`notifications`](../../../tests/manual/suites/notifications.md)

A notification tells a person that something needs them: a task was assigned, an agent asked
a question, an account was locked. It shows in the bell, can be sent as an email, and can be
exported to another system over the API. These rules cover what a notification email carries,
where a notification's link leads, and who can export notifications. The bell itself is not
covered; see Not yet.

## Notification emails

### NOTIF-R1 · A notification email shows what people typed as text, never as markup

A task title, a name or a question that contains HTML is shown as written, in the HTML part of
the email. It is escaped once, so it does not turn into double-escaped text either, and a
value that looks like a placeholder is not filled in a second time. The plain-text part and
the subject carry the text unchanged.

- **Example**: Mia names a task `<b>Urgent</b>`. Noah is assigned to it → his email shows
  `<b>Urgent</b>` as text, not the word Urgent in bold.

### NOTIF-R2 · Every notification email carries a link to the thing it is about

Both the HTML part and the plain-text part carry it.

- **Example**: Noah gets an email that a task was assigned to him → the email has a link that
  opens that task.

## Where a notification leads

### NOTIF-R3 · A notification's link opens what it is about, in the right place

| The notification is about | Its link opens |
| --- | --- |
| a task | the task inside its project |
| a chat thread | the thread |
| a conversation | the conversation, in the list its status puts it in |
| a document in a project | the project's **Files** tab, in the document's folder |
| a document in the library | the organization's document list |
| a request for credits | the budget rules |
| a run with no task and no project | the run |
| nothing in particular | the organization's dashboard |

The link starts with the deployment's own address, including the path it is served under.

- **Example**: An agent asks Noah a question on a task → the link in his notification opens
  that task in its project.

## Exporting notifications

A service can read a person's notifications over the API to show them in another system.

### NOTIF-R4 · Only owners, admins and holders of the export right can export notifications

A member, an editor or a developer without the right is refused (`ROLE_FORBIDDEN`) before any
member's data is read. An admin can grant the right to a member, with or without an end date.
A grant that has ended or was withdrawn, and a grant in another organization, count for
nothing. A disabled seat can never export, whatever it holds.

- **Example**: An integration's account is a member with the export right that ended last
  week → refused.

### NOTIF-R5 · An export shows a person only what that person could see in the app

Notifications for the organization as a whole, and security notifications, are exported for a
recipient according to the recipient's role, not the exporting account's. A recipient who
cannot be matched to exactly one verified member gets nothing.

- **Example**: An integration exports notifications for Mia, a member → security notifications
  meant for admins are not among them.

## Not yet

- **The bell**: listing, the unread count and marking as read, and that a member never sees a
  security notification there (`routes.ts`, `service.ts`). No test holds these yet.
- **Which events notify whom**: decided by the domains that raise them.
- **The wording of each notification** in each language (`core/notifications/`).
- **Notifications over the API are not typed and are not pushed**: the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
