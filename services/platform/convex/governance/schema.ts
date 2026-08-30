export const GOVERNANCE_POLICY_TYPES = [
  'system_prompt',
  'budgets',
  'upload_policy',
  'retention_policy',
  'feature_flags',
  'pii_config',
  'default_models',
  'model_access',
  'login_policy',
  'password_policy',
  'two_factor_policy',
  // Org-level session idle timeout (#1502). Tightens the deployment-wide
  // SESSION_IDLE_TIMEOUT_MINUTES backstop for this org; drives the client
  // watchdog. Config shape: `sessionIdleTimeoutConfigSchema`.
  'session_idle_timeout',
  'chat_filter',
  'moderation_provider',
  // Org-level default for the custom-instructions feature. Per-user
  // `userPreferences.customInstructionsEnabled` may override.
  'custom_instructions',
  // Org-level default for the user-memories feature (memory injection +
  // `propose_memory` tool). Per-user `userPreferences.memoriesEnabled`
  // may override.
  'user_memories',
  // Org-level kill switch for the voice-output (TTS) feature. Missing row
  // → effective default ON (existing deployments keep their current
  // behaviour). `config.enabled === false` overrides every user's
  // `userPreferences.voiceOutput` and every thread's `voiceOutputOverride`.
  // See `tts/queries.ts::getVoiceModeEffective` for the cascade.
  'voice_output',
  // Phase 12 — admin-customizable confidentiality notice rendered in
  // chat composer + upload dialog footers. Default copy is fetched from
  // i18n; this policy lets per-org admins override per locale.
  'data_classification_notice',
  // GDPR DSAR governance: cooling-off window, dual-approval requirement,
  // and per-admin daily filing rate limit. Defaults live in
  // `governance/dsar_policy.ts`.
  'dsar_governance',
  // RETIRED — the agent_workforce policy left the config registry (its
  // knobs became fixed guardrail defaults) and migration 0.2.90/04 deletes
  // the org files. The literal stays one release because this closed union
  // validates EXISTING policyAcknowledgements rows at schema push time;
  // drop it in the next release.
  'agent_workforce',
  // Agent-on-demand job guardrails for `spawn_agent`: org concurrency cap,
  // terminal-row TTL, stuck-run threshold. Missing row → schema defaults.
  // Config shape: `agentJobsConfigSchema` (lib/shared/schemas/governance.ts).
  'agent_jobs',
  // Master switch for the task-ops automation pack (agent execution on
  // tasks). Gates BOTH halves: the run-agent action refuses when disabled,
  // and `setTaskAutomationEnabled` flips the pack's trigger rows. Missing
  // row → enabled. Config shape: `taskAutomationConfigSchema`.
  'task_automation',
  // Org-level package allowlist/denylist for the `run_code` tool (replaces the
  // former `orgPackagePolicy` DB table). Missing file → all packages allowed.
  // Config shape: `runCodePolicyConfigSchema`.
  'run_code',
  // Per-org opt-out for the weekly provider-config auto-sync cron (replaces the
  // former `modelSyncSettings` DB table). Missing file → enabled. Config shape:
  // `modelSyncConfigSchema`.
  'model_sync',
  // Per-org sandbox concurrency quota: one-shot exec cap + active-session
  // cap. The deployment-wide host caps are spawner env; this is the
  // per-tenant slice. Config shape: `sandboxQuotaConfigSchema`
  // (lib/shared/schemas/governance.ts).
  'sandbox_quota',
  // Deprecated / ignored. Assignment privacy is built into conversations RLS.
  // Kept so existing configCache rows still validate. Config shape:
  // `conversationAccessConfigSchema` (lib/shared/schemas/governance.ts).
  'conversation_access',
  // Address→assignee routing rules, applied inline when an inbound
  // conversation is created (a governance feature, not an automation).
  // Missing row ⇒ no routing. Config shape: `conversationRoutingConfigSchema`
  // (lib/shared/schemas/governance.ts).
  'conversation_routing',
  // Which model transcribes images for a text-only harness (the vision
  // polyfill). Missing row ⇒ automatic selection. Config shape:
  // `visionModelConfigSchema` (lib/shared/schemas/governance.ts).
  'vision_model',
  // Independent-review requirements for the task-review gate: reviewer must
  // differ from the run's driver and/or hold named competences. Missing row
  // ⇒ no extra requirement (today's behaviour). Config shape:
  // `reviewPolicyConfigSchema` (lib/shared/schemas/governance.ts); enforced
  // in `tasks/review_mutations.ts::respondToTaskReview`.
  'review_policy',
] as const;

// The org-level `run_code` package allowlist moved to the file-based governance
// policy `run_code` (`<org>/governance/run-code.json`, schema
// `runCodePolicyConfigSchema`). The legacy `orgPackagePolicy` table was dropped
// in migration 0.2.87/03; the absence of a file still means "all packages
// allowed". See `agent_tools/run_code_tool.ts` for the execution-time gate.
