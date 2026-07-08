'use client';

import { Text } from '@tale/ui/text';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import { memo, useMemo } from 'react';

export interface ValidationMessagesProps {
  errors: string[];
  warnings: string[];
  errorLabel: string;
  warningLabel: string;
}

/**
 * Deduplicated error + warning lists for a workflow definition — shared by the
 * step side panel (`workflow-sidepanel.tsx`) and the specification editor's
 * "regenerate graph" preview (`workflow-specification.tsx`). Errors render
 * with `role="alert"` so assistive tech announces a failed validation as soon
 * as it appears.
 */
export const ValidationMessages = memo(function ValidationMessages({
  errors,
  warnings,
  errorLabel,
  warningLabel,
}: ValidationMessagesProps) {
  const uniqueErrors = useMemo(() => [...new Set(errors)], [errors]);
  const uniqueWarnings = useMemo(() => [...new Set(warnings)], [warnings]);

  return (
    <>
      {uniqueErrors.length > 0 && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 rounded-md border p-3"
        >
          <Text variant="error" className="mb-1 flex items-center gap-2">
            <AlertCircle className="size-4" />
            {errorLabel}
          </Text>
          <ul role="list" className="text-destructive space-y-1 text-xs">
            {uniqueErrors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {uniqueWarnings.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3">
          <Text
            as="div"
            className="mb-1 flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400"
          >
            <AlertTriangle className="size-4" />
            {warningLabel}
          </Text>
          <ul
            role="list"
            className="space-y-1 text-xs text-amber-600 dark:text-amber-400"
          >
            {uniqueWarnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
});
