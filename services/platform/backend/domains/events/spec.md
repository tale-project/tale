# Events — what a record's save owes the automations it starts

> **Prefix** `EVENT-`

Creating, changing or deleting a record raises an event, and an automation with an event
trigger can start from it. These rules say how that start is tied to the save that raised it.
Which events exist and which automations one starts are not covered; see Not yet.

## A save and the automations it starts

### EVENT-R1 · An automation starts only if the save that raised its event goes through

The run is created in the same database transaction as the save, so the two are stored
together or not at all.

- **Example**: Mia creates a task and the save fails at its last step → no automation run
  exists for a task that was never created.

### EVENT-R2 · A save never fails because an automation could not start

The failure is written to the server log, the automation's start is undone, and the record is
saved as if no automation had been listening. A start one automation refuses, because its
inputs refuse the event or its project cannot take a run, is recorded on that automation's
trigger instead, and the other automations listening still start (`AUTO-R35`).

- **Example**: Mia creates a contact. An automation that runs on new contacts fails to start →
  the contact is saved, and the failed start is in the server log.

## Not yet

- **Which events exist and what each carries** (`lib/shared/event-types.ts`).
- **Which automations an event starts**, and what a trigger refuses: that is decided by the
  automations domain (`automations/triggers.ts`).
- Nothing tells the person who saved that an automation failed to start; the server log, and
  the trigger for a start the automation refused, are the only records (`EVENT-R2`).
