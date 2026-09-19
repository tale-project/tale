-- 0.5 app migration 0108: one PENDING draft per conversation.
--
-- Why: an agent-drafted reply is an approval on the conversation
-- (`resource_type = 'conversations'`, `resource_id` = the conversation id).
-- The read side has always been there — `loadPendingApprovals`
-- (domains/conversations/service.ts) joins the newest pending row onto the
-- list, and the panel renders `metadata.emailBody` as a pending message — and
-- so has the completion side: `sendMessageViaConnectorInTx` closes the pending
-- row when a human sends. Only the producer was missing, so nothing until now
-- inserted one outside the integration check.
--
-- Giving that producer the same contract the connector gate already has
-- (0074) means the schema, not the caller, guarantees a conversation cannot
-- carry two pending drafts. Two automation runs racing one inbound message
-- would otherwise each mint a card, and the panel shows the newest while the
-- send completes the oldest it finds — a draft the reader never saw being
-- marked as the one they sent.
--
-- No backfill: `resource_type = 'conversations'` rows were never minted in
-- production, so there are no duplicates to supersede. If a deployment did
-- acquire some by hand, this index creation fails loudly rather than choosing
-- a survivor on its own — the right outcome for rows nobody can attribute.
--
-- Rolling-deploy safe: the previous image inserts no rows of this type at all,
-- so there is nothing for it to race.

CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending_conversation_draft
  ON app.approvals (org_id, resource_type, resource_id)
  WHERE resource_type = 'conversations' AND status = 'pending';
