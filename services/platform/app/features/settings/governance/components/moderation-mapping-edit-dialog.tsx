'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useT } from '@/lib/i18n/client';
import { type ModerationCategoryMapping } from '@/lib/shared/schemas/governance';

interface MappingEditDialogProps {
  index: number | 'new';
  initial?: ModerationCategoryMapping;
  onCancel: () => void;
  onSave: (draft: ModerationCategoryMapping) => void;
  onDelete?: () => void;
}

export function MappingEditDialog({
  index,
  initial,
  onCancel,
  onSave,
  onDelete,
}: MappingEditDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [providerCategory, setProviderCategory] = useState(
    initial?.providerCategory ?? '',
  );
  const [internalLabel, setInternalLabel] = useState(
    initial?.internalLabel ?? '',
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [mode, setMode] = useState<'block' | 'mask' | 'flag'>(
    initial?.mode ?? 'flag',
  );
  const [scoreThresholdText, setScoreThresholdText] = useState(
    initial?.scoreThreshold !== undefined ? String(initial.scoreThreshold) : '',
  );

  const isNew = index === 'new';
  const canSave =
    providerCategory.trim().length > 0 && internalLabel.trim().length > 0;

  // Save only activates when the draft differs from the initial mapping
  // (or, for a new mapping, once the required fields are filled). Treats
  // empty scoreThreshold string as "undefined" to avoid comparing NaN.
  const initialScoreText =
    initial?.scoreThreshold !== undefined ? String(initial.scoreThreshold) : '';
  const hasChanges =
    isNew ||
    providerCategory.trim() !== (initial?.providerCategory ?? '') ||
    internalLabel.trim() !== (initial?.internalLabel ?? '') ||
    enabled !== (initial?.enabled ?? true) ||
    mode !== (initial?.mode ?? 'flag') ||
    scoreThresholdText.trim() !== initialScoreText.trim();

  const handleSave = () => {
    const parsed = scoreThresholdText.trim();
    const scoreThreshold = parsed === '' ? undefined : Number(parsed);
    if (scoreThreshold !== undefined && Number.isNaN(scoreThreshold)) return;
    onSave({
      providerCategory: providerCategory.trim(),
      internalLabel: internalLabel.trim(),
      enabled,
      mode,
      scoreThreshold,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={
        isNew
          ? t('moderationProvider.addMappingTitle')
          : t('moderationProvider.editMappingTitle')
      }
      description={t('moderationProvider.mappingDialogDescription')}
      footer={
        <>
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              {tCommon('actions.delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!canSave || !hasChanges}
            onClick={handleSave}
          >
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <Stack>
        <FormSection
          label={t('moderationProvider.providerCategoryLabel')}
          description={t('moderationProvider.providerCategoryDescription')}
        >
          <Input
            value={providerCategory}
            onChange={(e) => setProviderCategory(e.target.value)}
            placeholder={t('moderationProvider.providerCategoryPlaceholder')}
          />
        </FormSection>

        <FormSection
          label={t('moderationProvider.internalLabelLabel')}
          description={t('moderationProvider.internalLabelDescription')}
        >
          <Input
            value={internalLabel}
            onChange={(e) => setInternalLabel(e.target.value)}
            placeholder={t('moderationProvider.internalLabelPlaceholder')}
          />
        </FormSection>

        <FormSection label={t('moderationProvider.modeLabel')}>
          <Select
            value={mode}
            onValueChange={(v) => {
              if (v === 'block' || v === 'mask' || v === 'flag') setMode(v);
            }}
            options={[
              {
                value: 'block',
                label: t('moderationProvider.modeBlock'),
              },
              {
                value: 'mask',
                label: t('moderationProvider.modeMask'),
              },
              {
                value: 'flag',
                label: t('moderationProvider.modeFlag'),
              },
            ]}
          />
        </FormSection>

        <FormSection
          label={t('moderationProvider.scoreThresholdLabel')}
          description={t('moderationProvider.scoreThresholdDescription')}
        >
          <Input
            type="number"
            step="0.05"
            value={scoreThresholdText}
            onChange={(e) => setScoreThresholdText(e.target.value)}
            placeholder={t('moderationProvider.scoreThresholdPlaceholder')}
          />
        </FormSection>

        <Switch
          aria-label={t('moderationProvider.enabled')}
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </Stack>
    </Dialog>
  );
}
