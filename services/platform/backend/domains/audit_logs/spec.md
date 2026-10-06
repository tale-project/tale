# Audit log — what makes the log trustworthy, and what a reader gets from it

> **Prefix** `AUDIT-` · **Docs** [`admin/governance/audit-logs`](../../../../../docs/en/platform/admin/governance/audit-logs.md)

The audit log records who did what in an organization. Its entries are chained: each one is
sealed together with the one before it, so that an entry which was changed or removed can be
detected. These rules cover that check, the alert when it fails, and what listing and
exporting the log give back. Who can read the log and which actions are recorded are not
covered; see Not yet.

## Checking the log

### AUDIT-R1 · A missing or changed entry is reported as a break in the log

The check walks the chain and reports the first place where it does not hold. It can pick up
where an earlier check stopped.

- **Example**: Someone deletes one entry from the middle of the log directly in the database →
  the next check reports a break at that place.

### AUDIT-R2 · Entries removed by the retention cleanup are not reported as a break

When the entry the check wanted to resume from is gone because it was older than the
organization's retention period, the check starts again from the oldest entry that remains.
An entry that is missing although it was younger than the period is a break, and an
organization that sets no retention period for its audit log is never excused a missing entry.

- **Example**: The audit log is kept for a year. The entry last checked is now thirteen months
  old and was cleaned up → the check carries on from the oldest remaining entry, and reports
  no break.

### AUDIT-R3 · A break raises an alert, and keeps raising it until it has been delivered

The break is recorded even when the alert cannot be written at that moment, and the next
check raises the alert again instead of assuming it was seen.

- **Example**: A break is found while notifications cannot be written → the break is on
  record, and the next check raises the alert.

## Reading the log

### AUDIT-R4 · A page of the audit log holds 50 entries unless asked otherwise, 200 at most

A request for fewer than one entry gets one, and a request for more than 200 gets 200.

- **Example**: An integration asks for 10,000 entries at once → it gets 200 and a pointer to
  the next page.

### AUDIT-R5 · A date filter must be a real moment in time

A filter that is not a whole number of milliseconds, is zero or negative, or lies beyond the
last moment a date can hold is refused, for the list, for the export and for the check.
Nothing is read.

- **Example**: A request filters the log from the moment `1.5` → refused.

## Exporting the log

### AUDIT-R6 · An exported log cannot run formulas in a spreadsheet

A value that starts like a formula, such as `=`, `+`, `-` or `@`, is written so that a
spreadsheet shows it as text. Other text is exported as it is.

- **Example**: Someone named a document `=HYPERLINK("http://evil/")`. An admin exports the log
  and opens it in a spreadsheet → the cell shows that text, and no link is created.

## Not yet

- **Who can read, export and check the audit log**: owners and admins, as the user docs say.
  No test here holds it (`routes.ts`).
- **Which actions are recorded**, and what an entry carries: decided by each domain that
  writes one.
- **How an entry is sealed**: the exact text that is sealed, and how two entries written at
  the same moment are ordered (`hash-input.ts`, `service.ts`).
- **How often the log is checked**, and who is alerted.
