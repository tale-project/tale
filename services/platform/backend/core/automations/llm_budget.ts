/** A direct call is bounded independently of the worker that owns it. */
export const AUTOMATION_LLM_OP_KIND = 'automation-llm';
export const AUTOMATION_LLM_LIFETIME_MS = 180_000;

/** The durable effect attempt, including nested/repeated node addresses. */
export interface LlmAttemptAddress {
  nodeId: string;
  itemIndex: number;
  pass: number;
  attempt: number;
}
