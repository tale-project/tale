'use client';

import { Alert } from '@tale/ui/alert';
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
        <Alert variant="destructive" icon={AlertCircle} title={errorLabel}>
          <ul role="list" className="space-y-1 text-xs">
            {uniqueErrors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        </Alert>
      )}

      {uniqueWarnings.length > 0 && (
        <Alert variant="warning" icon={AlertTriangle} title={warningLabel}>
          <ul role="list" className="space-y-1 text-xs">
            {uniqueWarnings.map((warning) => (
              <li key={warning}>• {warning}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
});
