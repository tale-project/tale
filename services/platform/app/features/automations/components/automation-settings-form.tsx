'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type { AutomationSettings } from '@/lib/shared/schemas/automation_settings';

import { useSettingsEditor } from '../hooks/use-settings-editor';
import { SettingsFieldControl, useLocalized } from './settings-field-control';

/**
 * FIRST-TIME setup of an automation's declared settings: every form stacked,
 * one "Save and continue" that writes them all.
 *
 * This is a step of creating the task, not a settings screen — the create gate
 * mounts it when a required file is still missing, and nothing can be skipped,
 * so the forms are shown together rather than behind tabs (a validation error
 * on a hidden tab would be a dead end). Editing settings LATER is
 * `AutomationSettingsDialog`, which is tabbed and saves once.
 */
export function AutomationSettingsForm({
  organizationId,
  projectId,
  settings,
  folder,
  onSaved,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  settings: AutomationSettings;
  /** Resolved target folder (see `resolveSettingsFolder`). */
  folder: string;
  /** Called once every form has been written. */
  onSaved?: () => void;
}) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const editor = useSettingsEditor({
    organizationId,
    projectId,
    settings,
    folder,
  });

  const saveAll = async () => {
    try {
      const result = await editor.save({
        write: editor.forms,
        validate: editor.forms,
      });
      if (result.ok) onSaved?.();
    } catch (error) {
      console.error('[automations] settings save failed', error);
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    }
  };

  if (editor.pending) {
    return (
      <Text as="p" variant="muted">
        {t('settings.loading')}
      </Text>
    );
  }
  if (editor.failed) {
    return (
      <Text as="p" variant="muted">
        {t('settings.loadFailed')}
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      {editor.forms.map((form) => {
        const text = localized(form);
        const values = editor.valuesOf(form.file);
        return (
          <Stack key={form.file} gap={3}>
            <Stack gap={1}>
              <Text as="h3" className="text-sm font-medium">
                {text.title}
              </Text>
              {text.description !== undefined && (
                <Text as="p" variant="muted">
                  {text.description}
                </Text>
              )}
            </Stack>
            {form.fields.map((field) => (
              <SettingsFieldControl
                key={field.key}
                form={form}
                field={field}
                value={values[field.key] ?? ''}
                issue={editor.issueOf(form.file, field.key)}
                disabled={editor.saving}
                onChange={(value) =>
                  editor.setField(form.file, field.key, value)
                }
              />
            ))}
          </Stack>
        );
      })}
      <Row justify="end">
        <Button onClick={() => void saveAll()} disabled={editor.saving}>
          {t('settings.saveAndContinue')}
        </Button>
      </Row>
    </Stack>
  );
}
