# Conversation ingestion and reply helpers

These modules normalize incoming email, resolve its conversation, preserve
attachments and threading, and prepare replies. The native PostgreSQL
[conversation domain](../../domains/conversations/) owns routes, persistence,
permissions and delivery state; its [`shim.ts`](../../domains/conversations/shim.ts)
connects the reused helpers to SQL-backed handlers.

## Follow an incoming message

Start with [`sync_mailbox.ts`](sync_mailbox.ts) and the helpers in [`ingest/`](ingest/):

| Job | Source to inspect |
| --- | --- |
| Normalize a Message-ID for storage and lookup | `ingest/normalize_external_message_id.ts` |
| Find a stored message | `ingest/check_message_exists.ts` |
| Resolve replies and references to a conversation | `ingest/resolve_email_conversation_target.ts` |
| Find or create the sender’s contact | `ingest/find_or_create_contact_from_email.ts` |
| Create an inbound or sent-email conversation | `ingest/create_conversation_from_email.ts`, `ingest/create_conversation_from_sent_email.ts` |
| Reuse, materialize and bind attachments | `ingest/reuse_stored_attachments.ts`, `ingest/materialize_email_attachments.ts`, `ingest/bind_email_attachments.ts` |

Pass the organization through every lookup. Normalize external message IDs with
the existing helper: it trims surrounding whitespace and removes surrounding
angle brackets. Do not introduce a second normalization rule or compare raw
header spelling with canonical stored IDs. Missing IDs require the caller’s
existing deduplication path; an absent ID is not a reliable identity.

## Change reply behavior

[`reply_to_conversation.ts`](reply_to_conversation.ts) and
[`build_threading_headers.ts`](build_threading_headers.ts) handle reply preparation.
Native delivery scheduling and retry ownership are in
[`domains/conversations/send.ts`](../../domains/conversations/send.ts). Keep the
queued message, authorization and durable delivery behavior together when
changing this path; sending a network request inside a retried SQL transaction
can duplicate an external effect.

External applications that synchronize their own conversation system use the
[native API sync implementation](../../domains/conversations/api-sync.ts), not
these internal helpers. Its revision and delivery receipts are separate from an
email Message-ID. See the [API reference](../../../../../docs/en/develop/api-reference.md)
for the public contract.

## Verify a change

Run the platform’s server tests from the repository root:

```bash
bun run --filter @tale/platform test
```

Colocated tests cover ID normalization, threading, timestamps and attachments.
Native domain tests cover access, persistence, send state and retries. Changes
across that boundary also need the real-Postgres integration proof described in
the [backend README](../../README.md).
