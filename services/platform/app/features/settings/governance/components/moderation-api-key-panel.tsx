'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { mapGovernanceSaveError } from '../governance-save-errors';
import { useSaveModerationSecret } from '../hooks/mutations';
import { useModerationSecretStatus } from '../hooks/queries';

interface ApiKeyPanelProps {
  organizationId: string;
  disabled: boolean;
}

export function ApiKeyPanel({ organizationId, disabled }: ApiKeyPanelProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { data: currentMask, isLoading } =
    useModerationSecretStatus(organizationId);
  const saveSecret = useSaveModerationSecret();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const handleSave = async () => {
    const value = draft.trim();
    if (value.length === 0) return;
    try {
      await saveSecret.mutateAsync({ organizationId, authHeader: value });
      toast({ title: t('moderationProvider.apiKeySaved'), variant: 'success' });
      setEditing(false);
      setDraft('');
    } catch (err) {
      toast({
        title: mapGovernanceSaveError(
          err,
          t,
          t('moderationProvider.saveFailed'),
        ),
        variant: 'destructive',
      });
    }
  };

  return (
    <FormSection
      label={t('moderationProvider.apiKey')}
      description={t('moderationProvider.apiKeyDescription', {
        secretPlaceholder: '{{secret}}',
      })}
    >
      {editing ? (
        <Stack gap={2}>
          <Input
            type="password"
            value={draft}
            disabled={disabled || saveSecret.isPending}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('moderationProvider.apiKeyPlaceholder')}
            autoFocus
          />
          <Row gap={2} align="stretch">
            <Button
              variant="primary"
              disabled={
                disabled || saveSecret.isPending || draft.trim().length === 0
              }
              onClick={() => void handleSave()}
            >
              {tCommon('actions.save')}
            </Button>
            <Button
              variant="ghost"
              disabled={saveSecret.isPending}
              onClick={() => {
                setEditing(false);
                setDraft('');
              }}
            >
              {tCommon('actions.cancel')}
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap={3}>
          <code className="text-muted-foreground bg-muted rounded px-2 py-1 text-xs">
            {isLoading
              ? t('moderationProvider.apiKeyLoading')
              : currentMask
                ? currentMask
                : t('moderationProvider.apiKeyNotConfigured')}
          </code>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {currentMask
              ? t('moderationProvider.replaceKey')
              : t('moderationProvider.setKey')}
          </Button>
        </Row>
      )}
    </FormSection>
  );
}
