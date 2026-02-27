'use client';

import { Trash2 } from 'lucide-react';

import { ActionRow } from '@/app/components/ui/layout/action-row';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
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
    <BorderedSection>
      <Text variant="caption">
        {t('integrations.manageDialog.deleteDescription')}
      </Text>
      {confirmDelete ? (
        <ActionRow gap={2}>
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
        </ActionRow>
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
    </BorderedSection>
  );
}
