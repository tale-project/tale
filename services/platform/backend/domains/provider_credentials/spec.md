# Provider credentials — what a stored model key is held to, and when it cannot be removed

> **Prefix** `PCRED-` · **Docs** [`admin/providers`](../../../../../docs/en/platform/admin/providers.md)

An organization reaches its AI models through providers, and holds a credential for each: an
API key, a key read from the server's environment, or a subscription account. These rules
cover how a credential is named and shown, where it can point, and when it cannot be deleted
or switched off. Subscription accounts and how a credential is picked for a call are not
covered; see Not yet.

## Naming and showing a credential

### PCRED-R1 · Two credentials of an organization cannot have the same name

Creating one under a name that is taken, or renaming one to it, is refused
(`CREDENTIAL_NAME_TAKEN`). Names are compared exactly, so two names that differ in upper and
lower case are different. Renaming a credential to the name it already has is not a clash.

- **Example**: A credential named `Production` exists. Ada adds another named `Production` →
  refused. `production` is accepted.

### PCRED-R2 · A stored key is shown only as its first four and last two characters

A key too short to show that way is shown as a fixed placeholder, so the excerpt can never be
the whole key. Spaces around the key are dropped before the excerpt is taken.

- **Example**: Ada stores the key `sk-or-v1-abcdef123456` → the list shows `sk-o…56`.

## Where a credential can point

### PCRED-R3 · A credential's own endpoint must be a public https address

A credential can carry the address of the provider's service when it differs from the usual
one. An address that is not a web address, uses plain `http` on the public internet, or
leads to an internal service address is refused (`CREDENTIAL_ENDPOINT_INVALID`), and the
refusal names the endpoint field.

- **Example**: Ada enters `http://models.example.com/v1` as a credential's endpoint → refused.

### PCRED-R4 · A key read from the server's environment cannot be replaced in the app

Such a credential holds no key of its own. A request to change its key is refused
(`CREDENTIAL_SECRET_INVALID`), and nothing is saved.

- **Example**: A credential reads its key from the server's environment. Ada pastes a new key
  into it → refused. The operator changes the key on the server instead.

## Removing and switching off

### PCRED-R5 · The credential the embedding model depends on cannot be removed

The embedding model is what knowledge search runs on. The credential it uses cannot be
deleted, disabled or stripped of its place as the provider's default: each is refused
(`CREDENTIAL_IN_USE`), and the refusal says that the embedding model uses it. Renaming it,
and changing a credential nothing depends on, stay possible.

- **Example**: Knowledge search uses Ada's OpenAI credential. She disables that credential →
  refused, with the note that the embedding model uses it.

### PCRED-R6 · Deleting a custom provider's last credential can retire the provider with it

This happens only when the delete asks for it, the credential is the provider's last, and the
provider is one the organization defined itself. A provider that ships with Tale is never
retired this way. When retiring the provider fails, the credential is still deleted.

- **Example**: Ada deletes the only credential of a provider her organization defined, and
  chooses to remove the provider too → both are gone.

## Not yet

- **Who can manage credentials**: owners and admins. Only the read of what depends on a
  credential has a test (`service.dependents.test.ts`); the other doors have none.
- **Subscription accounts**: their settings document, how an account is picked for a call,
  and what happens when one is rate limited (`broker-selection.ts`,
  `core/provider_credentials/broker_pool.ts`, `resolve_credential.ts`).
- **Which credential a call uses**: the named one, else the provider's default.
- **Editing a custom provider together with its credential** (`custom-provider-edit.ts`).
- **Re-queuing documents** that failed to index while the embedding credential was broken
  (`routes.ts`).
