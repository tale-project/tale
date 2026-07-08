'use client';

import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { Select } from '@/app/components/ui/forms/select';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';

import type {
  AgentAuthMode,
  AgentReadiness,
} from '../../hooks/use-automation-agent-readiness';

/**
 * One wizard step that lets the user pick each external agent's auth mode —
 * MANAGED (the platform routes its LLM calls via the org's provider key) vs BYO
 * (the agent brings its own credential). The choice decides which downstream
 * step the agent gets (a provider connect vs a secrets entry); it's persisted to
 * the org's copied agent config so the runtime honors it.
 */
export function AuthModeStep({
  externalAgents,
  modeChoices,
  onChange,
}: {
  externalAgents: AgentReadiness[];
  modeChoices: Record<string, AgentAuthMode>;
  onChange: (agentSlug: string, mode: AgentAuthMode) => void;
}) {
  const { t } = useT('automations');
  return (
    <WizardStep id="auth-mode" valid>
      <VStack gap={4}>
        <Text variant="muted" className="text-sm">
          {t('installWizard.authModeDescription')}
        </Text>
        {externalAgents.map((a) => (
          <HStack
            key={a.agentSlug}
            gap={3}
            className="items-center justify-between"
          >
            <div className="min-w-0 flex-1">
              <Select
                id={`mode-${a.agentSlug}`}
                label={a.displayName}
                options={[
                  {
                    value: 'managed',
                    label: t('installWizard.authModeManaged'),
                  },
                  { value: 'byo', label: t('installWizard.authModeByo') },
                ]}
                value={modeChoices[a.agentSlug] ?? 'managed'}
                onValueChange={(v) => {
                  if (v === 'managed' || v === 'byo') {
                    onChange(a.agentSlug, v);
                  }
                }}
              />
            </div>
          </HStack>
        ))}
      </VStack>
    </WizardStep>
  );
}
