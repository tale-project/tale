# Skills — who can see, change and share a skill, and what a save keeps

> **Prefix** `SKILL-` · **Suite** [`skills`](../../../tests/manual/suites/skills.md) · **Docs** [`workspace/skills`](../../../../../docs/en/platform/workspace/skills.md)

A skill is a bundle of instructions and files that agents can be equipped with. It belongs to
one organization and is shared with the whole organization or with some of its teams. These
rules cover who can see and change a skill, who can share one with everyone, what a save and
an upload keep, and what a delete takes with it. How an agent uses a skill and the skill
library's listing details are not covered; see Not yet.

## Who can see a skill

| A skill shared with | Is seen by |
| --- | --- |
| the organization | every member |
| teams | members of those teams, its owner, and owners and admins |
| nobody (a private skill from before) | its owner only |

### SKILL-R1 · A team skill is seen by its teams, its owner and the admins

For a project, what counts is the project's own teams, not the teams of the person looking:
a project's agents can be equipped with a team skill only when the project is on one of the
skill's teams.

- **Example**: A skill is shared with the Finance team. Mia is in Legal only → the skill is
  not in her library, and she cannot open it by its address.

### SKILL-R2 · A private skill is seen only by its owner

To everyone else it does not exist: not in the list, not by its address, and neither do its
files.

- **Example**: Noah still has a private skill from before. Mia opens its address → not found.

### SKILL-R3 · A new skill cannot be made private

Creating or uploading a skill as private is refused (`SKILL_PRIVATE_RETIRED`). A skill that is
already private stays private until its owner shares it.

- **Example**: Mia uploads a bundle marked as private → refused. She marks it for her team and
  uploads again → accepted.

### SKILL-R4 · One organization never reads or writes another's skill

Two organizations can each have a skill of the same name. Listing, reading, saving and deleting
reach only the caller's own.

- **Example**: Ada's and Zoe's organizations both have a skill named `house-voice`. Zoe deletes
  hers → Ada's is untouched.

## Who can change a skill

### SKILL-R5 · A skill is changed or deleted by its owner, or by an owner or admin

Any other member is refused and nothing is written, also when they upload a bundle to replace
it.

- **Example**: Noah shared a skill with the organization. Mia, a member, edits it → refused.
  Ada, an admin, edits it → saved.

### SKILL-R6 · Whoever creates a skill owns it, whatever the uploaded bundle says

A bundle that names someone else as its owner is recorded under the person who uploaded it.
Replacing a skill keeps the owner it had.

- **Example**: Mia uploads a new bundle whose file names Noah as owner → the skill is Mia's.

## Sharing with the whole organization

By default every member can share a skill with everyone. An organization can reserve that:

| The organization reserves it for | Can share with everyone |
| --- | --- |
| nobody (no policy) | every member |
| editors and above | owners, admins, developers and editors |
| owners and admins | owners and admins |

Someone an admin has granted the right to publish skills can share with everyone under either
reserved setting.

### SKILL-R7 · Where sharing with everyone is reserved, only those roles can do it

Creating a skill for the whole organization, and widening a team skill to it, are refused for
anyone else (`SKILL_PUBLISH_FORBIDDEN`), and nothing is written. A bundle that does not say
whom it is for counts as for everyone, so it is refused too. The refusal is written to the
audit log. A policy that cannot be read counts as the strictest setting.

- **Example**: The organization reserves sharing with everyone for owners and admins. Mia
  creates a skill and leaves **Organization** selected → refused. She picks her team instead →
  saved.

### SKILL-R8 · A reserved setting leaves team skills and existing skills alone

A member who cannot share with everyone can still create a skill for their own teams. A skill
that was shared with everyone before stays so: its owner cannot edit it in place any more, and
can still narrow it to teams or delete it.

- **Example**: Mia shared a skill with everyone last month. The organization then reserves
  that for admins → her skill is still shared with everyone, and she can narrow it to her team.

### SKILL-R9 · A team skill names at least one team its author can share with

A team skill that would end up with no team is refused (`INVALID_SKILL`), and so is one that
names a team its author cannot share with (`TEAM_ACCESS_DENIED`).

- **Example**: Mia removes the last team from her team skill and saves → refused, and the
  skill keeps its team.

## Saving and uploading

### SKILL-R10 · Creating a skill never replaces one that exists under that name

A save that asks to create only is refused when the name is taken. Two uploads of the same new
name at the same moment do not overwrite each other: the second is asked to confirm the
replacement.

- **Example**: Mia and Noah both upload a new skill named `summaries` at once → one is
  created, and the other is asked whether to replace it.

### SKILL-R11 · A save made from an outdated copy of a skill is refused

A save can say which version of the skill it started from. When the skill changed in between,
the save is refused and the answer names the current version.

- **Example**: Mia and Ada open the same skill. Ada saves first. Mia saves from the editor she
  opened earlier → refused.

### SKILL-R12 · A save that changes nothing writes nothing

The skill keeps its version and its last-changed time, no history entry is added and no audit
entry is written.

- **Example**: Mia opens her skill and saves it unchanged → nothing about it changes.

### SKILL-R13 · A save keeps the version it replaces, and the audit log says what changed

The replaced instructions go into the skill's history. The audit entry names the fields that
changed, and records a change of who the skill is shared with as its own fact, with the
audience before and after.

- **Example**: Mia widens her skill from the Finance team to Finance and Legal → the audit
  log records a sharing change from Finance to Finance and Legal.

### SKILL-R14 · An uploaded bundle is checked before any of it is unpacked

A bundle must contain its instructions file. Files with unsafe paths are refused, and so is a
bundle over the limits on the number of files, the size of one file and the total size; the
sizes a bundle declares are checked before anything is unpacked, and a file that is larger
than it declares is cut off at the limit.

- **Example**: Someone uploads a bundle whose one file declares a size over the limit →
  refused, and nothing is unpacked.

### SKILL-R15 · A skill's files are never read through a link out of its folder

A link planted in a skill's folder is refused, not followed and not skipped.

- **Example**: A bundle folder contains a link to a file elsewhere on the server → reading the
  skill fails with a message that names the entry.

## Deleting a skill

### SKILL-R16 · Deleting a skill takes it off every agent that was equipped with it

The delete and the list of agents it was taken off are written to the audit log together. A
bundle that cannot be read at all can be deleted by an owner or admin only.

- **Example**: Three project agents are equipped with a skill. Mia, its owner, deletes it →
  the three agents no longer carry it.

## Not yet

- **How an agent uses a skill**: equipping, and when a skill's instructions reach a model
  (the agents' own code, not this domain).
- **The library's list**: who created and last edited a skill as it is shown, and what a
  damaged bundle looks like in the list (`attribution.ts`, `core/skills/file_actions.ts`).
- **The sizes of the limits** in `SKILL-R14`, and the rules a skill's name must follow.
- **Skills over the REST API**: an identical bundle upload rewrites the bundle, and a skill
  keeps no version history there; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records both.
