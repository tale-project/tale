# Chat — boxes a spec took over

Rows for [`chat`](../../suites/chat.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [chat](../../suites/chat.md) | Attachment permissions are checked before parking and before rebuilding history or regenerating a turn; preflight failures retain text only, metadata uses the current organization and reader, and denied document reads do not queue indexing. Real PostgreSQL probes cover same-organization and cross-organization audio denial through captured model requests, with an allowed own-audio control. | ✅ unit + real PostgreSQL | `backend/domains/chat/attachment-privacy.test.ts`, `deferred-sends.test.ts` and the `checkChatDeferredAuto` lane in `backend/integration-check.ts`; existing REST and arena suites cover surrounding caller contracts; door-level privacy execution remains separate |
