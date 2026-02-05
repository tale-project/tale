'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/app/components/ui/primitives/button';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { ApiKeyTable } from './api-key-table';
import { ApiKeyCreateDialog } from './api-key-create-dialog';
import { useApiKeys } from '../hooks/use-api-keys';

interface ApiKeysSettingsProps {
  organizationId: string;
}

export function ApiKeysSettings({ organizationId: _organizationId }: ApiKeysSettingsProps) {
  const { t: tSettings } = useT('settings');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: apiKeys, isLoading } = useApiKeys();

  return (
    <Stack>
      <Stack gap={1}>
        <h2 className="text-base font-semibold text-foreground">
          {tSettings('apiKeys.title')}
        </h2>
        <p className="text-sm text-muted-foreground tracking-[-0.084px]">
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
          <Plus className="size-4 mr-2" />
          {tSettings('apiKeys.createKey')}
        </Button>
      </HStack>

      <ApiKeyTable
        apiKeys={apiKeys || []}
        isLoading={isLoading}
      />

      <ApiKeyCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </Stack>
  );
}
