import { useMemo, useRef } from 'react';

import { SYSTEM_MSG_TAG } from '@/lib/shared/constants/system-message-tags';

import type {
  AgentJobCard,
  DocumentWriteApproval,
  HumanInputRequest,
  IntegrationApproval,
  KnowledgeWriteApproval,
  LocationRequest,
  PlanApproval,
  WorkflowCreationApproval,
  WorkflowRunApproval,
  WorkflowUpdateApproval,
} from './queries';
import type { ChatMessage } from './use-message-processing';

export type ChatItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'approval'; data: IntegrationApproval }
  | { type: 'workflow_approval'; data: WorkflowCreationApproval }
  | { type: 'workflow_update_approval'; data: WorkflowUpdateApproval }
  | { type: 'workflow_run_approval'; data: WorkflowRunApproval }
  | { type: 'human_input_request'; data: HumanInputRequest }
  | { type: 'document_write_approval'; data: DocumentWriteApproval }
  | { type: 'knowledge_write_approval'; data: KnowledgeWriteApproval }
  | { type: 'location_request'; data: LocationRequest }
  | { type: 'plan_approval'; data: PlanApproval }
  | { type: 'job'; data: AgentJobCard };

type ApprovalChatItem = Exclude<ChatItem, { type: 'message' }>;

interface UseMergedChatItemsParams {
  messages: ChatMessage[];
  integrationApprovals: IntegrationApproval[] | undefined;
  workflowCreationApprovals: WorkflowCreationApproval[] | undefined;
  workflowUpdateApprovals: WorkflowUpdateApproval[] | undefined;
  workflowRunApprovals: WorkflowRunApproval[] | undefined;
  humanInputRequests: HumanInputRequest[] | undefined;
  /** Completed/rejected human-input requests — rendered INLINE at their
   *  chronological slot (after their source message) so an answered request
   *  stays visible and editable in the history. */
  resolvedHumanInputRequests?: HumanInputRequest[];
  locationRequests: LocationRequest[] | undefined;
  documentWriteApprovals: DocumentWriteApproval[] | undefined;
  /** Optional — surfaces only on the main chat path (the `knowledge_write`
   *  tool); arena/automation callers don't pass it. */
  knowledgeWriteApprovals?: KnowledgeWriteApproval[];
  /** External-agent plan proposals — rendered INLINE anchored to their source
   *  message and deliberately EXCLUDED from `activeApproval`: a pending plan
   *  must never disable the composer (typing below = refining the plan). */
  planApprovals?: PlanApproval[];
  /** Spawned agent-on-demand jobs — rendered INLINE anchored to the turn that
   *  spawned them, never in `activeApproval` (a job needs no user action). */
  jobs?: AgentJobCard[];
}

export interface MergedChatItemsResult {
  messages: ChatItem[];
  activeApproval: ChatItem | null;
  /** True when `activeApproval` already renders INLINE in `messages` (human
   *  input anchored to its source message) — the footer card must then be
   *  skipped, or the request would show twice. Keeping the active card
   *  inline gives it ONE stable DOM slot through pending → executing →
   *  completed, instead of hopping from the footer into the history. */
  activeApprovalInline: boolean;
}

function isActiveStatus(status: string) {
  return status === 'pending' || status === 'executing';
}

/**
 * Splice human-input requests (active AND resolved) into the chronologically
 * sorted message items, each immediately AFTER the message whose id matches
 * its `messageId` (anchor-to-source: the request must appear under the
 * assistant turn that asked it, even when later messages carry earlier
 * client clocks). When at least one card is inserted, the duplicate
 * `[HUMAN_INPUT_RESPONSE]` pill system messages are dropped — the card shows
 * the (latest) response itself. Requests whose source message isn't loaded
 * (pagination) are skipped; they appear once load-more brings the message
 * in. Pure + exported for unit testing.
 */
export function mergeHumanInputItems(
  messageItems: ChatItem[],
  requests: HumanInputRequest[],
  /** Whether the resolved-requests subscription has loaded. Pills are only
   *  suppressed once it has — suppressing while it's still in flight would
   *  briefly hide previously answered Q&As (their cards aren't in yet). */
  suppressPills: boolean,
): ChatItem[] {
  if (requests.length === 0) return messageItems;

  const byMessageId = new Map<string, HumanInputRequest[]>();
  for (const request of requests) {
    if (!request.messageId) continue;
    const bucket = byMessageId.get(request.messageId);
    if (bucket) bucket.push(request);
    else byMessageId.set(request.messageId, [request]);
  }
  for (const bucket of byMessageId.values()) {
    bucket.sort((a, b) => a._creationTime - b._creationTime);
  }

  const merged: ChatItem[] = [];
  let insertedAny = false;
  for (const item of messageItems) {
    merged.push(item);
    if (item.type !== 'message') continue;
    const bucket = byMessageId.get(item.data.id);
    if (!bucket) continue;
    for (const request of bucket) {
      merged.push({ type: 'human_input_request', data: request });
      insertedAny = true;
    }
  }
  if (!insertedAny) return messageItems;
  if (!suppressPills) return merged;

  // The inline card displays the response — the pill would repeat it (and
  // every edit appends ANOTHER "corrected answer supersedes" pill). Only
  // suppressed when a card actually rendered, so the pill survives as a
  // fallback when approval data is missing.
  return merged.filter(
    (item) =>
      item.type !== 'message' ||
      item.data.role !== 'system' ||
      !item.data.content.startsWith(SYSTEM_MSG_TAG.HUMAN_INPUT_RESPONSE),
  );
}

