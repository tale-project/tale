'use client';

import { Button } from '@tale/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';

import { ProvidersTable } from './providers-table';

interface ProvidersSettingsSectionProps {
  organizationId: string;
  initialDetailProvider?: string;
}

export function ProvidersSettingsSection({
  organizationId,
  initialDetailProvider,
}: ProvidersSettingsSectionProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return (
    <SettingsSection
      title={tNav('providers')}
      description={tSettings('menu.providers.description')}
      action={
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-1.5 size-4" />
          {tSettings('providers.addProvider')}
        </Button>
      }
    >
      <ProvidersTable
        organizationId={organizationId}
        initialDetailProvider={initialDetailProvider}
        addDialogOpen={addDialogOpen}
        onAddDialogOpenChange={setAddDialogOpen}
      />
    </SettingsSection>
  );
}
