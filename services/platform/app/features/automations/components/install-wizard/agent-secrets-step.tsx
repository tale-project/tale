'use client';

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import type { TokenSourceOption } from '@/app/components/env/env-var-list-editor';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import { Select } from '@/app/components/ui/forms/select';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import type { AgentReadiness } from '../../hooks/use-automation-agent-readiness';

export type EnvValueKind = 'value' | 'secret' | 'token-source';

export interface KeyDraft {
  type: EnvValueKind;
  value: string;
  tokenSourceSlug?: string;
}

/** Maps a wizard row draft to `setAgentEnvVar` args, or null when nothing to write. */
export function buildAgentEnvSetArgs(draft: KeyDraft): {
  value: string;
  isSecret: boolean;
  tokenSourceSlug?: string;
} | null {
  if (draft.type === 'token-source') {
    if (draft.tokenSourceSlug === undefined) return null;
    return {
      value: '',
      isSecret: true,
      tokenSourceSlug: draft.tokenSourceSlug,
    };
  }
  const value = draft.value.trim();
  if (!value) return null;
  return { value, isSecret: draft.type === 'secret' };
}

function defaultDraft(secret: boolean): KeyDraft {
  return { type: secret ? 'secret' : 'value', value: '' };
}

/**
 * One wizard step that sets a BYO agent's declared secrets/env. Reads the
 * agent's env store reactively to gate validity (all declared keys present) and
 * writes through `setAgentEnvVar` (encrypt-on-save for secrets; optional
 * token-source binding when the org has brokers). Skippable; the
 * automation-page readiness checklist remains the fallback.
 */
export function AgentSecretsStep({
  agent,
  organizationId,
}: {
  agent: AgentReadiness;
  organizationId: string;
}) {
  const { t } = useT('automations');
  const { t: te } = useT('envEditor');
  const envQuery = useConvexQuery(api.agents.agent_env.listAgentEnv, {
    organizationId,
    agentSlug: agent.agentSlug,
  });
  const setKeys = new Set(
    ((envQuery.data as Array<{ key: string }> | undefined) ?? []).map(
      (r) => r.key,
    ),
  );
  const { data: tokenSources } = useActionQuery(
    configKeys.list('token-sources', organizationId),
    api.token_sources.file_actions.listTokenSources,
    { organizationId },
    { enabled: !!organizationId },
  );
  const sources = (tokenSources ?? []) as TokenSourceOption[];
  const hasSources = sources.length > 0;
  const { mutateAsync: setVar, isPending } = useConvexAction(
    api.agents.agent_env_actions.setAgentEnvVar,
  );
  const [drafts, setDrafts] = useState<Record<string, KeyDraft>>({});

  const declared = agent.requiredEnv;
  const allSet = declared.every((d) => setKeys.has(d.key));

  const draftFor = (key: string, secret: boolean): KeyDraft =>
    drafts[key] ?? defaultDraft(secret);

  const patch = (key: string, secret: boolean, p: Partial<KeyDraft>): void => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { ...defaultDraft(secret), ...prev[key], ...p },
    }));
  };

  const hasInput = declared.some((d) => {
    const draft = draftFor(d.key, d.secret);
    return buildAgentEnvSetArgs(draft) !== null;
  });

  const save = async () => {
    for (const d of declared) {
      const args = buildAgentEnvSetArgs(draftFor(d.key, d.secret));
      if (args === null) continue;
      await setVar({
        organizationId,
        agentSlug: agent.agentSlug,
        key: d.key,
        value: args.value,
        isSecret: args.isSecret,
        ...(args.tokenSourceSlug !== undefined && {
          tokenSourceSlug: args.tokenSourceSlug,
        }),
      });
    }
    setDrafts({});
  };

  const onTypeChange = (key: string, secret: boolean, v: string): void => {
    if (!v) return;
    if (v === 'value') {
      patch(key, secret, {
        type: 'value',
        tokenSourceSlug: undefined,
        value: '',
      });
    } else if (v === 'secret') {
      patch(key, secret, {
        type: 'secret',
        tokenSourceSlug: undefined,
        value: '',
      });
    } else if (v === 'token-source') {
      const firstSlug = sources[0]?.slug;
      if (firstSlug !== undefined) {
        patch(key, secret, {
          type: 'token-source',
          tokenSourceSlug: firstSlug,
          value: '',
        });
      }
    }
  };

  return (
    <WizardStep id={`agent-env-${agent.agentSlug}`} valid={allSet}>
      <VStack gap={4}>
        <Text variant="muted" className="text-sm">
          {t('installWizard.agentNeedsKeys', { name: agent.displayName })}
        </Text>
        {declared.map((d) => {
          const draft = draftFor(d.key, d.secret);
          const isBinding = draft.type === 'token-source';
          const fieldId = `env-${agent.agentSlug}-${d.key}`;
          const descriptionId = `${fieldId}-description`;

          if (!hasSources) {
            return (
              <Input
                key={d.key}
                id={fieldId}
                label={d.key}
                type={d.secret ? 'password' : 'text'}
                placeholder={setKeys.has(d.key) ? '••••••••' : ''}
                {...(d.description !== undefined && {
                  description: d.description,
                })}
                value={draft.value}
                onChange={(e) =>
                  patch(d.key, d.secret, {
                    type: d.secret ? 'secret' : 'value',
                    value: e.target.value,
                  })
                }
              />
            );
          }

          // Stack type + value/source full-width — side-by-side selects read
          // cramped in the wizard modal (narrower than the agent Environment tab).
          return (
            <div key={d.key} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>{d.key}</Label>
              <Select
                aria-label={te('valueType')}
                disabled={isPending}
                value={draft.type}
                options={[
                  { value: 'value', label: te('typeValue') },
                  { value: 'secret', label: te('secret') },
                  { value: 'token-source', label: te('typeTokenSource') },
                ]}
                onValueChange={(v) => onTypeChange(d.key, d.secret, v)}
              />
              {isBinding ? (
                <Select
                  id={fieldId}
                  aria-label={te('typeTokenSource')}
                  disabled={isPending}
                  value={draft.tokenSourceSlug ?? ''}
                  options={sources.map((s) => ({
                    value: s.slug,
                    label: s.displayName,
                  }))}
                  onValueChange={(v) => {
                    if (v)
                      patch(d.key, d.secret, {
                        type: 'token-source',
                        tokenSourceSlug: v,
                      });
                  }}
                />
              ) : (
                <Input
                  id={fieldId}
                  type={draft.type === 'secret' ? 'password' : 'text'}
                  placeholder={
                    setKeys.has(d.key) && !draft.value ? '••••••••' : ''
                  }
                  value={draft.value}
                  onChange={(e) =>
                    patch(d.key, d.secret, {
                      type: draft.type,
                      value: e.target.value,
                    })
                  }
                />
              )}
              {d.description !== undefined && (
                <Description id={descriptionId}>{d.description}</Description>
              )}
            </div>
          );
        })}
        <div className="flex justify-end pt-1">
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
