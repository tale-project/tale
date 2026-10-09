# Governance — boxes a spec took over

Rows for [`governance`](../../suites/governance.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [governance](../../suites/governance.md) | The sandbox model gateway keeps its request log (one row per model call, never a prompt or an answer) for 3 days, or for the operator's whole-number `SANDBOX_LLM_GATEWAY_LOG_RETENTION_DAYS`; a value the gateway would refuse warns and keeps 3. Every config apply moves a gateway keeping any other span to it and leaves one already there untouched. Nothing in Tale reads that log: spend, budgets and usage come from each virtual key's budget counters. | ✅ unit | `backend/core/node_only/sandbox/llm_gateway_admin.test.ts` (`applyGatewayConfig`) |
