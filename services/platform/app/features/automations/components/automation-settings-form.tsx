'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useEffect, useState } from 'react';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  type AutomationSettings,
  isUploadsForm,
} from '@/lib/shared/schemas/automation_settings';

import { useSettingsEditor } from '../hooks/use-settings-editor';
import { SettingsFieldControl, useLocalized } from './settings-field-control';
import { SettingsFormDescription } from './settings-form-description';
import { SettingsUploadsPanel } from './settings-uploads-panel';

/**
 * FIRST-TIME setup of an automation's declared settings: every form rendered
 * as its own bordered section, one submit that writes them all.
 *
 * This is a step of creating the task, not a settings screen — the create gate
 * mounts it when a required file is still missing, and nothing can be skipped,
 * so the forms are shown together rather than behind tabs (a validation error
 * on a hidden tab would be a dead end). It renders as a real `<form id>` with
 * NO button of its own: the mounting dialog puts its submit ("Save and
 * continue") in the dialog footer next to Cancel via the button's `form`
 * attribute, so there is exactly one action row. Editing settings LATER is
 * `AutomationSettingsDialog`, which is tabbed and saves once.
 */
export function AutomationSettingsForm({
  organizationId,
  projectId,
  settings,
  folder,
  formId,
  onSaved,
  onSavingChange,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  settings: AutomationSettings;
  /** Resolved target folder (see `resolveSettingsFolder`). */
  folder: string;
  /** DOM id of the rendered `<form>` — the mounting dialog's footer submit
   * button targets it via the `form` attribute. */
  formId: string;
  /** Called once every form has been written. */
  onSaved?: () => void;
  /** Mirrors the editor's saving state so the external submit button can
   * disable while a save is in flight. */
  onSavingChange?: (saving: boolean) => void;
}) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const editor = useSettingsEditor({
    organizationId,
    projectId,
    settings,
    folder,
  });

  // Uploads panels report their in-flight uploads (by declaration index):
  // saving mid-upload would unmount the panel under a running `handleFiles`.
  const [busyUploads, setBusyUploads] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const uploadsBusy = busyUploads.size > 0;

  const { saving } = editor;
  useEffect(() => {
    onSavingChange?.(saving || uploadsBusy);
  }, [saving, uploadsBusy, onSavingChange]);

  const saveAll = async () => {
    try {
      const result = await editor.save({
        write: editor.fieldsForms,
        validate: editor.fieldsForms,
      });
      if (result.ok) {
        onSaved?.();
        return;
      }
      // Reveal the refusal: with every form stacked in one scroll column the
      // offending control may sit off-screen, and a silent no-op reads as a
      // dead Save button (the tabbed dialog's analog is switching tabs).
      if (result.firstInvalid !== undefined) {
        const control = document.getElementById(
          `automation-settings-${result.firstInvalid.file}-${result.firstInvalid.key}`,
        );
        // Optional call: jsdom has no scrollIntoView, and the focus below
        // must still land there.
        control?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        control?.focus({ preventScroll: true });
      }
    } catch (error) {
      console.error('[automations] settings save failed', error);
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    }
  };

  return (
    // The form element renders in the pending/failed states too, so the
    // footer's `form`-targeted submit button never points at nothing; the
    // handler just refuses until the values have loaded. `noValidate` keeps
    // the browser's constraint validation out of the way (fields carry native
    // `required`): the editor's localized validation is the one source of
    // error display, same as `FormDialog`.
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // Only THIS form's submit counts: a nested dialog's submit bubbling
        // up the React tree must not save the whole gate underneath it.
        if (event.target !== event.currentTarget) return;
        if (editor.pending || editor.failed || editor.saving || uploadsBusy)
          return;
        void saveAll();
      }}
    >
      {editor.pending ? (
        <Text as="p" variant="muted">
          {t('settings.loading')}
        </Text>
      ) : editor.failed ? (
        <Text as="p" variant="muted">
          {t('settings.loadFailed')}
        </Text>
      ) : (
        <Stack gap={4}>
          {editor.forms.map((form, index) => {
            const text = localized(form);
            const header = (
              <Stack gap={1}>
                <Text as="h3" variant="label">
                  {text.title}
                </Text>
                {text.description !== undefined && (
                  <SettingsFormDescription text={text.description} />
                )}
              </Stack>
            );
            if (isUploadsForm(form)) {
              return (
                <BorderedSection key={`uploads:${index}`}>
                  {header}
                  <SettingsUploadsPanel
                    organizationId={organizationId}
                    projectId={projectId}
                    folder={folder}
                    form={form}
                    disabled={editor.saving}
                    onBusyChange={(busy) =>
                      setBusyUploads((prev) => {
                        // Identity-stable when nothing changes: the panel's
                        // mirror effect re-runs on every parent render (the
                        // callback is inline), and a fresh Set each time
                        // would re-render forever.
                        if (busy === prev.has(index)) return prev;
                        const next = new Set(prev);
                        if (busy) next.add(index);
                        else next.delete(index);
                        return next;
                      })
                    }
                  />
                </BorderedSection>
              );
            }
            const values = editor.valuesOf(form.file);
            return (
              <BorderedSection key={form.file}>
                {header}
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
              </BorderedSection>
            );
          })}
        </Stack>
      )}
    </form>
  );
}
