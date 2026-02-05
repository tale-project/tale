'use client';

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  EntityRowActions,
} from '@/app/components/ui/entity/entity-row-actions';
import { ApiKeyRevokeDialog } from './api-key-revoke-dialog';
import { useT } from '@/lib/i18n/client';
import type { ApiKey } from '../types';

interface ApiKeyRowActionsProps {
  apiKey: ApiKey;
  organizationId: string;
}

export function ApiKeyRowActions({ apiKey, organizationId }: ApiKeyRowActionsProps) {
  const { t: tSettings } = useT('settings');
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false);

  const actions = useMemo(
    () => [
      {
        key: 'revoke',
        label: tSettings('apiKeys.revokeKey'),
        icon: Trash2,
        onClick: () => setIsRevokeDialogOpen(true),
        destructive: true,
      },
    ],
    [tSettings],
  );

  return (
    <>
      <EntityRowActions actions={actions} />

      <ApiKeyRevokeDialog
        open={isRevokeDialogOpen}
        onOpenChange={setIsRevokeDialogOpen}
        apiKey={apiKey}
        organizationId={organizationId}
      />
    </>
  );
}
