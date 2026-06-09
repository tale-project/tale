'use client';

import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { PageSection } from '@tale/ui/page-section';
import { SectionHeader } from '@tale/ui/section-header';
import { useCallback } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { useT } from '@/lib/i18n/client';
import type { ResponseTuningConfig } from '@/lib/shared/schemas/agents';

import { useAgentConfig } from '../hooks/use-agent-config-context';

interface AgentResponseTuningProps {
  organizationId: string;
  agentId: string;
}

// Typed option lists — also used to narrow RadioGroup's `string` callback value
// back to the literal union WITHOUT an unsafe cast (`find` returns the literal).
const EFFORT = ['adaptive', 'low', 'medium', 'high'] as const;
const CREATIVITY = ['adaptive', 'precise', 'balanced', 'creative'] as const;
const STYLE = [
  'adaptive',
  'concise',
  'detailed',
  'formal',
  'friendly',
] as const;
const VERBOSITY = ['adaptive', 'terse', 'normal', 'verbose'] as const;
const QUALITY = ['lenient', 'balanced', 'strict'] as const;
const BOUND = ['off', 'low', 'medium', 'high'] as const;

function narrow<T extends string>(
  value: string,
  allowed: readonly T[],
): T | undefined {
  return allowed.find((a) => a === value);
}

const cap = (v: string) => `${v.charAt(0).toUpperCase()}${v.slice(1)}`;

export function AgentResponseTuning(_props: AgentResponseTuningProps) {
  const { t } = useT('settings');
  const { config, updateConfig } = useAgentConfig();
  const tuning: ResponseTuningConfig = config.responseTuning ?? {};

  const patch = useCallback(
    (next: Partial<ResponseTuningConfig>) => {
      // Functional update so each field merges onto the LATEST responseTuning,
      // not a render-closure snapshot — two fields committing in the same tick
      // can't stomp each other.
      updateConfig((prev) => ({
        responseTuning: { ...prev.responseTuning, ...next },
      }));
    },
    [updateConfig],
  );

  const k = (suffix: string) => t(`agents.responseTuning.${suffix}`);
  const opt = (values: readonly string[], keyOf: (v: string) => string) =>
    values.map((value) => ({ value, label: k(keyOf(value)) }));

  // The four primary controls each map a value to its i18n label key: the
  // `adaptive`/`off` sentinels have their own key, the rest are `<field><Cap>`.
  const labelKey = (field: string) => (v: string) =>
    v === 'adaptive' ? 'adaptive' : `${field}${cap(v)}`;
  const boundKey = (v: string) =>
    v === 'off' ? 'boundNone' : `effort${cap(v)}`;

  return (
    <ContentArea variant="narrow" gap={6}>
      <SectionHeader title={k('title')} description={k('autoNote')} />

      {/* The Auto router and adaptive reasoning governor handle these per
          message; everything here is an optional override, collapsed by default
          so the common (fully-automatic) case stays uncluttered. */}
      <CollapsibleDetails summary={k('overridesSummary')}>
        <div className="mt-4 flex flex-col gap-6">
          <RadioGroup
            label={k('effort')}
            description={k('effortHelp')}
            value={tuning.effort ?? 'adaptive'}
            onValueChange={(v) => patch({ effort: narrow(v, EFFORT) })}
            options={opt(EFFORT, labelKey('effort'))}
          />

          <RadioGroup
            label={k('creativity')}
            description={k('creativityHelp')}
            value={tuning.creativity ?? 'adaptive'}
            onValueChange={(v) => patch({ creativity: narrow(v, CREATIVITY) })}
            options={opt(CREATIVITY, labelKey('creativity'))}
          />

          <RadioGroup
            label={k('style')}
            description={k('styleHelp')}
            value={tuning.style ?? 'adaptive'}
            onValueChange={(v) => patch({ style: narrow(v, STYLE) })}
            options={opt(STYLE, labelKey('style'))}
          />

          <RadioGroup
            label={k('verbosity')}
            description={k('verbosityHelp')}
            value={tuning.verbosity ?? 'adaptive'}
            onValueChange={(v) => patch({ verbosity: narrow(v, VERBOSITY) })}
            options={opt(VERBOSITY, labelKey('verbosity'))}
          />

          <PageSection
            as="h3"
            titleSize="sm"
            titleWeight="medium"
            title={k('advancedTitle')}
            description={k('advancedHelp')}
            gap={4}
          >
            <RadioGroup
              label={k('qualityProfile')}
              description={k('qualityProfileHelp')}
              value={tuning.qualityProfile ?? 'balanced'}
              onValueChange={(v) =>
                patch({ qualityProfile: narrow(v, QUALITY) })
              }
              options={opt(QUALITY, (v) => `quality${cap(v)}`)}
            />

            <div className="grid grid-cols-2 gap-3">
              <RadioGroup
                label={k('effortFloor')}
                description={k('effortFloorHelp')}
                value={tuning.effortFloor ?? 'off'}
                onValueChange={(v) => {
                  const b = narrow(v, BOUND);
                  patch({ effortFloor: b === 'off' ? undefined : b });
                }}
                options={opt(BOUND, boundKey)}
              />
              <RadioGroup
                label={k('effortCeiling')}
                description={k('effortCeilingHelp')}
                value={tuning.effortCeiling ?? 'off'}
                onValueChange={(v) => {
                  const b = narrow(v, BOUND);
                  patch({ effortCeiling: b === 'off' ? undefined : b });
                }}
                options={opt(BOUND, boundKey)}
              />
            </div>
          </PageSection>
        </div>
      </CollapsibleDetails>
    </ContentArea>
  );
}
