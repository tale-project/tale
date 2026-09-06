/**
 * One guardrail verdict as the chat turn reports it — the row shape of
 * `app.chat_filter_events`, the table the Security page lists and the
 * guardrail stats fold. Category ids and counts only; never the matched
 * text. The chat host produces these (`core/chat/guardrails.ts`), the
 * governance domain writes them.
 */
export interface ChatFilterEventInput {
  readonly sanitizationRunId: string;
  readonly threadId: string;
  readonly messageId?: string;
  readonly filterName: 'pii' | 'chat_filter' | 'moderation_provider';
  readonly direction: 'input' | 'output';
  readonly kind: 'detected' | 'blocked' | 'step_error' | 'circuit_open';
  readonly categoryIds: readonly string[];
  readonly matchCount?: number;
  readonly truncated?: boolean;
  readonly errorClass?: string;
  readonly httpStatus?: number;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly agentSlug?: string;
  readonly actorType?: string;
}
