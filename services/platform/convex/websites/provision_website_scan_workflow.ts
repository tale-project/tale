/**
 * Provision and publish a Website Scan workflow for a website.
 *
 * Model-layer helper invoked by internal.websites.internal_mutations.provisionWebsiteScanWorkflow.
 */

import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import { toConvexJsonRecord } from '../lib/type_cast_helpers';
import websiteScanWorkflow from '../predefined_workflows/website_scan';
import { toPredefinedWorkflowPayload } from '../workflows/definitions/types';

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

function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
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

  // Register website with crawler service for autonomous background scanning
  const crawlerUrl = process.env.CRAWLER_URL || 'http://localhost:8002';
  try {
    await fetch(`${crawlerUrl}/api/v1/websites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: websiteDomain,
        scan_interval: scanIntervalToSeconds(args.scanInterval),
      }),
    });
  } catch (e) {
    // Non-fatal: crawler registration can be retried on next scan
    console.warn('Failed to register website with crawler:', e);
  }

  const { schedule, timezone } = scanIntervalToCron(args.scanInterval);

  const rawVars = websiteScanWorkflow.workflowConfig.config?.variables;
  const templateVars = isRecord(rawVars) ? rawVars : {};

  const variables = toConvexJsonRecord({
    ...templateVars,
    organizationId: args.organizationId,
    websiteId: args.websiteId,
    websiteUrl,
    websiteDomain,
    scanInterval: args.scanInterval,
  });

  const workflowName = `Website Scan - ${websiteDomain}`;

  // Use toPredefinedWorkflowPayload to handle type bridging from loose predefined workflow types
  const payload = toPredefinedWorkflowPayload(
    websiteScanWorkflow,
    {
      name: workflowName,
      config: {
        ...websiteScanWorkflow.workflowConfig.config,
        variables,
      },
    },
    (step) =>
      step.stepType === 'start' || step.stepType === 'trigger'
        ? {
            ...step,
            config: {
              ...(isRecord(step.config) ? step.config : {}),
              type: 'scheduled',
              schedule,
              timezone,
            },
          }
        : step,
  );

  const saved = await ctx.runMutation(
    internal.wf_definitions.internal_mutations.provisionWorkflowWithSteps,
    {
      organizationId: args.organizationId,
      ...payload,
    },
  );

  // Newly created workflows start as drafts; publish immediately.
  await ctx.runMutation(
    internal.wf_definitions.internal_mutations.provisionPublishDraft,
    {
      wfDefinitionId: saved.workflowId,
      publishedBy: 'system',
      changeLog: 'Auto-created and published from website creation',
    },
  );

  // Register the schedule so the cron scanner picks up this workflow
  await ctx.runMutation(
    internal.workflows.triggers.internal_mutations.provisionSchedule,
    {
      organizationId: args.organizationId,
      workflowRootId: saved.workflowId,
      cronExpression: schedule,
      timezone,
      createdBy: 'system',
    },
  );

  const current = await ctx.runQuery(
    internal.websites.internal_queries.getWebsite,
    {
      websiteId: args.websiteId,
    },
  );
  const existingMeta = isRecord(current?.metadata) ? current.metadata : {};

  await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
    websiteId: args.websiteId,
    metadata: {
      ...existingMeta,
      workflowId: saved.workflowId,
    },
  });

  if (args.autoTriggerInitialScan === true) {
    await ctx.runMutation(internal.websites.internal_mutations.patchWebsite, {
      websiteId: args.websiteId,
      lastScannedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(
      300000,
      internal.workflow_engine.internal_mutations.startWorkflow,
      {
        organizationId: args.organizationId,
        wfDefinitionId: saved.workflowId,
        input: { websiteId: args.websiteId, domain: websiteDomain },
        triggeredBy: 'system',
        triggerData: {
          triggerType: 'system',
          reason: 'initial_website_scan',
          timestamp: Date.now(),
        },
      },
    );
  }
}
