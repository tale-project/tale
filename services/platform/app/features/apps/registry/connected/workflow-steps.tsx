'use client';

/**
 * Connected `WorkflowSteps` block — shows the complete process the app runs. Binds
 * the allowlisted `readWorkflow` action (one-shot; the definition is static) and
 * renders the workflow's steps as a numbered timeline with stage + role + type
 * badges. The live per-step view lives in the operator (RunList → Watch live).
 */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { GitBranch } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { Section } from './section';

export interface WorkflowStepsProps {
  title?: string;
  workflowSlug: string;
}

const STAGE_VARIANT: Record<
  string,
  'slate' | 'blue' | 'yellow' | 'green' | 'orange'
> = {
  intake: 'slate',
  work: 'blue',
  verify: 'yellow',
  review: 'orange',
  deliver: 'green',
};

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function extractSteps(result: unknown): Record<string, unknown>[] {
  if (
    isRecord(result) &&
    result.ok === true &&
    isRecord(result.config) &&
    Array.isArray(result.config.steps)
  ) {
    return result.config.steps.filter(isRecord);
  }
  return [];
}

export function WorkflowSteps({ title, workflowSlug }: WorkflowStepsProps) {
  const { t } = useT('apps');
  const read = useBoundAction('workflows/file_actions:readWorkflow', 'action');
  const readRef = useRef(read);
  readRef.current = read;

  const [steps, setSteps] = useState<Record<string, unknown>[]>([]);
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
        if (!cancelled) setSteps(extractSteps(result));
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

  return (
    <Section title={title} icon={GitBranch}>
      {error ? (
        <Text variant="error">{t('workflow.error', { error })}</Text>
      ) : loading && steps.length === 0 ? (
        <SkeletonText lines={4} />
      ) : steps.length === 0 ? (
        <Text variant="muted">{t('workflow.none')}</Text>
      ) : (
        <VStack gap={0}>
          {steps.map((step, i) => {
            const ui = isRecord(step.ui) ? step.ui : {};
            const stage = str(ui, 'stage');
            const role = str(step, 'role');
            const type = str(step, 'stepType');
            return (
              <HStack
                key={i}
                gap={3}
                className="items-center border-b py-2.5 last:border-b-0"
              >
                <div className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
                  {i + 1}
                </div>
                <Text as="span" className="min-w-0 flex-1 font-medium" truncate>
                  {str(step, 'name') || str(step, 'stepSlug')}
                </Text>
                {role && <Badge variant="blue">{role}</Badge>}
                {stage && (
                  <Badge variant={STAGE_VARIANT[stage] ?? 'slate'}>
                    {stage}
                  </Badge>
                )}
                {type && <Badge variant="outline">{type}</Badge>}
              </HStack>
            );
          })}
        </VStack>
      )}
    </Section>
  );
}