/**
 * Splice plan-approval cards into the sorted message items, each immediately
 * AFTER its source assistant message (the turn that proposed the plan). Plans
 * whose source message isn't loaded (pagination) are skipped — they appear
 * once load-more brings the message in. Pure + exported for unit testing.
 */
export function mergePlanApprovalItems(
  messageItems: ChatItem[],
  approvals: PlanApproval[],
): ChatItem[] {
  if (approvals.length === 0) return messageItems;

  const byMessageId = new Map<string, PlanApproval[]>();
  for (const approval of approvals) {
    if (!approval.messageId) continue;
    const bucket = byMessageId.get(approval.messageId);
    if (bucket) bucket.push(approval);
    else byMessageId.set(approval.messageId, [approval]);
  }
  for (const bucket of byMessageId.values()) {
    bucket.sort((a, b) => a._creationTime - b._creationTime);
  }

  const merged: ChatItem[] = [];
  let insertedAny = false;
  for (const item of messageItems) {
    merged.push(item);
    if (item.type !== 'message') continue;
    const bucket = byMessageId.get(item.data.id);
    if (!bucket) continue;
    for (const approval of bucket) {
      merged.push({ type: 'plan_approval', data: approval });
      insertedAny = true;
    }
  }
  return insertedAny ? merged : messageItems;
}

/**
 * Splice job cards into the sorted message items, each immediately AFTER the
 * assistant message of the turn that spawned it. Jobs whose anchor message
 * isn't loaded (pagination, or the turn is still streaming and hasn't linked
 * yet) are skipped — they appear when the link lands or load-more brings the
 * message in. Pure + exported for unit testing.
 */
export function mergeJobItems(
  messageItems: ChatItem[],
  jobs: AgentJobCard[],
): ChatItem[] {
  if (jobs.length === 0) return messageItems;

  const byMessageId = new Map<string, AgentJobCard[]>();
  for (const job of jobs) {
    if (!job.messageId) continue;
    const bucket = byMessageId.get(job.messageId);
    if (bucket) bucket.push(job);
    else byMessageId.set(job.messageId, [job]);
  }
  for (const bucket of byMessageId.values()) {
    bucket.sort((a, b) => a.startedAt - b.startedAt);
  }

  const merged: ChatItem[] = [];
  let insertedAny = false;
  for (const item of messageItems) {
    merged.push(item);
    if (item.type !== 'message') continue;
    const bucket = byMessageId.get(item.data.id);
    if (!bucket) continue;
    for (const job of bucket) {
      merged.push({ type: 'job', data: job });
      insertedAny = true;
    }
  }
  return insertedAny ? merged : messageItems;
}

/**
 * Hook to merge messages with approvals.
 * Messages are returned chronologically.
 * The latest active (pending/executing) approval is returned separately;
 * resolved human-input requests and plan proposals are merged INLINE after
 * their source message (other completed/rejected approvals stay hidden).
 * Plan approvals never populate `activeApproval` — the composer stays usable
 * while a plan awaits review.
 */

/** True when two items are the same kind and carry the same underlying record.
 *  `data` is reference-stable per message via the use-message-processing identity
 *  hold, and per Convex doc for approvals, so a reference check is enough. */
function sameItem(a: ChatItem, b: ChatItem): boolean {
  return a.type === b.type && a.data === b.data;
}

/** Reuse prior wrapper objects (and, when nothing changed, the prior ARRAY
 *  identity) so a streamed token only churns the single tail item. The fresh
 *  `{type,data}` wrappers built each render would otherwise defeat both the
 *  ChatMessages memo AND every per-item bubble memo even when only the
 *  streaming tail advanced. */
function reconcileItems(
  next: ChatItem[],
  prev: ChatItem[] | undefined,
): ChatItem[] {
  if (!prev || prev.length !== next.length) return next;
  let allSame = true;
  const out = next.map((item, i) => {
    const p = prev[i];
    if (p && sameItem(p, item)) return p;
    allSame = false;
    return item;
  });
  return allSame ? prev : out;
}

function sameApproval(a: ChatItem | null, b: ChatItem | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameItem(a, b);
}

