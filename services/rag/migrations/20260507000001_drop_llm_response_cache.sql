-- migrate:up
-- The semantic LLM-response cache (private_knowledge.llm_response_cache,
-- created lazily by services/rag/app/services/llm_response_cache.py on this
-- branch's predecessor) was removed. The deleted module also owned the
-- expiry sweep, so any deployment that ran the prior version still carries
-- the table indefinitely with PII (user_message text, embeddings, response
-- bodies, user_id, organization_id) and no pruning. Drop it as part of the
-- data-protection bundle.
--
-- IF EXISTS keeps this idempotent on fresh installs that never created the
-- table.

DROP TABLE IF EXISTS private_knowledge.llm_response_cache;

-- migrate:down
-- intentionally empty: the feature is removed; rolling this migration back
-- would re-create an empty table that nothing reads or writes. Operators
-- needing to roll back the entire branch should restore from backup.
