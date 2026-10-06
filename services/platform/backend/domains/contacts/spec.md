# Contacts — what makes a contact, and what an edit or an import does

> **Prefix** `CONTACT-`

A contact is a person outside the organization: someone who writes in, or a record imported
from another system. These rules cover what a contact must have, what keeps two contacts
apart, how incoming mail finds its contact, and what an import and an edit do. Reading,
searching and deleting contacts are not covered; see Not yet.

## What makes a contact

### CONTACT-R1 · Creating a contact needs a role that can edit contacts

Anyone else is refused (`RBAC_FORBIDDEN`) and nothing is saved.

- **Example**: Mia's role cannot edit contacts. She adds a contact → refused.

### CONTACT-R2 · A contact has at least a name, an email or an external ID

A contact with none of the three is refused (`CONTACT_IDENTITY_REQUIRED`), and so is an edit
that would clear the last one a contact has. One of them can be cleared while another
remains.

- **Example**: A contact has an email and nothing else. Noah clears the email → refused, and
  the email stays.

### CONTACT-R3 · Two contacts of one organization cannot share an email

A second contact with the email of an existing one is refused (`CONTACT_DUPLICATE_EMAIL`),
when it is created and when an edit would give it that email. Deleted contacts do not count,
and any number of contacts can have no email.

- **Example**: A contact with `ann@example.test` exists. Noah adds another with the same email
  → refused, and nothing is added.

### CONTACT-R4 · Two contacts of one organization cannot share an external ID

The external ID is the key a contact has in another system. A second contact with the same
one is refused (`CONTACT_DUPLICATE_EXTERNAL_ID`), on creation and on edit.

- **Example**: An import brings a contact whose external ID an existing contact holds → that
  contact is refused as a duplicate.

### CONTACT-R5 · A phone number or language that is not well-formed is refused

| Field | Accepts | Refuses, for example |
| --- | --- | --- |
| Phone | a number written with digits, spaces, and `+`, `-`, `(`, `)` | `call me`, `+1-555-ABCD` |
| Language | a language tag such as `fr`, `pt-BR` or `zh_Hans` | `en-123`, `de!` |

- **Example**: Noah enters `call me` as a contact's phone number → refused.

## Incoming mail

### CONTACT-R6 · Mail from a known address goes to the contact that has it

When no contact has the address, one is created for it, with an audit entry made in the
system's name. Mail without a sender address creates no contact.

- **Example**: A first message arrives from `ann@example.test` → a contact is created. Her
  second message is filed under the same contact.

## Importing a file

### CONTACT-R7 · An import file holds at most 1,000 rows

A file with one row more is refused as a whole, with a message that names the limit.

- **Example**: Noah uploads a file of 1,001 contacts → refused, and none is imported.

### CONTACT-R8 · A row that cannot be imported is refused alone; the rest is imported

The answer names the row and the column of each refused row. A row that duplicates an
existing contact is counted as a duplicate and does not stop the import.

- **Example**: Noah imports three rows, and the second has an email that is not an email
  address → rows one and three are imported, and the answer names row two and its email.

## Editing a contact

### CONTACT-R9 · An edit changes only the fields it sends, and an empty field is cleared

Every field the edit does not send keeps its value. Tags sent as empty become an empty list.

- **Example**: Noah clears a contact's phone number and saves → the phone number is removed,
  and the name, email and tags are as they were.

### CONTACT-R10 · Extra data is merged key by key, and an address is replaced whole

For the free-form data on a contact, keys the edit sends are set, keys it leaves out stay,
and a key sent as empty is removed. An address is one unit: sending it replaces all of it.

- **Example**: A contact carries `plan` and `region` as extra data. An integration sends only
  a new `plan` → `plan` changes and `region` stays.

### CONTACT-R11 · An edit made from an outdated copy of the contact is refused

An edit can say which version of the contact it started from. When someone else saved in
between, it is refused (`CONTACT_STALE`).

- **Example**: Mia and Noah open the same contact. Noah saves a new name. Mia then saves from
  the form she opened earlier → refused, and Noah's name stays.

### CONTACT-R12 · An edit that changes nothing writes nothing

No audit entry is written and no event is raised, so no automation starts.

- **Example**: Noah opens a contact and saves it unchanged → the audit log gains no entry.

### CONTACT-R13 · Changing a contact's external ID keeps its mirrored conversations attached

Conversations mirrored from another system are tied to the contact by its external ID. When
the ID changes, they follow it.

- **Example**: An integration changes a contact's external ID → the conversations mirrored for
  that contact are still listed under it.

## Not yet

- **Reading, listing and searching contacts**, and the filters of the list (`routes.ts`,
  `service.ts`).
- **Deleting a contact**, and what happens to its conversations.
- **Contacts over the REST API** (`rest/v1-core.ts`).
- **Which roles can edit contacts** (`CONTACT-R1`): set by the permission table, not by this
  domain.
