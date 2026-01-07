/**
 * Provision and publish a Website Scan workflow for a website.
 *
 * Model-layer helper invoked by internal.websites.provisionWebsiteScanWorkflow.
 */

import type { ActionCtx } from '../../_generated/server';
import type { Id } from '../../_generated/dataModel';
import { api, internal } from '../../_generated/api';
import websiteScanWorkflow from '../../predefined_workflows/website_scan';
import { toPredefinedWorkflowPayload } from '../wf_definitions/types';

export interface ProvisionWebsiteScanWorkflowArgs {
  organizationId: string;
  websiteId: Id<'websites'>;
  domain: string;
  scanInterval: string;
  autoTriggerInitialScan?: boolean;
}

function scanIntervalToCron(interval: string): {
  schedule: string;
  timezone: string;
} {
  const timezone = 'UTC';
  switch (interval) {
    case '60m':
      return { schedule: '0 * * * *', timezone };
    case '6h':
      return { schedule: '0 */6 * * *', timezone };
    case '12h':
      return { schedule: '0 */12 * * *', timezone };
    case '1d':
      return { schedule: '0 2 * * *', timezone };
    case '5d':
      return { schedule: '0 2 */5 * *', timezone };
    case '7d':
      return { schedule: '0 2 */7 * *', timezone };
    case '30d':
      return { schedule: '0 2 1 * *', timezone };
    default:
      return { schedule: '0 2 * * *', timezone };
  }
}

export async function provisionWebsiteScanWorkflow(
  ctx: ActionCtx,
  args: ProvisionWebsiteScanWorkflowArgs,
): Promise<void> {
  const ensureUrl = (s: string) =>
    s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;

  const u = new URL(ensureUrl(args.domain));
  const websiteUrl = `${u.protocol}//${u.host}${u.pathname || ''}`;
  const websiteDomain = u.hostname;

  const { schedule, timezone } = scanIntervalToCron(args.scanInterval);

  const templateVars =
    (websiteScanWorkflow.workflowConfig.config?.variables ||
      {}) as Record<string, unknown>;

  const variables: Record<string, unknown> = {
    ...templateVars,
    organizationId: args.organizationId,
    websiteUrl,
    websiteDomain,
    scanInterval: args.scanInterval,
  };

  const workflowName = `Website Scan - ${websiteDomain}`;

  // Use toPredefinedWorkflowPayload to handle type bridging from loose predefined workflow types
  const payload = toPredefinedWorkflowPayload(
    websiteScanWorkflow,
    {
      name: workflowName,
      config: {
        ...(websiteScanWorkflow.workflowConfig.config || {}),
        variables,
      },
    },
    (step) =>
      step.stepType === 'trigger'
        ? { ...step, config: { type: 'scheduled', schedule, timezone } }
        : step,
  );

  const saved = await ctx.runMutation(
    internal.wf_definitions.createWorkflowWithSteps,
    {
      organizationId: args.organizationId,
      ...payload,
    },
  );

  // Newly created workflows start as drafts; publish immediately.
  await ctx.runMutation(internal.wf_definitions.publishDraft, {
    wfDefinitionId: saved.workflowId,
    publishedBy: 'system',
    changeLog: 'Auto-created and published from website creation',
  });

  const current = await ctx.runQuery(internal.websites.getWebsiteInternal, {
    websiteId: args.websiteId,
  });
  const existingMeta =
    ((current?.metadata as Record<string, unknown> | undefined) ?? {}) as Record<
      string,
      unknown
    >;

  await ctx.runMutation(internal.websites.updateWebsiteInternal, {
    websiteId: args.websiteId,
    metadata: { ...existingMeta, workflowId: saved.workflowId },
  });

  if (args.autoTriggerInitialScan === true) {
    // Optimistically update the website's scanned time so the UI reflects
    // that an initial scan has been queued, similar to manual rescans.
    await ctx.runMutation(internal.websites.updateWebsiteInternal, {
      websiteId: args.websiteId,
    });

    await ctx.scheduler.runAfter(0, api.workflow.engine.startWorkflow, {
      organizationId: args.organizationId,
      wfDefinitionId: saved.workflowId,
      input: { websiteId: args.websiteId, domain: websiteDomain },
      triggeredBy: 'system',
      triggerData: {
        triggerType: 'system',
        reason: 'initial_website_scan',
        timestamp: Date.now(),
      },
    });
  }
}

