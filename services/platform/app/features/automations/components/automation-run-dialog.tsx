'use client';

import { Alert } from '@tale/ui/alert';
import { CodeEditor } from '@tale/ui/code-editor';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { RadioGroup } from '@tale/ui/radio-group';
import { SchemaTree, schemaKindLabel } from '@tale/ui/schema-tree';
import { Text } from '@tale/ui/text';
import { useId, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  parseJsonText,
  useJsonInputDraft,
} from '../hooks/use-json-input-draft';
import { guidedIssueSource } from '../lib/issue-import';
import { runInputProviders } from '../lib/run-input-completion';
import {
  IssueImportFields,
  type IssueImportProject,
} from './issue-import-fields';

export interface AutomationRunRequest {
  automationSlug?: string;
  initialInput?: Record<string, unknown>;
  mode: 'mock' | 'live';
  version: number;
  schema?: Record<string, unknown>;
  projectId?: string;
  scopeText: string;
  /** The draft differs from the version on screen: the dialog asks which
   * of the two runs, the draft first, and checks the draft's input against
   * the draft's own schema. */
  draft?: { schema?: Record<string, unknown> };
}

/** What a test run runs: the unsaved draft, tried once and kept nowhere,
 * or the saved version, whose run is kept with the others. */
export type RunTarget = 'draft' | 'version';

const NO_PROJECTS: readonly IssueImportProject[] = [];

/** Mounted for one reviewed version and run scope. The server remains the
 * authority; client validation gives feedback before scheduling any work. */
export function AutomationRunDialog({
  request,
  projects = NO_PROJECTS,
  pending = false,
  error,
  onClose,
  onConfirm,
}: {
  request: AutomationRunRequest;
  projects?: readonly IssueImportProject[];
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (input: unknown, target: RunTarget) => void;
}) {
  const { t } = useT('automations');
  const { t: tSchema } = useT('schemaTree');
  const { locale } = useLocale();
  const inputId = useId();
  const [text, setText] = useState(() =>
    JSON.stringify(request.initialInput ?? {}, null, 2),
  );
  const [target, setTarget] = useState<RunTarget>(
    request.draft === undefined ? 'version' : 'draft',
  );
  const tryingDraft = target === 'draft';
  // The input the chosen document takes: the draft may declare another.
  const schema = tryingDraft ? request.draft?.schema : request.schema;
  const source = guidedIssueSource(request.automationSlug, request.schema);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(request.projectId !== undefined && { projectId: request.projectId }),
    limit: 100,
    ...(source === 'glitchtip' && { query: 'is:unresolved' }),
    ...request.initialInput,
  }));
  const { check } = useJsonInputDraft(schema);
  // The fields the schema declares, offered where a key of the input is
  // typed, each with its kind.
  const providers = useMemo(
    () =>
      runInputProviders(schema, (field) =>
        schemaKindLabel(tSchema, field, locale),
      ),
    [schema, tSchema, locale],
  );
  const parsed = useMemo(() => {
    let input: unknown = values;
    if (source === null) {
      const read = parseJsonText(text);
      if (!read.ok) {
        // The editor marks where the text stops being JSON; this line says
        // nothing can start until it is.
        return {
          valid: false as const,
          error: t('detail.runInput.invalidJson'),
        };
      }
      input = read.value;
    }
    const checked = check(input);
    if (!checked.valid) {
      return {
        valid: false as const,
        error: t('detail.runInput.invalid', {
          paths: checked.paths.join(', '),
        }),
      };
    }
    // Send the original JSON, not a converter's transformed/stripped value.
    return { valid: true as const, input: checked.input };
  }, [check, text, source, values, t]);

  const confirmText =
    request.mode === 'live' ? t('detail.runLive') : t('detail.runMock');

  return (
    <ConfirmDialog
      open
      onOpenChange={onClose}
      title={
        request.mode === 'live' ? t('detail.runLiveTitle') : t('detail.runMock')
      }
      description={
        request.mode === 'live'
          ? t('detail.runLiveBody')
          : tryingDraft
            ? t('detail.runInput.mockDescriptionDraft')
            : t('detail.runInput.mockDescription')
      }
      confirmText={confirmText}
      disableConfirm={!parsed.valid}
      isLoading={pending}
      onConfirm={() => {
        if (parsed.valid) onConfirm(parsed.input, target);
      }}
    >
      {error && <Alert variant="destructive" description={error} />}
      {request.draft !== undefined && (
        <RadioGroup
          label={t('detail.runTarget.label')}
          value={target}
          onValueChange={(next) => {
            setTarget(next === 'version' ? 'version' : 'draft');
          }}
          disabled={pending}
          options={[
            {
              value: 'draft',
              label: t('detail.runTarget.draft'),
              description: t('detail.runTarget.draftHelp'),
            },
            {
              value: 'version',
              label: t('detail.runTarget.version', {
                version: request.version,
              }),
              description: t('detail.runTarget.versionHelp'),
            },
          ]}
        />
      )}
      {source === null && !tryingDraft && (
        <Text as="p" variant="muted" className="text-sm">
          {request.scopeText}
        </Text>
      )}
      {source !== null ? (
        <>
          <IssueImportFields
            source={source}
            value={values}
            projects={
              request.projectId === undefined
                ? projects
                : projects.filter(
                    (project) => project._id === request.projectId,
                  )
            }
            disabled={pending}
            onChange={setValues}
          />
          {!parsed.valid && (
            <Text as="p" variant="muted" className="mt-3 text-sm" role="status">
              {parsed.error}
            </Text>
          )}
        </>
      ) : (
        // The input is typed when the document that runs declares one, or
        // when the caller hands a sample to edit (a trigger's Run now).
        (schema !== undefined || request.initialInput !== undefined) && (
          <div className="mt-4 space-y-3">
            <Field
              label={t('detail.runInput.label')}
              htmlFor={inputId}
              description={
                tryingDraft
                  ? t('detail.runInput.descriptionDraft')
                  : t('detail.runInput.description', {
                      version: request.version,
                    })
              }
              error={parsed.valid ? undefined : parsed.error}
            >
              <CodeEditor
                id={inputId}
                language="json"
                value={text}
                onChange={setText}
                minRows={6}
                maxRows={14}
                providers={providers}
                // Mod-Enter starts the run, as the dialog's button does —
                // once the input is one the run takes.
                onSubmit={() => {
                  if (parsed.valid && !pending) onConfirm(parsed.input, target);
                }}
                submitLabel={confirmText}
                describeDiagnostics={false}
              />
            </Field>
            {schema !== undefined && (
              <CollapsibleDetails summary={t('detail.runInput.schema')}>
                <SchemaTree
                  schema={schema}
                  density="comfortable"
                  aria-label={t('detail.runInput.schema')}
                  className="mt-2"
                />
              </CollapsibleDetails>
            )}
          </div>
        )
      )}
    </ConfirmDialog>
  );
}
