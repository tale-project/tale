'use client';

import { Field } from '@tale/ui/field';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useId, useMemo, useState } from 'react';
import { z } from 'zod';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { useT } from '@/lib/i18n/client';

export interface AutomationRunRequest {
  mode: 'mock' | 'live';
  version: number;
  schema?: Record<string, unknown>;
  projectId?: string;
  scopeText: string;
}

/** Mounted for one reviewed version and run scope. The server remains the
 * authority; client validation gives feedback before scheduling any work. */
export function AutomationRunDialog({
  request,
  onClose,
  onConfirm,
}: {
  request: AutomationRunRequest;
  onClose: () => void;
  onConfirm: (input: unknown) => void;
}) {
  const { t } = useT('automations');
  const inputId = useId();
  const [text, setText] = useState('{}');
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
  const parsed = useMemo(() => {
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return { valid: false as const, error: t('editor.invalidJson') };
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
  }, [schema, text, t]);

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
      onConfirm={() => {
        if (parsed.valid) onConfirm(parsed.input);
      }}
    >
      <Text as="p" variant="muted" className="text-sm">
        {request.scopeText}
      </Text>
      {request.schema !== undefined && (
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
          <details className="text-sm">
            <summary className="cursor-pointer">
              {t('detail.runInput.schema')}
            </summary>
            <pre className="bg-muted mt-2 max-h-48 overflow-auto rounded-md p-3 text-xs">
              {JSON.stringify(request.schema, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </ConfirmDialog>
  );
}
