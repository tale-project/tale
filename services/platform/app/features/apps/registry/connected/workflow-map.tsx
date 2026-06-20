'use client';

/**
 * Connected `WorkflowMap` block — a USER-FRIENDLY view of the process, driven by
 * each step's `ui` annotation (the same vocabulary the live operator renders):
 * steps grouped into `ui.stage` phases (intake → work → verify → review →
 * deliver), each shown with a `ui.render`-kind icon + plain-language kind label,
 * its name, and `role`. Structural endpoints (start/trigger/output) are hidden.
 *
 * This is deliberately NOT the automations editor's raw DAG (step slugs, type
 * badges, routing handles) — that engineering view lives behind "Open in
 * editor". Binds the allowlisted `readWorkflow` action (one-shot; static).
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Download,
  GitCompare,
  List,
  Package,
  Pencil,
  Scale,
  Shuffle,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

import { useReadWorkflow } from '@/app/features/automations/hooks/file-queries';
import { useT } from '@/lib/i18n/client';
import {
  isRenderKind,
  type RenderKind,
} from '@/lib/shared/platform/render_kinds';
import {
  isStepVisible,
  stepTreatment,
} from '@/lib/shared/platform/step_display';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useAppRuntime, usePackLabel } from '../../runtime/app-runtime';
import { Section } from './section';

export interface WorkflowMapProps {
  title?: string;
  workflowSlug: string;
}

// `ui.render` kind → a glyph that reads as the kind of work in plain terms
// (the kind's friendly label comes from i18n: process.kind.<kind>).
const RENDER_ICON: Record<RenderKind, LucideIcon> = {
  status: Activity,
  ingest: Download,
  transform: Shuffle,
  validation: CheckCircle2,
  reconciliation: Scale,
  diff: GitCompare,
  collection: List,
  artifact: Package,
  stream: Bot,
  review: UserCheck,
};

// Steps with no `ui.stage` collapse under one neutral bucket so they still show.
const NO_STAGE = '_';

interface MapStep {
  slug: string;
  /** The step's `name` — the fallback when no pack `labelKey` resolves. */
  label: string;
  /** Pack `ui.labelKey` (resolved against the app catalog at render). */
  labelKey?: string;
  render: RenderKind;
  stage: string;
  /** `gate` = a quiet decision checkpoint (the LLM judge); `normal` otherwise. */
  treatment: 'normal' | 'gate';
  role?: string;
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function projectSteps(result: unknown): MapStep[] {
  if (
    !isRecord(result) ||
    result.ok !== true ||
    !isRecord(result.config) ||
    !Array.isArray(result.config.steps)
  ) {
    return [];
  }
  const out: MapStep[] = [];
  for (const raw of result.config.steps) {
    if (!isRecord(raw)) continue;
    const stepType = str(raw, 'stepType');
    const hasUi = isRecord(raw.ui);
    const ui = hasUi && isRecord(raw.ui) ? raw.ui : {};
    const uiParams = isRecord(ui.params) ? ui.params : {};
    const display = str(uiParams, 'display') || undefined;
    const displayInput = { stepType, hasUi, ...(display && { display }) };
    // Pure plumbing (structural, routing conditions, status-bumps) collapses out
    // via the SHARED predicate so this map and the run view show the same spine.
    if (!isStepVisible(displayInput)) continue;
    const renderRaw = str(ui, 'render');
    const step: MapStep = {
      slug: str(raw, 'stepSlug'),
      label: str(raw, 'name') || str(raw, 'stepSlug'),
      // Graceful degradation mirrors the operator: unknown/absent → `status`.
      render: isRenderKind(renderRaw) ? renderRaw : 'status',
      stage: str(ui, 'stage') || NO_STAGE,
      treatment: stepTreatment(displayInput) === 'gate' ? 'gate' : 'normal',
    };
    const labelKey = str(ui, 'labelKey');
    if (labelKey) step.labelKey = labelKey;
    const role = str(raw, 'role');
    if (role) step.role = role;
    out.push(step);
  }
  return out;
}

