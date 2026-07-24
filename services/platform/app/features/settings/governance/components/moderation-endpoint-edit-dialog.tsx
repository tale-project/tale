'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';
import { type ModerationResponseShape } from '@/lib/shared/schemas/governance';

import { CustomJsonPathSection } from './moderation-custom-json-path-section';
import type { EndpointDraft, HeaderRow } from './moderation-presets';

interface EndpointEditDialogProps {
  open: boolean;
  initial: EndpointDraft;
  responseShape: ModerationResponseShape['type'];
  onCancel: () => void;
  onSave: (draft: EndpointDraft) => void;
}

function endpointDraftEquals(a: EndpointDraft, b: EndpointDraft): boolean {
  if (
    a.url !== b.url ||
    a.requestTemplate !== b.requestTemplate ||
    a.timeoutMs !== b.timeoutMs ||
    a.customFlaggedPath !== b.customFlaggedPath ||
    a.customCategoriesPath !== b.customCategoriesPath ||
    a.customCategoryShape !== b.customCategoryShape
  ) {
    return false;
  }
  if (a.headers.length !== b.headers.length) return false;
  for (let i = 0; i < a.headers.length; i += 1) {
    if (
      a.headers[i]?.key !== b.headers[i]?.key ||
      a.headers[i]?.value !== b.headers[i]?.value
    ) {
      return false;
    }
  }
  return true;
}

export function EndpointEditDialog({
  open,
  initial,
  responseShape,
  onCancel,
  onSave,
}: EndpointEditDialogProps) {
  const { t } = useT('governance');
  const { t: tCommon } = useT('common');
  const [draft, setDraft] = useState(initial);

  // Reset when dialog reopens with a different initial value.
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const addHeader = () =>
    setDraft((d) => ({
      ...d,
      headers: [...d.headers, { key: '', value: '' }],
    }));
  const removeHeader = (index: number) =>
    setDraft((d) => ({
      ...d,
      headers: d.headers.filter((_, i) => i !== index),
    }));
  const updateHeader = (index: number, patch: Partial<HeaderRow>) =>
    setDraft((d) => ({
      ...d,
      headers: d.headers.map((h, i) => (i === index ? { ...h, ...patch } : h)),
    }));

  const hasChanges = !endpointDraftEquals(draft, initial);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t('moderationProvider.editEndpointTitle')}
      description={t('moderationProvider.editEndpointDescription', {
        textPlaceholder: '{{text}}',
        directionPlaceholder: '{{direction}}',
        secretPlaceholder: '{{secret}}',
      })}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tCommon('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!hasChanges}
            onClick={() => onSave(draft)}
          >
            {tCommon('actions.save')}
          </Button>
        </>
      }
    >
      <Stack>
        <FormSection
          label={t('moderationProvider.endpointUrlField')}
          description={t('moderationProvider.endpointUrlFieldDescription')}
        >
          <Input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder={t('moderationProvider.endpointUrlPlaceholder')}
          />
        </FormSection>

        <FormSection label={t('moderationProvider.headersTitle')}>
          <Stack gap={2}>
            {draft.headers.map((header, index) => (
              <Row key={index} gap={2} align="stretch">
                <Input
                  aria-label={t('moderationProvider.headerNameAria')}
                  value={header.key}
                  onChange={(e) => updateHeader(index, { key: e.target.value })}
                  placeholder={t('moderationProvider.headerNamePlaceholder')}
                />
                <Input
                  aria-label={t('moderationProvider.headerValueAria')}
                  value={header.value}
                  onChange={(e) =>
                    updateHeader(index, { value: e.target.value })
                  }
                  placeholder={t('moderationProvider.headerValuePlaceholder', {
                    secretPlaceholder: '{{secret}}',
                  })}
                />
                <Button
                  variant="ghost"
                  aria-label={t('moderationProvider.removeHeaderAria')}
                  onClick={() => removeHeader(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </Row>
            ))}
            <Button variant="secondary" icon={Plus} onClick={addHeader}>
              {t('moderationProvider.addHeader')}
            </Button>
          </Stack>
        </FormSection>

        <FormSection
          label={t('moderationProvider.requestTemplateLabel')}
          description={t('moderationProvider.requestTemplateDescription', {
            textPlaceholder: '{{text}}',
            directionPlaceholder: '{{direction}}',
          })}
        >
          <Textarea
            value={draft.requestTemplate}
            rows={6}
            className="font-mono text-base md:text-xs"
            onChange={(e) =>
              setDraft({ ...draft, requestTemplate: e.target.value })
            }
          />
        </FormSection>

        <FormSection label={t('moderationProvider.timeoutLabel')}>
          <Input
            type="number"
            value={draft.timeoutMs}
            onChange={(e) => setDraft({ ...draft, timeoutMs: e.target.value })}
          />
        </FormSection>

        {responseShape === 'custom_jsonpath' && (
          <CustomJsonPathSection
            draft={draft}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
          />
        )}
        {/* Bottom padding so the last field isn't flush with the dialog
            footer — the scrollbar already takes the overflow, this is
            just visual breathing room. */}
        <div className="pb-2" />
      </Stack>
    </Dialog>
  );
}
