# Connectors — boxes a spec took over

Rows for [`connectors`](../../suites/connectors.md) boxes that moved out of the suite. Read
[`../automation.md`](../automation.md) for the rest of the coverage map.

| Suite | Automated slice | Coverage | Specs |
| --- | --- | --- | --- |
| [connectors](../../suites/connectors.md) | An agent's connector call through the in-sandbox bridge runs the action's live body in the platform process, like an automation's or chat's call, never as a `node -e` program in the agent's own session (whose command line carried the credential's secrets, readable by every process of that session, and which took one of its live-exec places); the bridge's dispatch carries no session. The bridge runs at most four of a session's calls at once (a further one is refused as busy), gives agent calls no file store, and a body past its time limit can no longer reach the outside system | ✅ backend | `backend/domains/connectors/service.runner.test.ts` (the door hands a live call the in-process runner, and a bridge call no file store), `backend/domains/connectors/bridge-routes.test.ts` (live mode, no session, the four-call cap), `lib/connectors/dispatcher.test.ts` (no host request after the time limit), `backend/core/node_only/sandbox/connectors_bridge.test.ts` (the dispatch's exact arguments), `backend/core/tasks/agent_run_host.connector_caller.test.ts` (a task run's call routed through the real hosts with the door mocked) |
