# Providers — who can define a model provider, and when one cannot be removed

> **Prefix** `PROV-` · **Docs** [`admin/providers`](../../../../../docs/en/platform/admin/providers.md)

A provider is a service an organization gets its AI models from. Some ship with Tale; an
organization can also define its own, with its address and the models it offers. These rules
cover who can change an organization's own provider definitions and what a change is held to.
The providers that ship with Tale and the credentials are not covered; see Not yet.

## Defining a provider

### PROV-R1 · A member cannot change or delete a provider definition

A member is refused (HTTP 403). An owner, an admin and a developer can define, change and
delete a provider.

- **Example**: Mia is a member. She saves a new provider definition → refused.

### PROV-R2 · A definition with an unknown field or an invalid value is refused as a whole

The same holds for a request that is not valid JSON. Nothing is saved, and the refusal does
not repeat what was sent, so a mistyped key cannot end up in an error message.

- **Example**: Noah saves a definition with a field the platform does not know → refused, and
  the stored definition is unchanged.

### PROV-R3 · A change made from an outdated copy of a definition is refused

A save or a delete says which version of the definition it started from. When the definition
changed in between, it is refused (HTTP 409).

- **Example**: Noah and Ada open the same provider. Ada saves first. Noah deletes it from the
  page he opened earlier → refused.

### PROV-R4 · A provider that is still in use cannot be deleted

The delete is refused (`PROVIDER_IN_USE`). Once nothing uses the provider, it is deleted, and
the definition it had is kept in the history.

- **Example**: An agent is set to a model of a provider Ada's organization defined. Ada
  deletes the provider → refused.

## Not yet

- **The providers that ship with Tale**, and how an organization's own definition appears
  beside them in the list (`config.ts`).
- **Refreshing the list of models** a provider offers.
- **Credentials**: see the provider credentials spec.
- **Which models an organization can use for chat, embedding and transcription**, and the
  message when none is set for transcription (`NO_TRANSCRIPTION_MODEL`).
