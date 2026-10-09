# Governance — boxes a spec took over

Rows for [`governance`](../../suites/governance.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [governance](../../suites/governance.md) | The sandbox model gateway keeps its request log (one row per model call, never a prompt or an answer) for 3 days, or for the operator's whole-number `SANDBOX_LLM_GATEWAY_LOG_RETENTION_DAYS`; a value the gateway would refuse warns and keeps 3. Every config apply moves a gateway keeping any other span to it and leaves one already there untouched. Nothing in Tale reads that log: spend, budgets and usage come from each virtual key's budget counters. | ✅ unit | `backend/core/node_only/sandbox/llm_gateway_admin.test.ts` (`applyGatewayConfig`) |
| [governance](../../suites/governance.md) | A deploy gives the sandbox model gateway 90 s to stop instead of Docker's 10 s: the gateway takes no new model call, lets the calls in flight (streamed answers included) finish, and then writes its budget counters to its store, so the spend of a deploy's last calls is still booked. `compose.yml` and the compose `tale deploy` generates carry the same `stop_grace_period`. | ✅ unit (the grace in both pipelines; the drain itself is the gateway's own) | `tools/cli/src/lib/compose/services/create-sandbox-llm-gateway-service.test.ts`, `tools/cli/src/lib/compose/services/compose-parity.test.ts` |
