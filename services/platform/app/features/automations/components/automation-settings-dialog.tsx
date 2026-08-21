'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Tabs } from '@tale/ui/tabs';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  type AnySettingsForm,
  type AutomationSettings,
  isUploadsForm,
} from '@/lib/shared/schemas/automation_settings';

import { useSettingsEditor } from '../hooks/use-settings-editor';
import { SettingsFieldControl, useLocalized } from './settings-field-control';
import { SettingsFormDescription } from './settings-form-description';
import { SettingsUploadsPanel } from './settings-uploads-panel';

/**
 * Editing an automation's settings AFTER setup — its own dialog, one Save.
 *
 * Each declared form owns one flat-YAML file, which is why this used to render
 * a stack of sections each with its own Save: three files, three buttons, no
 * way to tell what any one of them covered. The file split is an implementation
 * detail of where values are stored, so it stops being the operator's problem:
 * the forms become tabs, the dialog carries ONE Save, and saving writes every
 * file the operator actually changed (a clean form is never rewritten).
 *
 * Leaving with unsaved edits is refused with a confirm — `FormDialog`'s own
 * discard guard, fed the editor's dirty state, so the X, Cancel, Esc and the
 * overlay all warn on the same rule.
 */
export function AutomationSettingsDialog({
  organizationId,
  projectId,
  settings,
  folder,
  automationName,
  open,
  onOpenChange,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  settings: AutomationSettings;
  /** Resolved target folder (see `resolveSettingsFolder`). */
  folder: string;
  /** Shown in the title, so the operator knows whose settings these are. */
  automationName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const editor = useSettingsEditor({
    organizationId,
    projectId,
    settings,
    folder,
  });
  // Tab identity: field forms are keyed by their file; uploads panels have
  // no file, so their declaration position names them.
  const keyOf = (form: AnySettingsForm, index: number): string =>
    isUploadsForm(form) ? `uploads:${index}` : form.file;
  const first = editor.forms[0];
  const [active, setActive] = useState(
    first !== undefined ? keyOf(first, 0) : '',
  );

  const body = (form: AnySettingsForm) => {
    const text = localized(form);
    if (isUploadsForm(form)) {
      return (
        <Stack gap={3} className="pt-2">
          {text.description !== undefined && (
            <SettingsFormDescription text={text.description} />
          )}
          <SettingsUploadsPanel
            organizationId={organizationId}
            projectId={projectId}
            folder={folder}
            form={form}
            disabled={editor.saving}
          />
        </Stack>
      );
    }
    const values = editor.valuesOf(form.file);
    return (
      <Stack gap={3} className="pt-2">
        {text.description !== undefined && (
          <SettingsFormDescription text={text.description} />
        )}
        {form.fields.map((field) => (
          <SettingsFieldControl
            key={field.key}
            form={form}
            field={field}
            value={values[field.key] ?? ''}
            issue={editor.issueOf(form.file, field.key)}
            disabled={editor.saving}
            onChange={(value) => editor.setField(form.file, field.key, value)}
          />
        ))}
      </Stack>
    );
  };

  const save = async () => {
    const dirty = editor.fieldsForms.filter((form) =>
      editor.isDirty(form.file),
    );
    if (dirty.length === 0) return;
    try {
      const result = await editor.save({
        // Only what changed is rewritten; everything is validated, so a
        // required field left empty elsewhere cannot be saved around.
        write: dirty,
        validate: editor.fieldsForms,
      });
      if (!result.ok) {
        // Reveal the refusal: an issue on another tab is invisible from
        // here. Field-form tabs are keyed by their file name.
        const offending = result.invalidFiles[0];
        if (offending !== undefined) setActive(offending);
        return;
      }
      toast({ title: t('settings.saved'), variant: 'success' });
    } catch (error) {
      console.error('[automations] settings save failed', error);
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    }
  };

  const single = editor.forms.length === 1 ? editor.forms[0] : undefined;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.dialogTitle', { name: automationName })}
      submitText={t('settings.save')}
      isSubmitting={editor.saving}
      isDirty={editor.dirtyFiles.length > 0}
      isValid={editor.dirtyFiles.length > 0}
      confirmDiscardOnDirty
      onSubmit={() => void save()}
      large
    >
      {editor.pending ? (
        <Text as="p" variant="muted">
          {t('settings.loading')}
        </Text>
      ) : editor.failed ? (
        <Text as="p" variant="muted">
          {t('settings.loadFailed')}
        </Text>
      ) : single !== undefined ? (
        body(single)
      ) : (
        <Tabs
          variant="underline"
          value={active}
          onValueChange={setActive}
          listAriaLabel={t('settings.tabsLabel')}
          overflowMenu
          overflowMenuLabel={t('settings.moreTabs')}
          // The panels are stateful editors: an uploads panel's expansion and
          // picked upload target (and any half-typed field) must survive a
          // look at another tab.
          keepMounted
          items={editor.forms.map((form, index) => ({
            value: keyOf(form, index),
            label: (
              <Row gap={1}>
                {localized(form).title}
                {!isUploadsForm(form) && editor.isDirty(form.file) && (
                  // The single Save covers every tab, so an unsaved edit
                  // elsewhere has to be visible from here.
                  <span
                    aria-label={t('settings.unsavedTab')}
                    className="bg-primary size-1.5 shrink-0 rounded-full"
                  />
                )}
              </Row>
            ),
            content: body(form),
          }))}
        />
      )}
    </FormDialog>
  );
}
