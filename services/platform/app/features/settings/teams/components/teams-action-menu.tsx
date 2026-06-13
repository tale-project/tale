'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { useT } from '@/lib/i18n/client';

import { TeamCreateDialog } from './team-create-dialog';

interface TeamsActionMenuProps {
  organizationId: string;
  /** Optionally lift create-dialog state so the list's empty-state CTA can open it. */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
}

export function TeamsActionMenu({
  organizationId,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
}: TeamsActionMenuProps) {
  const { t: tSettings } = useT('settings');
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  // Controlled only when BOTH props are present. A lone `createOpen` would be
  // read for rendering while writes still hit internal state — a dead path
  // where clicks update state that no longer controls the dialog.
  const controlled =
    controlledCreateOpen !== undefined && onCreateOpenChange !== undefined;
  const isCreateDialogOpen = controlled
    ? (controlledCreateOpen ?? false)
    : internalCreateOpen;
  const setIsCreateDialogOpen = controlled
    ? (onCreateOpenChange ?? setInternalCreateOpen)
    : setInternalCreateOpen;

  return (
    <>
      <DataTableActionMenu
        label={tSettings('teams.createTeam')}
        icon={Plus}
        onClick={() => setIsCreateDialogOpen(true)}
      />
      <TeamCreateDialog
        organizationId={organizationId}
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </>
  );
}
