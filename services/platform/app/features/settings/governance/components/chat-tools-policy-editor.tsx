'use client';

import {
  type ChatToolsConfig,
  chatToolsConfigSchema,
  DEFAULT_CHAT_TOOLS,
} from '@tale/shared/schemas/governance';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useMemo } from 'react';
import { useWatch } from 'react-hook-form';
import { z } from 'zod';

import { SettingsFieldList } from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { createConfigParser } from '../config-parser';
import { useUpsertGovernancePolicy } from '../hooks/mutations';
import { useGovernancePolicy } from '../hooks/queries';
import { withGovernancePolicyReadBoundary } from './policy-read-boundary';

interface ChatToolsPolicyEditorProps {
  organizationId: string;
}

const FORM_ID = 'governance-chat-tools-form';

/** The switches, in the order the chat reaches for them: cheapest first. */
const TOOLS = [
  { tool: 'files', label: 'chatTools.files', hint: 'chatTools.filesHint' },
  { tool: 'skills', label: 'chatTools.skills', hint: 'chatTools.skillsHint' },
  { tool: 'code', label: 'chatTools.code', hint: 'chatTools.codeHint' },
] as const;

const formSchema = z.object({
  files: z.boolean(),
  skills: z.boolean(),
  code: z.boolean(),
});

// A missing file is every tool on — what the chat offers without one — so
// the switches show what is actually in force.
const parseConfig = createConfigParser(
  chatToolsConfigSchema,
  (): ChatToolsConfig => ({ ...DEFAULT_CHAT_TOOLS }),
);

// =============================================================================
// What the chat assistant may make besides its answers: files it writes out,
// skills from the person's library, code in a light sandbox. A switch that is
// off removes the tool from every chat of the organization. Images are not
// here — the chat follows the Image generation policy, like the agents do.
// Saved through the settings header's Save/Discard cluster like the page's
// other editors.
// =============================================================================
function ChatToolsPolicyEditorContent({
  organizationId,
}: ChatToolsPolicyEditorProps) {
  const { t } = useT('governance');
  const ability = useAbility();
  const canEdit = ability.can('write', 'orgSettings');

  const { data: policy, isLoading } = useGovernancePolicy(
    organizationId,
    'chat_tools',
  );
  const { mutateAsync: upsertPolicy } = useUpsertGovernancePolicy({
    errorToast: false,
  });

  const data = useMemo<ChatToolsConfig>(
    () => parseConfig(policy?.config),
    [policy?.config],
  );

  const save = useCallback(
    async (values: ChatToolsConfig) => {
      try {
        await upsertPolicy({
          organizationId,
          policyType: 'chat_tools',
          config: {
            files: values.files,
            skills: values.skills,
            code: values.code,
          } satisfies ChatToolsConfig,
        });
      } catch (err) {
        console.error('[chatTools save]', err);
        throw new Error(t('chatTools.saveFailed'), { cause: err });
      }
    },
    [organizationId, t, upsertPolicy],
  );

  const editor = useFormEditor<ChatToolsConfig>({
    data,
    schema: formSchema,
    save,
  });
  // Read-only viewers stay unregistered so the cluster never renders for a
  // section they cannot edit.
  useRegisterGroupedEditor(editor, { enabled: canEdit });

  const values = useWatch({ control: editor.form.control });

  return (
    <Skeletonize loading={isLoading} label={t('chatTools.title')}>
      <SettingsSection
        title={t('chatTools.title')}
        description={t('chatTools.description')}
      >
        <form id={FORM_ID} onSubmit={editor.submit}>
          <fieldset
            disabled={!canEdit || editor.isLoading}
            className="contents"
          >
            <SettingsFieldList>
              {TOOLS.map(({ tool, label, hint }) => (
                <SettingsToggleRow
                  key={tool}
                  className="py-5"
                  label={t(label)}
                  description={t(hint)}
                  checked={values[tool] ?? data[tool]}
                  onCheckedChange={(checked) =>
                    editor.form.setValue(tool, checked, { shouldDirty: true })
                  }
                  disabled={!canEdit || editor.isLoading || editor.isSaving}
                />
              ))}
            </SettingsFieldList>
          </fieldset>
        </form>
      </SettingsSection>
    </Skeletonize>
  );
}

export const ChatToolsPolicyEditor = withGovernancePolicyReadBoundary(
  ChatToolsPolicyEditorContent,
  'chat_tools',
);
