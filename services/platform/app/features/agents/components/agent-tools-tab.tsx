'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import { useCapabilityCatalog } from '../hooks/queries';
import { useAgentTab } from '../hooks/use-agent-tab';
import { AgentTabShell } from './agent-tab-shell';
import {
  AllowlistEditor,
  allowlistModeOf,
  allowlistValueFor,
  type AllowlistMode,
  type AllowlistOption,
} from './allowlist-editor';

/**
 * The agent's capability allowlist over the org's live catalog — the exact
 * registry a turn can reach (deployed automations today; integrations, MCP
 * tools and builtins appear as their registrations land). Ids in the file but
 * not in today's catalog stay visible as "kept" so a save never silently
 * drops them.
 */
export function AgentToolsTab({
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
  const catalogQuery = useCapabilityCatalog(organizationId);

  const [mode, setMode] = useState<AllowlistMode | null>(null);
  const [selected, setSelected] = useState(new Set<string>());

  useEffect(() => {
    if (agent && mode === null) {
      setMode(allowlistModeOf(agent.tools));
      setSelected(new Set(agent.tools ?? []));
    }
  }, [agent, mode]);

  const options = useMemo<AllowlistOption[]>(() => {
    const catalog = catalogQuery.data ?? [];
    const known = new Set(catalog.map((capability) => capability.id));
    const fromCatalog = catalog.map((capability) => ({
      id: capability.id,
      label: capability.id,
      description: capability.description,
    }));
    const kept = [...selected]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: id, unknown: true }));
    return [...fromCatalog, ...kept];
  }, [catalogQuery.data, selected]);

  return (
    <AgentTabShell
      isPending={agentQuery.isPending}
      isError={agentQuery.isError}
      missing={!agentQuery.isPending && !agentQuery.isError && agent == null}
    >
      {!canEdit && <Alert description={t('agents.readOnly')} />}
      <Stack gap={3}>
        <Text as="p" variant="muted" className="text-sm">
          {t('agents.form.sectionToolsDescription')}
        </Text>
        {catalogQuery.isError && (
          <Alert
            variant="destructive"
            description={t('agents.catalogFailed')}
          />
        )}
        <AllowlistEditor
          mode={mode ?? 'all'}
          onModeChange={setMode}
          options={options}
          selected={selected}
          onToggle={(id, checked) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          labelKeyPrefix="tools"
          emptyCatalogText={t('agents.allowlist.emptyCatalog')}
          disabled={!canEdit || catalogQuery.isPending}
        />
        {canEdit && (
          <Row gap={2} justify="end">
            <Button
              disabled={saving || mode === null}
              onClick={() =>
                void save({
                  tools: allowlistValueFor(mode ?? 'all', [...selected]),
                })
              }
            >
              {saving ? tCommon('actions.saving') : tCommon('actions.save')}
            </Button>
          </Row>
        )}
      </Stack>
    </AgentTabShell>
  );
}
