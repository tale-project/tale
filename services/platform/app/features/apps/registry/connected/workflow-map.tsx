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
import { useEffect, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  isRenderKind,
  type RenderKind,
} from '@/lib/shared/platform/render_kinds';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
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

// Step types that are pure structure, not process the user cares to see.
const STRUCTURAL_TYPES = new Set(['start', 'trigger', 'output']);
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
    if (STRUCTURAL_TYPES.has(str(raw, 'stepType'))) continue;
    const ui = isRecord(raw.ui) ? raw.ui : {};
    const renderRaw = str(ui, 'render');
    const step: MapStep = {
      slug: str(raw, 'stepSlug'),
      label: str(raw, 'name') || str(raw, 'stepSlug'),
      // Graceful degradation mirrors the operator: unknown/absent → `status`.
      render: isRenderKind(renderRaw) ? renderRaw : 'status',
      stage: str(ui, 'stage') || NO_STAGE,
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
  const Icon = RENDER_ICON[step.render];
  return (
    <Card className="w-full lg:w-56">
      <VStack gap={2}>
        <HStack gap={2} className="items-start">
          <div className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
            <Icon className="size-4" />
          </div>
          <VStack gap={0} className="min-w-0">
            <Text as="span" className="text-sm leading-snug font-medium">
              {packLabel(step.labelKey, step.label)}
            </Text>
            <Text variant="muted" className="text-xs">
              {t(`process.kind.${step.render}`, { defaultValue: step.render })}
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
  const read = useBoundAction('workflows/file_actions:readWorkflow', 'action');
  const readRef = useRef(read);
  readRef.current = read;

  const [steps, setSteps] = useState<MapStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await readRef.current.dispatch({
          organizationId: '$orgId',
          workflowSlug,
        });
        if (!cancelled) setSteps(projectSteps(result));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workflowSlug]);

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
      {error ? (
        <Text variant="error">{t('workflow.error', { error })}</Text>
      ) : loading && steps.length === 0 ? (
        <SkeletonText lines={4} />
      ) : steps.length === 0 ? (
        <Text variant="muted">{t('workflow.none')}</Text>
      ) : (
        <WorkflowMapBody steps={steps} />
      )}
    </Section>
  );
}
