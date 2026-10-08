'use client';

import { Alert } from '@tale/ui/alert';
import { CodeEditor } from '@tale/ui/code-editor';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Field } from '@tale/ui/field';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SchemaTree, schemaKindLabel } from '@tale/ui/schema-tree';
import { Text } from '@tale/ui/text';
import { useId, useMemo, useState } from 'react';
import { z } from 'zod';

import { useT } from '@/lib/i18n/client';

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
}

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
  onConfirm: (input: unknown) => void;
}) {
  const { t } = useT('automations');
  const { t: tSchema } = useT('schemaTree');
  const { locale } = useLocale();
  const inputId = useId();
  const [text, setText] = useState(() =>
    JSON.stringify(request.initialInput ?? {}, null, 2),
  );
  const source = guidedIssueSource(request.automationSlug, request.schema);
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...(request.projectId !== undefined && { projectId: request.projectId }),
    limit: 100,
    ...(source === 'glitchtip' && { query: 'is:unresolved' }),
    ...request.initialInput,
  }));
  const schema = useMemo(() => {
    if (request.schema === undefined) return null;
    try {
      // Ajv compiles with new Function, forbidden by the production CSP.
      // Zod is already used by the app and supports CSP-safe validation.
      return z.fromJSONSchema(request.schema);
    } catch {
      // Author schemas may use keywords the client converter cannot handle.
      // Do not reject a server-valid schema merely for that reason: the
      // start endpoint validates the original input with the engine's Ajv.
      return null;
    }
  }, [request.schema]);
  // The fields the schema declares, offered where a key of the input is
  // typed, each with its kind.
  const providers = useMemo(
    () =>
      runInputProviders(request.schema, (field) =>
        schemaKindLabel(tSchema, field, locale),
      ),
    [request.schema, tSchema, locale],
  );
  const parsed = useMemo(() => {
    let input: unknown;
    try {
      input = source === null ? JSON.parse(text) : values;
    } catch {
      // The editor marks where the text stops being JSON; this line says
      // nothing can start until it is.
      return { valid: false as const, error: t('detail.runInput.invalidJson') };
    }
    const checked = schema?.safeParse(input);
    if (checked && !checked.success) {
      const paths = [
        ...new Set(
          checked.error.issues.map((issue) =>
            issue.path.length === 0 ? '$' : issue.path.join('.'),
          ),
        ),
      ]
        .slice(0, 20)
        .join(', ');
      return {
        valid: false as const,
        error: t('detail.runInput.invalid', { paths }),
      };
    }
    // Send the original JSON, not a converter's transformed/stripped value.
    return { valid: true as const, input };
  }, [schema, text, source, values, t]);

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
          : t('detail.runInput.mockDescription')
      }
      confirmText={confirmText}
      disableConfirm={!parsed.valid}
      isLoading={pending}
      onConfirm={() => {
        if (parsed.valid) onConfirm(parsed.input);
      }}
    >
      {error && <Alert variant="destructive" description={error} />}
      {source === null && (
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
        request.schema !== undefined && (
          <div className="mt-4 space-y-3">
            <Field
              label={t('detail.runInput.label')}
              htmlFor={inputId}
              description={t('detail.runInput.description', {
                version: request.version,
              })}
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
                  if (parsed.valid && !pending) onConfirm(parsed.input);
                }}
                submitLabel={confirmText}
                describeDiagnostics={false}
              />
            </Field>
            <CollapsibleDetails summary={t('detail.runInput.schema')}>
              <SchemaTree
                schema={request.schema}
                density="comfortable"
                aria-label={t('detail.runInput.schema')}
                className="mt-2"
              />
            </CollapsibleDetails>
          </div>
        )
      )}
    </ConfirmDialog>
  );
}
