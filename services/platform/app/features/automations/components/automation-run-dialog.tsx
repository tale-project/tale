'use client';

import { Alert } from '@tale/ui/alert';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Field } from '@tale/ui/field';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useId, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  parseJsonText,
  useJsonInputDraft,
} from '../hooks/use-json-input-draft';
import { guidedIssueSource } from '../lib/issue-import';
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
  const { check } = useJsonInputDraft(request.schema);
  const parsed = useMemo(() => {
    let input: unknown = values;
    if (source === null) {
      const read = parseJsonText(text);
      if (!read.ok) {
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
      confirmText={
        request.mode === 'live' ? t('detail.runLive') : t('detail.runMock')
      }
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
        // The input is typed when the version declares one, or when the
        // caller hands a sample to edit (a trigger's Run now).
        (request.schema !== undefined ||
          request.initialInput !== undefined) && (
          <div className="mt-4 space-y-3">
            <Field
              label={t('detail.runInput.label')}
              htmlFor={inputId}
              description={t('detail.runInput.description', {
                version: request.version,
              })}
              error={parsed.valid ? undefined : parsed.error}
            >
              <Textarea
                id={inputId}
                rows={6}
                className="font-mono text-xs"
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
              />
            </Field>
            {request.schema !== undefined && (
              <CollapsibleDetails summary={t('detail.runInput.schema')}>
                <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs">
                  {JSON.stringify(request.schema, null, 2)}
                </pre>
              </CollapsibleDetails>
            )}
          </div>
        )
      )}
    </ConfirmDialog>
  );
}
