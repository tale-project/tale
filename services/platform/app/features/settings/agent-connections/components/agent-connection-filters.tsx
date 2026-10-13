'use client';

import { Checkbox } from '@tale/ui/checkbox';
import { SegmentedControl } from '@tale/ui/segmented-control';

import { useT } from '@/lib/i18n/client';

import type { AgentConnectionsView } from '../types';

interface AgentConnectionFiltersProps {
  view: AgentConnectionsView;
  onViewChange: (view: AgentConnectionsView) => void;
}

/**
 * What an owner or admin chooses the list by: whose agents — their own or
 * everyone's — and whether the disconnected ones show too.
 */
export function AgentConnectionFilters({
  view,
  onViewChange,
}: AgentConnectionFiltersProps) {
  const { t } = useT('agentConnections');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl
        aria-label={t('list.viewLabel')}
        value={view.scope}
        onValueChange={(scope) => {
          if (scope === 'mine' || scope === 'everyone') {
            onViewChange({ ...view, scope });
          }
        }}
        options={[
          { value: 'mine', label: t('list.mine') },
          { value: 'everyone', label: t('list.everyone') },
        ]}
      />
      <Checkbox
        label={t('list.showDisconnected')}
        checked={view.ended}
        onCheckedChange={(checked) =>
          onViewChange({ ...view, ended: checked === true })
        }
      />
    </div>
  );
}
