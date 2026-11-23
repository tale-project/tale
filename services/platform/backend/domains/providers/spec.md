# Providers — who can define a model provider, and when one cannot be removed

> **Prefix** `PROV-` · **Docs** [`admin/providers`](../../../../../docs/en/platform/admin/providers.md)

A provider is a service an organization gets its AI models from. Some ship with Tale; an
organization can also define its own, with its address and the models it offers. These rules
cover who can change an organization's own provider definitions, what a change is held to, and
whose models each provider lists. The rest of the shipped providers and the credentials are not
covered; see Not yet.

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

## Listing a provider's models

### PROV-R5 · A listing with a key that is not saved goes to its asker alone

While a provider is being set up, its models can be listed with the key typed beside it, or
with one saved key the person names. The answer is never kept or shown to anyone else, and a
refused listing says whether a key was sent. A key goes only to the provider's own model
listing, never to a public catalog the provider reads instead, and a saved key lists even
while its credential is disabled.

- **Example**: Ada types a gateway's address and her key, then lists its models → she sees
  the models her key may use. Noah, in another organization, lists the same gateway without
  a key → refused, told that no key was sent.

### PROV-R6 · Each provider lists only its own models

A provider's model list comes from that provider alone, so an organization's own provider never
adds models to a shipped one, never removes any from it, and never replaces its list. A
provider whose list cannot be fetched shows that failure on its own entry, and no other
provider's list changes because of it.

- **Example**: Ada's organization uses OpenRouter. She defines its own provider at an address
  that does not resolve → OpenRouter still lists all its models, and the new provider lists none
  and says its address cannot be reached.

## Not yet

- **The providers that ship with Tale**, and how an organization's own definition appears
  beside them in the list (`config.ts`).
- **Refreshing the list of models** a provider offers for everyone.
- **Credentials**: see the provider credentials spec.
- **Which models an organization can use for chat, embedding and transcription**, and the
  message when none is set for transcription (`NO_TRANSCRIPTION_MODEL`).
- **Undecided: should a provider whose live list cannot be fetched say it shows a fallback?**
  When OpenRouter's own list cannot be fetched and nothing is cached yet, it shows the short
  list of models Tale ships for it, and its entry names no failure (`catalog_fetch.ts`,
  `serveDegraded`). The code's comments choose to keep serving, but nothing decides whether
  the entry should say so.
