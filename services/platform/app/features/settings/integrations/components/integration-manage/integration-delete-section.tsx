'use client';

import { Trash2 } from 'lucide-react';

import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface IntegrationDeleteSectionProps {
  confirmDelete: boolean;
  busy: boolean;
  onDelete: () => void;
  onConfirmToggle: (confirm: boolean) => void;
}

export function IntegrationDeleteSection({
  confirmDelete,
  busy,
  onDelete,
  onConfirmToggle,
}: IntegrationDeleteSectionProps) {
  const { t } = useT('settings');

  return (
    <Stack gap={3} className="border-border rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">
        {t('integrations.manageDialog.deleteDescription')}
      </p>
      {confirmDelete ? (
        <HStack gap={2}>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={busy}
            className="flex-1"
          >
            <Trash2 className="mr-1 size-3.5" />
            {t('integrations.manageDialog.confirmDelete')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onConfirmToggle(false)}
            disabled={busy}
            className="flex-1"
          >
            {t('integrations.manageDialog.cancelDelete')}
          </Button>
        </HStack>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onConfirmToggle(true)}
          disabled={busy}
          className="text-destructive hover:text-destructive w-full"
        >
          <Trash2 className="mr-1 size-3.5" />
          {t('integrations.manageDialog.deleteIntegration')}
        </Button>
      )}
    </Stack>
  );
}
