# Workflow Version Management (Minimal)

## Overview

- Lifecycle: Draft (mutable) → Active (immutable) → Archived (history)
- Publish promotes Draft → Active and automatically creates a new Draft (next version)
- Rollback re-activates a historical version and creates a new Draft from it

## Public API (one file, one function)

- create_workflow.ts → createWorkflow (mutation)
- update_workflow_draft.ts → updateWorkflowDraft (mutation)
- publish_workflow.ts → publishWorkflow (mutation)
- rollback_to_version.ts → rollbackToVersion (mutation)
- get_workflow_draft.ts → getWorkflowDraft (query)
- get_active_workflow.ts → getActiveWorkflow (query)
- get_workflow_version.ts → getWorkflowVersion (query)
- list_workflow_versions.ts → listWorkflowVersions (query)

## Naming principles

- One function per file
- File in snake_case; function in camelCase
- File name corresponds to function name

## Quick usage

```ts
// 1) Create draft
const draftId = await convex.mutation(
  api.wf_definitions.createWorkflowDraft,
  args,
);
// 2) Publish draft → Active + new Draft
const r = await convex.mutation(api.wf_definitions.publishDraft, {
  wfDefinitionId: draftId,
  publishedBy: 'you',
});
// 3) Read active
const active = await convex.query(api.wf_definitions.getActiveVersion, {
  organizationId,
  workflowKey,
});
```
