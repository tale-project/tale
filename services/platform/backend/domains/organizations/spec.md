# Organizations — who is offered a new organization, and what deleting one does

> **Prefix** `ORG-`

An organization is the space a team works in: its members, projects, knowledge and settings.
These rules cover who is offered a new organization, who can delete one and what a delete
removes, and how a member asks for credits. Creating an organization and renaming it are not
covered; see Not yet.

## Who is offered a new organization

The app asks whether the signed-in person can create an organization, and offers **Create
organization** accordingly. An operator can limit this to a list of sign-in emails on the host
(`TALE_ORGANIZATION_CREATORS`).

| The deployment has | Someone on the list | Someone not on the list |
| --- | --- | --- |
| no creator list | offered | offered |
| a creator list, and no organization yet | offered | offered |
| a creator list, and at least one organization | offered | not offered |

### ORG-R1 · Without a creator list, everyone is offered a new organization

- **Example**: The host sets no creator list. Mia signs in → she is offered **Create
  organization**.

### ORG-R2 · With a creator list, only the people on it are offered a new organization

A list that names nobody offers it to no one.

- **Example**: The creator list names the operator only. Mia, who has an organization already,
  signs in → she is not offered a new one.

### ORG-R3 · Everyone is offered the deployment's first organization

Until one organization exists, the creator list does not limit anyone, so a new deployment can
be set up by whoever signs in first.

- **Example**: A new deployment has a creator list that does not name Ada, and no
  organization yet → Ada is offered **Create organization**.

## Deleting an organization

### ORG-R4 · Only an owner can delete an organization

An admin is refused (`FORBIDDEN`), and so is anyone who is not a member. Nothing is removed.

- **Example**: Noah is an admin of the organization. He deletes it → refused.

### ORG-R5 · Deleting an organization needs its name typed as confirmation

The typed name is compared without regard to upper and lower case or to spaces around it. A
different name, or none, is refused (`ORG_CONFIRM_NAME_MISMATCH`) and nothing is removed.

- **Example**: Ada deletes the organization Acme and types `acme ` → accepted. She types
  `Acme Inc` → refused.

### ORG-R6 · The deployment's default organization cannot be deleted

Its owner is refused too (`DEFAULT_ORG_PROTECTED`).

- **Example**: Ada owns the default organization. She deletes it → refused.

### ORG-R7 · An organization under a legal hold cannot be deleted

A hold on the whole organization and a hold on any one of its members both refuse the delete
(`LEGAL_HOLD_ACTIVE`). Nothing is removed and no cleanup is started.

- **Example**: One member of the organization is under a legal hold. Ada deletes the
  organization → refused, with a message that says how many members are held.

### ORG-R8 · After a delete, the organization's knowledge, files and settings are removed

The delete itself removes the organization and its records in one step. A cleanup then
removes its indexed knowledge, its stored files and its configuration, in that order. When a
step fails, the cleanup stops there and resumes on the next try; it is recorded as finished
only when all three are gone.

- **Example**: Ada deletes an organization while the knowledge database is unreachable → the
  organization is gone at once, and the cleanup starts over on its next try.

### ORG-R9 · The cleanup never touches an organization that still exists

A cleanup for a name that a live organization holds is refused and removes nothing.

- **Example**: An organization is deleted and another is created under the same address before
  the cleanup runs → the cleanup removes nothing of the new organization.

## Asking for credits

### ORG-R10 · A request for credits notifies each owner and admin personally

Only a member of the organization can ask; anyone else is refused before anything is read.
When there is nobody else who could grant credits, the answer says so instead of claiming the
request was sent.

- **Example**: Mia runs out of credits and asks for more → each owner and admin of her
  organization gets a notification of their own.

## A person's organizations

### ORG-R11 · A person's list of organizations leaves out disabled memberships

Each organization is listed with the person's one role in it.

- **Example**: Mia's membership in a second organization was disabled → her organization
  switcher lists the first one only.

## Not yet

- **Creating an organization**: the creation itself is refused for someone who is not offered
  one (`ORG-R1` to `ORG-R3`). Only an integration lane proves it
  (`auth/organization-creation-gate.ts`).
- **Renaming an organization and its other settings**, and recording which organization a
  person last used.
- **What the delete removes in its one step**: every record of the organization, in an order
  that respects what refers to what. Its tests are about that order, not a rule a reader would
  look up (`service.ts`).
