'use client';

import { Button } from '@tale/ui/button';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import type { AgentReadiness } from '../../hooks/use-app-agent-readiness';

/**
 * One wizard step that sets a BYO agent's declared secrets/env. Reads the
 * agent's env store reactively to gate validity (all declared keys present) and
 * writes through `setAgentEnvVar` (encrypt-on-save for secrets). Skippable; the
 * app-page readiness checklist remains the fallback.
 */
export function AgentSecretsStep({
  agent,
  organizationId,
}: {
  agent: AgentReadiness;
  organizationId: string;
}) {
  const { t } = useT('apps');
  const envQuery = useConvexQuery(api.agents.agent_env.listAgentEnv, {
    organizationId,
    agentSlug: agent.agentSlug,
  });
  const setKeys = new Set(
    ((envQuery.data as Array<{ key: string }> | undefined) ?? []).map(
      (r) => r.key,
    ),
  );
  const { mutateAsync: setVar, isPending } = useConvexAction(
    api.agents.agent_env_actions.setAgentEnvVar,
  );
  const [values, setValues] = useState<Record<string, string>>({});

  const declared = agent.requiredEnv;
  const allSet = declared.every((d) => setKeys.has(d.key));
  const hasInput = declared.some(
    (d) => (values[d.key] ?? '').trim().length > 0,
  );

  const save = async () => {
    for (const d of declared) {
      const value = values[d.key]?.trim();
      if (!value) continue;
      await setVar({
        organizationId,
        agentSlug: agent.agentSlug,
        key: d.key,
        value,
        isSecret: d.secret,
      });
    }
    setValues({});
  };

  return (
    <WizardStep id={`agent-env-${agent.agentSlug}`} valid={allSet}>
      <VStack gap={3}>
        <Text variant="muted" className="text-sm">
          {t('installWizard.agentNeedsKeys', { name: agent.displayName })}
        </Text>
        {declared.map((d) => (
          <Input
            key={d.key}
            id={`env-${agent.agentSlug}-${d.key}`}
            label={d.key}
            type={d.secret ? 'password' : 'text'}
            placeholder={setKeys.has(d.key) ? '••••••••' : ''}
            {...(d.description !== undefined && { description: d.description })}
            value={values[d.key] ?? ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [d.key]: e.target.value }))
            }
          />
        ))}
        <div className="flex justify-end">
          <Button
            onClick={() => void save()}
            isLoading={isPending}
            disabled={isPending || !hasInput}
          >
            {t('installWizard.saveSecrets')}
          </Button>
        </div>
      </VStack>
    </WizardStep>
  );
}
