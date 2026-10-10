# User preferences — when a person's custom instructions apply

> **Prefix** `PREF-` · **Docs** [`member/preferences`](../../../../../docs/en/platform/member/preferences.md)

Each person keeps their own preferences in each organization. These rules cover the custom
instructions the chat assistant follows for a person: how long they can be, and when they are
used. The other preferences, and who can read a person's preferences, are not covered; see
Not yet.

## Custom instructions

### PREF-R1 · Custom instructions hold up to 3,200 characters

A line break counts as one character, however the browser sent it. Longer text is refused
(`too_long`) and the saved instructions stay as they were.

- **Example**: Mia saves custom instructions 3,201 long → refused, and her earlier
  instructions are still there.

### PREF-R2 · A person's own switch decides whether their custom instructions are used

A person who has not set the switch follows the organization's default. With no choice of
their own and no organization default, custom instructions are off.

| The person's switch | The organization's default | Custom instructions are |
| --- | --- | --- |
| on | on or off | used |
| off | on or off | not used |
| not set | on | used |
| not set | off, or none | not used |

- **Example**: The organization turns custom instructions on by default. Mia turns her own
  switch off → the assistant does not follow her instructions, and her text is kept.

### PREF-R3 · Blank custom instructions count as none

Text that is empty or only spaces adds nothing to what the assistant is told, even while the
switch is on. Spaces around the text are dropped.

- **Example**: Mia's switch is on and her text is three spaces → the assistant is given no
  custom instructions.

## Not yet

- **Who can read a person's preferences**: only that person; an admin cannot read another
  person's. No test holds it yet (`getMyPreferences` in `service.ts`).
- **Characters custom instructions cannot contain**: angle brackets, backticks and control
  characters are refused (`invalid`). No test holds it yet (`upsertCustomInstructions`).
- **The other preferences**: voice output, the chat model a person last picked, and whether
  they finished onboarding (`service.ts`).
