# Collaboration — who is told about a task, a mention or a run

> **Prefix** `COLLAB-`

When something happens that concerns a person, they get a notification of their own: a bell
entry in the app and, for some kinds, an email. These rules say who is told about a task, a
mention, a review, an agent's run and a paused schedule, and who is left out. The list of a
person's notifications and their notification settings are not covered; see Not yet.

## Notifications about a task

### COLLAB-R1 · A notification about a task goes only to someone who can open the task now

What counts is the task's project as it is at that moment. Someone who lost access since,
because the task moved or they left its team, gets no bell entry and no email, and their
earlier notifications are left as they were. A notification about no task is sent without
this check.

- **Example**: Mia was assigned a task in a Finance project and then left the Finance team.
  The task's status changes → Mia is told nothing, and the people still on the task are.

### COLLAB-R2 · An email about a task is checked again when it is sent

Someone who could open the task when the notification was written and cannot when the email
goes out gets no email.

- **Example**: A notification for Mia is waiting to be emailed. She is removed from the
  project in the meantime → the email is not sent.

## Mentions

### COLLAB-R3 · A mention notifies the people it names, never its author and never an agent

A text that names nobody notifies nobody. A mention in a comment leads to that comment.

- **Example**: Noah writes "@Mia please check" in a task's description and mentions himself
  too → Mia is notified, and Noah is not.

### COLLAB-R4 · Editing a text notifies only the people the edit adds

Someone who was already named in the text is not notified again, whichever of their names the
edit uses. A text that is reworded and names the same people notifies nobody.

- **Example**: A comment names Mia. Noah edits it and adds Ada → Ada is notified, and Mia is
  not notified a second time.

### COLLAB-R5 · A mention is never saved as plain text because names could not be looked up

When the people and automations that can be mentioned cannot be read at that moment, the save
fails (`MENTION_DIRECTORY_UNAVAILABLE`) instead of going through with nobody notified.

- **Example**: Noah saves a comment that mentions Mia while the member list cannot be read →
  the save fails, and he can try again.

### COLLAB-R10 · A mention is saved as whom it names, not as the handle that was typed

When a comment or a task description is saved, through the app, the API, an agent or an
automation, every `@handle` that names someone is stored as that person, agent or automation.
A rename never breaks it, and the text shows the current name. A handle inside code, math or a
link's text names nobody and stays text. An edit stores only the mentions it adds that way; the
ones already in the text stay as they were written. A task imported from GitHub or GlitchTip
keeps its `@names` as written: they are that tracker's people.

- **Example**: Noah posts "@my-opus-agent-3 please review" through the API. Mia then renames
  the agent Reviewer → the comment reads "@Reviewer please review".

### COLLAB-R11 · Older text keeps naming whom it named, also after a rename

A mention typed as a handle is looked up by that handle. An agent keeps answering to the names
it answered to before agents had handles, also after it is renamed, and those older names win
over another agent's handle. An agent's handle never takes the email name of a person or the
name of an automation from them. An edited comment keeps naming the people it already named.

- **Example**: Last month Noah wrote "@research.bot please check" for the agent Research Bot.
  Mia renames it QA Bot and adds a new agent named ResearchBot → Noah's comment still names QA
  Bot.

### COLLAB-R12 · A mention of someone who cannot be mentioned is saved as plain text

A mention that names someone who cannot open the task, an agent of another project, or anyone
outside the organization is saved as plain text with its name, through every door. It notifies
nobody. A person posting a comment in the app is told which mentions were saved as text; the
other doors do not say. A mention a text already had stays as it was when the text is edited.
Managed task instructions are stored exactly as sent, so there such a mention is refused
instead (`TASK_MENTION_INVALID`).

- **Example**: Noah pastes a mention of Ada, who cannot open the project, into a comment → it
  is saved as "@Ada Lovelace" in plain text, Ada is not notified, and Noah is told.

## Reviews

### COLLAB-R6 · Being named the reviewer of a task notifies that person

Naming yourself notifies nobody. When the review is handed to someone else, the earlier
reviewer's unread notification about it is marked as read.

- **Example**: Mia names Noah as the reviewer of her task → Noah gets a notification. She
  changes the reviewer to Ada → Ada is notified, and Noah's unread one is marked as read.

## Agents and automations

### COLLAB-R7 · A question an agent asks on a task goes to everyone who can see its project

- **Example**: An agent working a task in the Finance project asks which period to use →
  everyone who can see the Finance project is asked.

### COLLAB-R8 · A failed agent run notifies its starter and the task's watchers

They are told in the app and by email, as long as they can still open the project. For a
project restricted to teams that means the members of those teams, and admins always. Someone
who switched off notifications about agents is left out. When a new run starts on the task,
unread notices about the earlier failure are marked as read.

- **Example**: Mia starts an agent on a task and the run fails → Mia and the people watching
  the task are told, by email too.

### COLLAB-R9 · A schedule that pauses itself notifies each owner and admin

An owner or admin who has muted automation alerts is left out. Once the trigger is saved
again, the unread notices about its pause are marked as read.

- **Example**: A schedule turns itself off after repeated failures → every owner and admin
  who has not muted automation alerts gets a notice with a link to the trigger.

## Not yet

- **A person's list of notifications**: paging, marking as read, and the limits of a request
  (`routes.ts`).
- **Notification settings**: which switches a person can set, and what each one mutes
  (`routes.ts`, `service.ts`).
- **Every other kind of notification** and when it is sent: decided by the domain that raises
  it.
- **How a notification reaches an open browser tab** (`service.ts`).
- **Mentions while a deploy rolls**: a browser tab of the previous release shows a saved
  mention as a link that goes nowhere, and its edit field shows the stored form; a comment
  edited through the previous release loses the list of people it named, so its next edit
  notifies them again.
- **Undecided: should the mentions in a task an agent creates notify the people they name?**
  An agent's description is stored like a person's, but nobody is told (`agentCreateTaskTrusted`).
