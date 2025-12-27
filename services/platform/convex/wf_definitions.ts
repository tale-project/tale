/**
 * Workflow Definitions API - Thin wrappers around model functions
 */

import { v } from 'convex/values';
import {
  internalQuery,
  internalMutation,
  mutation,
  query,
} from './_generated/server';
import * as WfDefinitionsModel from './model/wf_definitions';
import * as WfStepDefsModel from './model/wf_step_defs';
import { normalizePaginationOptions, calculatePaginationMeta } from './lib/pagination';

// =============================================================================
// INTERNAL OPERATIONS
// =============================================================================

/**
 * Create new workflow (DEPRECATED - use createWorkflowDraft instead)
 */
export const createWorkflow = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    workflowType: v.optional(WfDefinitionsModel.workflowTypeValidator),
    config: v.optional(WfDefinitionsModel.workflowConfigValidator),
    createdBy: v.string(),
    autoCreateFirstStep: v.optional(v.boolean()),
  },
  returns: v.id('wfDefinitions'),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createWorkflow(ctx, args);
  },
});

/**
 * Create a new workflow (starts as draft v1)
 */
export const createWorkflowDraft = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    config: v.optional(WfDefinitionsModel.workflowConfigValidator),
    createdBy: v.string(),
    autoCreateFirstStep: v.optional(v.boolean()),
  },
  returns: v.id('wfDefinitions'),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createWorkflowDraft(ctx, args);
  },
});

/**
 * Get workflow definition by ID
 */
export const getWorkflow = internalQuery({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.getWorkflow(ctx, args.wfDefinitionId);
  },
});

/**
 * List workflows for organization
 */
export const listWorkflows = internalQuery({
  args: {
    organizationId: v.string(),
    status: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.listWorkflows(ctx, args);
  },
});

/**
 * Get workflow by organization and name
 */
export const getWorkflowByName = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.getWorkflowByName(ctx, args as any);
  },
});

/**
 * List all versions of a workflow
 */
export const listVersions = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.listVersions(ctx, args);
  },
});

/**
 * Get the active version of a workflow by name
 */
export const getActiveVersion = internalQuery({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.getActiveVersion(ctx, args);
  },
});

/**
 * PUBLIC: List all versions of a workflow
 */
export const listVersionsPublic = query({
  args: {
    organizationId: v.string(),
    name: v.string(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.listVersions(ctx, args);
  },
});

/**
 * Update workflow
 */
export const updateWorkflow = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    updates: WfDefinitionsModel.workflowUpdateValidator,
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.updateWorkflow(ctx, args);
  },
});
/**
 * PUBLIC: Update workflow
 */
export const updateWorkflowPublic = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    updates: WfDefinitionsModel.workflowUpdateValidator,
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.updateWorkflow(ctx, args);
  },
});

/**
 * Update workflow status
 */
export const updateWorkflowStatus = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    status: v.string(),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.updateWorkflowStatus(ctx, args);
  },
});
/**
 * PUBLIC: Update workflow status
 */
export const updateWorkflowStatusPublic = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    status: v.string(),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.updateWorkflowStatus(ctx, args);
  },
});

/**
 * PUBLIC: Publish draft as active version
 */
export const publishDraftPublic = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  returns: v.object({
    activeVersionId: v.id('wfDefinitions'),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.publishDraft(ctx, args);
  },
});

/**
 * PUBLIC: Create a draft workflow version from an active workflow
 */
export const createDraftFromActivePublic = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  returns: v.object({
    draftId: v.id('wfDefinitions'),
    isNewDraft: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createDraftFromActive(ctx, args);
  },
});

/**
 * Publish draft as active version
 */
export const publishDraft = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  returns: v.object({
    activeVersionId: v.id('wfDefinitions'),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.publishDraft(ctx, args);
  },
});

/**
 * Delete workflow
 */
export const deleteWorkflow = internalMutation({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.deleteWorkflow(ctx, args.wfDefinitionId);
  },
});
/**
 * PUBLIC: Delete workflow
 */
export const deleteWorkflowPublic = mutation({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.deleteWorkflow(ctx, args.wfDefinitionId);
  },
});

/**
 * Create a draft workflow version from an active workflow.
 */
export const createDraftFromActive = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  returns: v.object({
    draftId: v.id('wfDefinitions'),
    isNewDraft: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createDraftFromActive(ctx, args);
  },
});

/**
 * Duplicate a workflow definition and all of its steps.
 */
export const duplicateWorkflow = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    newName: v.optional(v.string()),
  },
  returns: v.id('wfDefinitions'),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.duplicateWorkflow(ctx, args);
  },
});
/**
 * PUBLIC: Duplicate a workflow definition and all of its steps.
 */
export const duplicateWorkflowPublic = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    newName: v.optional(v.string()),
  },
  returns: v.id('wfDefinitions'),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.duplicateWorkflow(ctx, args);
  },
});

/**
 * PUBLIC: Create a workflow definition and all of its steps.
 */
