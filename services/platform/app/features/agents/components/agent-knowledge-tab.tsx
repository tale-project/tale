'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useState } from 'react';

import { RadioGroup } from '@/app/components/ui/forms/radio-group';
import { useT } from '@/lib/i18n/client';

import { useAgentTab } from '../hooks/use-agent-tab';
import { AgentTabShell } from './agent-tab-shell';

const KNOWLEDGE_SCOPES = ['all', 'documents', 'web', 'none'] as const;
type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/**
 * Which of the org's indexed knowledge this agent's retrieval may read — one
 * scope, not per-file bindings: the corpus is org-owned and tenant-scoped,
 * and an agent either reads a corpus or does not.
 */
export function AgentKnowledgeTab({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { agentQuery, agent, canEdit, save, saving } = useAgentTab(
    organizationId,
    slug,
  );

  const [scope, setScope] = useState<KnowledgeScope | null>(null);

  useEffect(() => {
    if (agent && scope === null) setScope(agent.knowledge);
  }, [agent, scope]);

  return (
    <AgentTabShell
      isPending={agentQuery.isPending}
      isError={agentQuery.isError}
      missing={!agentQuery.isPending && !agentQuery.isError && agent == null}
    >
      {!canEdit && <Alert description={t('agents.readOnly')} />}
      <Stack gap={3}>
        <Text as="p" variant="muted" className="text-sm">
          {t('agents.knowledgeScope.description')}
        </Text>
        <RadioGroup
          aria-label={t('agents.knowledgeScope.label')}
          value={scope ?? 'all'}
          onValueChange={(next) => {
            const match = KNOWLEDGE_SCOPES.find((value) => value === next);
            if (match) setScope(match);
          }}
          options={KNOWLEDGE_SCOPES.map((value) => ({
            value,
            label: t(`agents.knowledgeScope.${value}`),
            description: t(`agents.knowledgeScope.${value}Help`),
          }))}
          disabled={!canEdit}
        />
        {canEdit && (
          <Row gap={2} justify="end">
            <Button
              disabled={saving || scope === null}
              onClick={() => void save({ knowledge: scope ?? 'all' })}
            >
              {saving ? tCommon('actions.saving') : tCommon('actions.save')}
            </Button>
          </Row>
        )}
      </Stack>
    </AgentTabShell>
  );
}
