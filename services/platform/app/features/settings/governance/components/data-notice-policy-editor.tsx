'use client';

import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  DATA_NOTICE_MAX_CHARS,
  readDataNoticeSettings,
  resolveDataNoticeMessage,
} from '@/app/features/governance/lib/data-notice';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { useGovernancePolicyToggle } from '../hooks/use-governance-policy-toggle';

interface DataNoticePolicyEditorProps {
  organizationId: string;
}

/** The languages the app ships — one text field each. */
const NOTICE_LOCALES = ['en', 'de', 'fr'] as const;
type NoticeLocale = (typeof NOTICE_LOCALES)[number];
type DataNoticeForm = Record<NoticeLocale, string>;

/**
 * The stored config with `enabled` and the three languages' text replaced.
 * The save replaces the whole file, so everything else an operator may have
 * written there — `version`, `requireAcknowledgment`, text for a regional
 * locale such as `de-CH` — is carried over untouched. An empty field removes
 * that language's text, so its readers fall back again.
 */
function buildConfig(
  storedConfig: unknown,
  enabled: boolean,
  texts: DataNoticeForm,
): Record<string, unknown> {
  const stored = isRecord(storedConfig) ? storedConfig : {};
  const messages: Record<string, string> = {
    ...readDataNoticeSettings(stored).messages,
  };
  for (const locale of NOTICE_LOCALES) {
    const text = texts[locale].trim();
    if (text === '') delete messages[locale];
    else messages[locale] = text;
  }
  const { messages: _replaced, ...rest } = stored;
  return {
    ...rest,
    enabled,
    ...(Object.keys(messages).length > 0 ? { messages } : {}),
  };
}

// =============================================================================
// Single editor — owns data fetching, the form controller, the instant-save
// section toggle, the save wiring, and the loading state. Renders the REAL
// layout once, always, wrapped in `<Skeletonize>`; the skeleton-aware
// `<Switch>`/`<Textarea>` leaves mask themselves while loading. The route
// loader warms `data_classification_notice`, so warm navigations skip the
// skeleton. The texts save through the settings header's Save/Discard cluster
// (registered via the editor group); the toggle saves instantly.
// =============================================================================
export function DataNoticePolicyEditor({
  organizationId,
}: DataNoticePolicyEditorProps) {
  const { t } = useT('governance');
  const { t: tGlobal } = useT('global');
  // The platform default in each language, for the placeholders: the bundles
  // for every shipped language are loaded, so a fixed-language `t` resolves.
  const { i18n } = useTranslation();
  const ability = useAbility();

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'data_classification_notice',
  );
  const upsertMutation = useUpsertGovernancePolicy();
  const cannotManage = ability.cannot('write', 'orgSettings');

  const saved = useMemo(
    () => readDataNoticeSettings(policy?.config),
    [policy?.config],
  );

  const { enabled, isToggling, onToggle } = useGovernancePolicyToggle({
    organizationId,
    policyType: 'data_classification_notice',
    savedEnabled: saved.enabled,
    isLoading,
    // Turning the notice off keeps its texts — the stored ones are written
    // back alongside the flag.
    buildConfig: (next) =>
      buildConfig(policy?.config, next, {
        en: saved.messages.en ?? '',
        de: saved.messages.de ?? '',
        fr: saved.messages.fr ?? '',
      }),
    failureTitle: t('toastSaveFailedTitle'),
    failureDescription: t('dataNotice.saveFailed'),
  });

  const schema = useMemo(() => {
    const text = z
      .string()
      .max(
        DATA_NOTICE_MAX_CHARS,
        t('dataNotice.charLimitExceeded', { max: DATA_NOTICE_MAX_CHARS }),
      );
    return z.object({ en: text, de: text, fr: text });
  }, [t]);

  const data = useMemo<DataNoticeForm | undefined>(() => {
    if (isLoading) return undefined;
    return {
      en: saved.messages.en ?? '',
      de: saved.messages.de ?? '',
      fr: saved.messages.fr ?? '',
    };
  }, [isLoading, saved.messages]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. The section toggle is an instant action and reports through the
  // shared toggle hook instead.
  const save = useCallback(
    async (values: DataNoticeForm) => {
      try {
        await upsertMutation.mutateAsync({
          organizationId,
          policyType: 'data_classification_notice',
          // The fields exist only while the notice is on, so a batched save
          // always means on.
          config: buildConfig(policy?.config, true, values),
        });
      } catch (err) {
        console.error('[dataNotice save]', err);
        throw new Error(t('dataNotice.saveFailed'), { cause: err });
      }
    },
    [organizationId, policy?.config, t, upsertMutation],
  );

  const editor = useFormEditor<DataNoticeForm>({ data, schema, save });
  // Read-only viewers and a notice that is off stay unregistered, so the
  // cluster never renders for fields nobody can save.
  useRegisterGroupedEditor(editor, { enabled: !cannotManage && enabled });

  const {
    register,
    watch,
    formState: { errors },
  } = editor.form;

  // Each placeholder shows what that language's readers see while its field
  // is empty: the English text when there is one, else the platform default
  // in their language — the chain the chat itself resolves.
  // Undefined until the form first adopts the loaded values.
  const englishText = (watch('en') ?? '').trim();
  const placeholderFor = (locale: NoticeLocale) =>
    resolveDataNoticeMessage(
      englishText === '' ? {} : { en: englishText },
      locale,
      i18n.getFixedT(locale, 'dataNotice')('default'),
    );

  return (
    <Skeletonize loading={isLoading} label={t('dataNotice.title')}>
      <SettingsSection
        title={t('dataNotice.title')}
        description={t('dataNotice.description')}
        action={
          <Switch
            aria-label={t('dataNotice.enabledLabel')}
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={cannotManage || isToggling || editor.isSaving}
          />
        }
      >
        {/* The texts exist only while the notice is on — the toggle hides
            them rather than offering fields nothing would show. They stay
            mounted (masked) while loading so the skeleton keeps the
            section's real shape; `enabled` is only known once the read
            settles. */}
        {(isLoading || enabled) && (
          <form onSubmit={editor.submit}>
            <fieldset
              disabled={cannotManage || editor.isLoading}
              className="contents"
            >
              <Stack gap={4}>
                <Text variant="muted">{t('dataNotice.textsHint')}</Text>
                {NOTICE_LOCALES.map((locale) => (
                  // The settings control column, like every other field on
                  // the page: labels of different widths still leave the
                  // three fields aligned with each other.
                  <Textarea
                    key={locale}
                    label={tGlobal(`languages.${locale}`)}
                    placeholder={placeholderFor(locale)}
                    errorMessage={errors[locale]?.message}
                    counterMax={DATA_NOTICE_MAX_CHARS}
                    {...register(locale)}
                  />
                ))}
              </Stack>
            </fieldset>
          </form>
        )}
      </SettingsSection>
    </Skeletonize>
  );
}
