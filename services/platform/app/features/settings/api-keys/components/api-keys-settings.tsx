'use client';

import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { useApiKeys } from '../hooks/use-api-keys';
import { ApiKeyCreateDialog } from './api-key-create-dialog';
import { ApiKeyTable } from './api-key-table';

interface ApiKeysSettingsProps {
  organizationId: string;
}

export function ApiKeysSettings({ organizationId }: ApiKeysSettingsProps) {
  const { t: tSettings } = useT('settings');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: apiKeys, isLoading } = useApiKeys(organizationId);

  return (
    <Stack>
      <Stack gap={1}>
        <h2 className="text-foreground text-base font-semibold">
          {tSettings('apiKeys.title')}
        </h2>
        <p className="text-muted-foreground text-sm tracking-[-0.084px]">
          {tSettings('apiKeys.description')}{' '}
          <Link
            to="/docs"
            target="_blank"
            className="text-foreground hover:underline"
          >
            {tSettings('apiDocs.openDocs')}
          </Link>
        </p>
      </Stack>

      <HStack justify="end" className="pt-4">
        <Button
          size="sm"
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="mr-2 size-4" />
          {tSettings('apiKeys.createKey')}
        </Button>
      </HStack>

      <ApiKeyTable
        apiKeys={apiKeys || []}
        isLoading={isLoading}
        organizationId={organizationId}
      />

      <ApiKeyCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        organizationId={organizationId}
      />
    </Stack>
  );
}