export const createWorkflowWithStepsPublic = mutation({
  args: {
    organizationId: v.string(),
    workflowConfig: v.object({
      name: v.string(),
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      workflowType: v.optional(WfDefinitionsModel.workflowTypeValidator),
      config: v.optional(v.any()),
    }),
    stepsConfig: v.array(
      v.object({
        stepSlug: v.string(),
        name: v.string(),
        stepType: WfStepDefsModel.stepTypeValidator,
        order: v.number(),
        config: v.any(),
        nextSteps: v.record(v.string(), v.string()),
      }),
    ),
  },
  returns: v.object({
    workflowId: v.id('wfDefinitions'),
    stepIds: v.array(v.id('wfStepDefs')),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createWorkflowWithSteps(ctx, args as any);
  },
});

/**
 * Create a workflow definition and all of its steps in a single operation.
 */
export const createWorkflowWithSteps = internalMutation({
  args: {
    organizationId: v.string(),
    workflowConfig: v.object({
      name: v.string(),
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      workflowType: v.optional(WfDefinitionsModel.workflowTypeValidator),
      config: v.optional(v.any()),
    }),
    stepsConfig: v.array(
      v.object({
        stepSlug: v.string(),
        name: v.string(),
        stepType: WfStepDefsModel.stepTypeValidator,
        order: v.number(),
        config: v.any(),
        nextSteps: v.record(v.string(), v.string()),
      }),
    ),
  },
  returns: v.object({
    workflowId: v.id('wfDefinitions'),
    stepIds: v.array(v.id('wfStepDefs')),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createWorkflowWithSteps(ctx, args as any);
  },
});

/**
 * Update a draft workflow and replace all of its steps.
 */
export const saveWorkflowWithSteps = internalMutation({
  args: {
    organizationId: v.string(),
    workflowId: v.id('wfDefinitions'),
    workflowConfig: v.object({
      description: v.optional(v.string()),
      version: v.optional(v.string()),
      workflowType: v.optional(WfDefinitionsModel.workflowTypeValidator),
      config: v.optional(v.any()),
    }),
    stepsConfig: v.array(
      v.object({
        stepSlug: v.string(),
        name: v.string(),
        stepType: WfStepDefsModel.stepTypeValidator,
        order: v.number(),
        config: v.any(),
        nextSteps: v.record(v.string(), v.string()),
      }),
    ),
  },
  returns: v.object({
    workflowId: v.id('wfDefinitions'),
    stepIds: v.array(v.id('wfStepDefs')),
  }),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.saveWorkflowWithSteps(ctx, args as any);
  },
});

/**
 * List workflows with best version per name.
 */
export const listWorkflowsWithBestVersion = internalQuery({
  args: {
    organizationId: v.string(),
    status: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.listWorkflowsWithBestVersion(ctx, args);
  },
});

/**
 * PUBLIC API: Check if organization has any automations (fast count query for empty state detection)
 */
export const hasAutomations = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const firstAutomation = await ctx.db
      .query('wfDefinitions')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .first();
    return firstAutomation !== null;
  },
});

/**
 * PUBLIC API: Get workflow by ID
 */
export const getWorkflowPublic = query({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.getWorkflow(ctx, args.wfDefinitionId);
  },
});

/**
 * PUBLIC API: List workflows with best version per name
 * Supports optional search filtering by name and description.
 */
export const listWorkflowsWithBestVersionPublic = query({
  args: {
    organizationId: v.string(),
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.listWorkflowsWithBestVersion(ctx, args);
  },
});

/**
 * PUBLIC API: List automations with offset-based pagination
 * Uses best version per name with search and status filtering.
 */
export const listAutomations = query({
  args: {
    organizationId: v.string(),
    currentPage: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    searchTerm: v.optional(v.string()),
    status: v.optional(v.array(v.string())),
    sortField: v.optional(v.string()),
    sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
  },
  returns: v.object({
    items: v.array(v.any()),
    total: v.number(),
    page: v.number(),
    pageSize: v.number(),
    totalPages: v.number(),
    hasNextPage: v.boolean(),
    hasPreviousPage: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const { page: currentPage, pageSize } = normalizePaginationOptions({
      page: args.currentPage,
      pageSize: args.pageSize,
    });

    // Get all workflows with best version (filtered by search if provided)
    const allWorkflows = await WfDefinitionsModel.listWorkflowsWithBestVersion(ctx, {
      organizationId: args.organizationId,
      search: args.searchTerm,
    });

    // Apply status filter if provided
    const statusSet = args.status && args.status.length > 0 ? new Set(args.status) : null;
    const filteredWorkflows = statusSet
      ? allWorkflows.filter((wf) => statusSet.has(wf.status))
      : allWorkflows;

    const total = filteredWorkflows.length;
    const { totalPages, hasNextPage, hasPreviousPage } = calculatePaginationMeta(
      total,
      currentPage,
      pageSize,
    );

    // Apply sorting
    const sortField = args.sortField || '_creationTime';
    const sortOrder = args.sortOrder || 'desc';
    filteredWorkflows.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortField];
      const bVal = (b as Record<string, unknown>)[sortField];
      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;
      const comparison = aVal < bVal ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Paginate
    const startIndex = (currentPage - 1) * pageSize;
    const items = filteredWorkflows.slice(startIndex, startIndex + pageSize);

    return {
      items,
      total,
      page: currentPage,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };
  },
});

/**
 * PUBLIC API: Create draft workflow
 */
export const createWorkflowDraftPublic = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    config: v.optional(WfDefinitionsModel.workflowConfigValidator),
    createdBy: v.string(),
    autoCreateFirstStep: v.optional(v.boolean()),
  },
  returns: v.id('wfDefinitions'),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.createWorkflowDraft(ctx, args);
  },
});

/**
 * PUBLIC API: Update workflow metadata only
 */
export const updateWorkflowMetadata = mutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    metadata: v.any(),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await WfDefinitionsModel.updateWorkflow(ctx, {
      wfDefinitionId: args.wfDefinitionId,
      updates: {
        metadata: args.metadata,
      },
      updatedBy: args.updatedBy,
    });
  },
});