export function useMergedChatItems({
  messages,
  integrationApprovals,
  workflowCreationApprovals,
  workflowUpdateApprovals,
  workflowRunApprovals,
  humanInputRequests,
  resolvedHumanInputRequests,
  locationRequests,
  documentWriteApprovals,
  knowledgeWriteApprovals,
  planApprovals,
  jobs,
}: UseMergedChatItemsParams): MergedChatItemsResult {
  // Holds the previous output so an unchanged (or tail-only-changed) tick can
  // return a referentially-stable result — see reconcileItems above.
  const heldRef = useRef<MergedChatItemsResult | null>(null);
  return useMemo((): MergedChatItemsResult => {
    // Build message items
    const loadedMessageIds = new Set();
    for (const message of messages || []) {
      loadedMessageIds.add(message.id);
    }

    const messageItems: ChatItem[] = (messages || []).map((message) => ({
      type: 'message' as const,
      data: message,
    }));

    // Sort messages chronologically
    messageItems.sort((a, b) => {
      if (a.type !== 'message' || b.type !== 'message') return 0;
      const aTime = a.data._creationTime ?? a.data.timestamp.getTime();
      const bTime = b.data._creationTime ?? b.data.timestamp.getTime();
      return aTime - bTime;
    });

    // Inline human-input cards — ACTIVE ones too, so the card occupies one
    // stable DOM slot through pending → executing → completed instead of
    // hopping from the footer into the history at completion. Resolved rows
    // whose id is still in the ACTIVE set are skipped (status-flip race
    // between the two subscriptions) so a request never renders two cards.
    const activeHumanInputIds = new Set(
      (humanInputRequests ?? []).map((a) => a._id),
    );
    const humanInputToInline = [
      ...(humanInputRequests ?? []),
      ...(resolvedHumanInputRequests ?? []).filter(
        (a) => !activeHumanInputIds.has(a._id),
      ),
    ];
    const itemsWithHumanInput = mergeHumanInputItems(
      messageItems,
      humanInputToInline,
      resolvedHumanInputRequests !== undefined,
    );

    // Plan-approval cards: inline after their source message, never in the
    // footer/activeApproval slot (the composer must stay usable — typing
    // below a pending plan is how the user refines it).
    const itemsWithPlans = mergePlanApprovalItems(
      itemsWithHumanInput,
      planApprovals ?? [],
    );

    // Job cards: inline after the turn that spawned them; never
    // `activeApproval` (nothing to approve — the card is a live status view).
    const itemsWithJobs = mergeJobItems(itemsWithPlans, jobs ?? []);

    // Collect active approvals (pending/executing only, linked to loaded messages)
    const activeApprovals: ApprovalChatItem[] = [];

    for (const a of integrationApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'approval', data: a });
      }
    }
    for (const a of workflowCreationApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_approval', data: a });
      }
    }
    for (const a of workflowUpdateApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_update_approval', data: a });
      }
    }
    for (const a of workflowRunApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_run_approval', data: a });
      }
    }
    for (const a of humanInputRequests ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'human_input_request', data: a });
      }
    }
    for (const a of locationRequests ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'location_request', data: a });
      }
    }
    for (const a of documentWriteApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'document_write_approval', data: a });
      }
    }
    for (const a of knowledgeWriteApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'knowledge_write_approval', data: a });
      }
    }

    // Pick the latest active approval by creation time
    let activeApproval: ChatItem | null = null;
    if (activeApprovals.length > 0) {
      activeApprovals.sort(
        (a, b) => b.data._creationTime - a.data._creationTime,
      );
      activeApproval = activeApprovals[0];
    }

    // Human-input requests anchored to a loaded message render inline (see
    // above) — the footer must skip them or the card shows twice.
    const activeApprovalInline =
      activeApproval !== null &&
      activeApproval.type === 'human_input_request' &&
      activeApproval.data.messageId !== undefined &&
      loadedMessageIds.has(activeApproval.data.messageId);

    // Identity hold: reuse prior wrappers/array when nothing renderable changed
    // and the prior whole result when all three fields are equivalent, so an
    // idle/typing tick keeps ChatMessages' memo intact and a streamed token
    // churns only the tail item.
    const prev = heldRef.current;
    const heldMessages = reconcileItems(itemsWithJobs, prev?.messages);
    const heldApproval =
      prev && sameApproval(prev.activeApproval, activeApproval)
        ? prev.activeApproval
        : activeApproval;
    if (
      prev &&
      prev.messages === heldMessages &&
      prev.activeApproval === heldApproval &&
      prev.activeApprovalInline === activeApprovalInline
    ) {
      return prev;
    }
    const out: MergedChatItemsResult = {
      messages: heldMessages,
      activeApproval: heldApproval,
      activeApprovalInline,
    };
    heldRef.current = out;
    return out;
  }, [
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    resolvedHumanInputRequests,
    locationRequests,
    documentWriteApprovals,
    knowledgeWriteApprovals,
    planApprovals,
    jobs,
  ]);
}
