import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { useRegisterActiveEditor } from '@tale/ui/editor';
import { FIELD_ROW_CONTROL, FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import { Form } from '@tale/ui/form';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { RotateCcw } from 'lucide-react';
import type { FormEvent } from 'react';

import type { Settings } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useSettings } from '../hooks/use-settings';
import { useStartPageEditor } from '../hooks/use-start-page-editor';
import { SettingsLoadError } from './settings-load-error';
import { SettingsSection } from './settings-section';

/**
 * What a new session opens. Loading masks the field in place; a failed read
 * replaces it with the reason and a retry (there is nothing to edit yet).
 */
export function StartPageSection() {
  const { t } = useT('settings');
  const settings = useSettings();
  const failed = settings.isError && settings.data === undefined;

  return (
    <SettingsSection title={t('general.sessions.title')}>
      {failed ? (
        <SettingsLoadError
          error={settings.error}
          onRetry={() => void settings.refetch()}
          isRetrying={settings.isFetching}
          failureKey={settings.errorUpdateCount}
        />
      ) : (
        <Skeletonize loading={settings.data === undefined}>
          <StartPageForm settings={settings.data} />
        </Skeletonize>
      )}
    </SettingsSection>
  );
}

function StartPageForm({ settings }: { settings: Settings | undefined }) {
  const { t } = useT('settings');
  const editor = useStartPageEditor(settings);
  useRegisterActiveEditor(editor);
  const { form } = editor;
  const draft = form.watch('startPage').trim();
  const defaultStartPage = settings?.defaultStartPage;
  const canUseDefault =
    defaultStartPage !== undefined &&
    draft !== '' &&
    draft !== defaultStartPage;

  // Enter saves, like the Save button; with nothing changed it has nothing to say.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editor.isDirty) editor.submit(event);
  };

  const applyDefault = () => {
    if (defaultStartPage === undefined) return;
    form.setValue('startPage', defaultStartPage, { shouldDirty: true });
    form.clearErrors('startPage');
    // The button is gone once the default is in; the field is where the person was.
    form.setFocus('startPage');
  };

  return (
    <Form onSubmit={submit} noValidate>
      <Input
        label={t('general.startPage.label')}
        description={t('general.startPage.description')}
        hint={t('general.startPage.hint')}
        placeholder={defaultStartPage}
        errorMessage={form.formState.errors.startPage?.message}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        {...form.register('startPage', {
          // A refusal belongs to the address it refused: typing another clears it.
          onChange: () => form.clearErrors('startPage'),
        })}
      />
      {canUseDefault && (
        // On the row layout of the field, under its control: after the hint and
        // any refusal, which the field owns, rather than between them.
        <div className={cn('-mt-2 flex flex-col', FIELD_ROW_FRAME)}>
          <div className={cn(FIELD_ROW_CONTROL, '@xl/field-layout:ml-auto')}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={RotateCcw}
              // The address is long on a narrow screen: wrap it, never clip it.
              className="h-auto min-h-8 py-1.5 text-left whitespace-normal"
              onClick={applyDefault}
            >
              {t('general.startPage.useDefault', { url: defaultStartPage })}
            </Button>
          </div>
        </div>
      )}
      {editor.hasRemoteUpdate && (
        <Alert
          variant="info"
          description={t('general.startPage.remote.message')}
        >
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={editor.reset}
            >
              {t('general.startPage.remote.showSaved')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={editor.dismissRemoteUpdate}
            >
              {t('general.startPage.remote.keepEditing')}
            </Button>
          </div>
        </Alert>
      )}
    </Form>
  );
}
