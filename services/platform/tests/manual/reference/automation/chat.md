# Chat — boxes a spec took over

Rows for [`chat`](../../suites/chat.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [chat](../../suites/chat.md) | Attachment permissions are checked before parking and before rebuilding history or regenerating a turn; preflight failures retain text only, metadata uses the current organization and reader, and denied document reads do not queue indexing. Real PostgreSQL probes cover same-organization and cross-organization audio denial through captured model requests, with an allowed own-audio control. | ✅ unit + real PostgreSQL | `backend/domains/chat/attachment-privacy.test.ts`, `deferred-sends.test.ts` and the `checkChatDeferredAuto` lane in `backend/integration-check.ts`; existing REST and arena suites cover surrounding caller contracts; door-level privacy execution remains separate |
| [chat](../../suites/chat.md) / [governance](../../suites/governance.md) | Moving a hidden branch ends the root's project share; a destination member can read it only after a fresh explicit share. Erasure retires existing automation runs before deleting settled model requests or pseudonymizing pending ones, so late direct-model settlement books once under the erased subject and the retired run cannot admit another call. A failed or held-off prerequisite leaves a Partial receipt. | 🔶 unit + real PostgreSQL | `backend/domains/chat/threads.test.ts`, `backend/domains/erasure/service.lifecycle.test.ts`, and the sharing/erasure cases in `backend/domains/governance/project-budget.integration.ts`; rendered sharing controls and production erasure remain separate observations. |