/** Steps grouped into stages in first-appearance order (matches the operator). */
function groupByStage(steps: MapStep[]): { stage: string; steps: MapStep[] }[] {
  const order: string[] = [];
  const byStage = new Map<string, MapStep[]>();
  for (const s of steps) {
    if (!byStage.has(s.stage)) {
      byStage.set(s.stage, []);
      order.push(s.stage);
    }
    byStage.get(s.stage)?.push(s);
  }
  return order.map((stage) => ({ stage, steps: byStage.get(stage) ?? [] }));
}

function StepCard({ step }: { step: MapStep }) {
  const { t } = useT('apps');
  const packLabel = usePackLabel();
  const isGate = step.treatment === 'gate';
  // A decision checkpoint (the LLM judge) reads as a quiet gate, not a peer of
  // the agent-work cards.
  const Icon = isGate ? Scale : RENDER_ICON[step.render];
  return (
    <Card className={cn('w-full lg:w-56', isGate && 'bg-muted/30')}>
      <VStack gap={2}>
        <HStack gap={2} className="items-start">
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <VStack gap={0} className="min-w-0">
            <Text
              as="span"
              className={cn(
                'text-sm leading-snug font-medium',
                isGate && 'text-muted-foreground',
              )}
            >
              {packLabel(step.labelKey, step.label)}
            </Text>
            <Text variant="muted" className="text-xs">
              {isGate
                ? t('process.gate', { defaultValue: 'Decision' })
                : t(`process.kind.${step.render}`, {
                    defaultValue: step.render,
                  })}
            </Text>
          </VStack>
        </HStack>
        {step.role && (
          <Badge variant="blue" className="self-start">
            {step.role}
          </Badge>
        )}
      </VStack>
    </Card>
  );
}

function WorkflowMapBody({ steps }: { steps: MapStep[] }) {
  const { t } = useT('apps');
  const grouped = useMemo(() => groupByStage(steps), [steps]);

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-stretch">
      {grouped.map((group, i) => (
        <div key={group.stage} className="contents lg:flex lg:items-stretch">
          <VStack gap={2} className="lg:w-56">
            <Text
              as="span"
              variant="muted"
              className="text-xs font-semibold tracking-wide uppercase"
            >
              {group.stage === NO_STAGE
                ? t('process.stage.steps')
                : t(`process.stage.${group.stage}`, {
                    defaultValue: group.stage,
                  })}
            </Text>
            {group.steps.map((step) => (
              <StepCard key={step.slug} step={step} />
            ))}
          </VStack>
          {i < grouped.length - 1 && (
            <div
              className={cn(
                'text-muted-foreground flex shrink-0 items-center justify-center',
                'self-center py-1 lg:px-2 lg:py-0',
              )}
              aria-hidden
            >
              <ArrowRight className="hidden size-4 lg:block" />
              <ArrowRight className="size-4 rotate-90 lg:hidden" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function WorkflowMap({ title, workflowSlug }: WorkflowMapProps) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const navigate = useNavigate();
  // Reactive read (the SAME hook the run view uses) — loads from cache and
  // updates live, instead of a one-shot action that sits on a long skeleton.
  const read = useReadWorkflow(organizationId, workflowSlug);
  const steps = useMemo(() => projectSteps(read.data), [read.data]);

  const openEditor = useMemo(
    () => () =>
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId: workflowSlug },
      }),
    [navigate, organizationId, workflowSlug],
  );

  return (
    <Section
      title={title}
      icon={Activity}
      action={
        <Button size="sm" variant="secondary" onClick={openEditor}>
          <Pencil className="size-4" />
          {t('workflow.openEditor')}
        </Button>
      }
    >
      {read.error ? (
        <Text variant="error">
          {t('workflow.error', { error: read.error.message })}
        </Text>
      ) : read.isLoading && steps.length === 0 ? (
        <SkeletonText lines={4} />
      ) : steps.length === 0 ? (
        <Text variant="muted">{t('workflow.none')}</Text>
      ) : (
        <WorkflowMapBody steps={steps} />
      )}
    </Section>
  );
}
