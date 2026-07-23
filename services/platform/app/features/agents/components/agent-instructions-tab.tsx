'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useEffect, useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';
import { MAX_AGENT_INSTRUCTIONS_LENGTH } from '@/lib/shared/schemas/agents';

import { useAgentTab } from '../hooks/use-agent-tab';
import { AgentTabShell } from './agent-tab-shell';

/**
 * The agent's authored instructions — a markdown persona, nothing else. The
 * old tab's model picker, BYO credentials, and structured-response switches
 * are gone on purpose: an agent carries no model, and a turn's harness is
 * decided where the turn runs.
 */
export function AgentInstructionsTab({
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

  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (agent && draft === null) setDraft(agent.instructions ?? '');
  }, [agent, draft]);

  const overLimit = (draft?.length ?? 0) > MAX_AGENT_INSTRUCTIONS_LENGTH;

  return (
    <AgentTabShell
      isPending={agentQuery.isPending}
      isError={agentQuery.isError}
      missing={!agentQuery.isPending && !agentQuery.isError && agent == null}
    >
      {!canEdit && <Alert description={t('agents.readOnly')} />}
      <Stack gap={3}>
        <Stack gap={1}>
          <label htmlFor="agent-instructions" className="text-sm font-medium">
            {t('agents.form.systemInstructions')}
          </label>
          <Textarea
            id="agent-instructions"
            value={draft ?? ''}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!canEdit}
            rows={20}
            className="font-mono text-sm"
            placeholder={t('agents.form.systemInstructionsPlaceholder')}
            aria-invalid={overLimit}
            aria-describedby="agent-instructions-help"
          />
          <p
            id="agent-instructions-help"
            className={
              overLimit
                ? 'text-destructive text-xs'
                : 'text-muted-foreground text-xs'
            }
          >
            {t('agents.form.systemInstructionsCharCount', {
              count: draft?.length ?? 0,
            })}
            {' / '}
            {MAX_AGENT_INSTRUCTIONS_LENGTH}
          </p>
        </Stack>
        {canEdit && (
          <Row gap={2} justify="end">
            <Button
              disabled={saving || draft === null || overLimit}
              onClick={() => void save({ instructions: draft ?? '' })}
            >
              {saving ? tCommon('actions.saving') : tCommon('actions.save')}
            </Button>
          </Row>
        )}
      </Stack>
    </AgentTabShell>
  );
}
