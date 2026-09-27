'use client';

import { Alert } from '@tale/ui/alert';

import { useT } from '@/lib/i18n/client';

import { type ImportRowError, importRowErrorLine } from './import-row-errors';

/** How many refused rows the banner lists before it counts the rest. */
const LISTED_ROWS = 10;

/**
 * The rows an import could not land, each by its spreadsheet line and the
 * first thing wrong with it — so the user fixes those lines and imports the
 * file again, instead of guessing from "N failed".
 */
export function ImportRowErrorsAlert({
  errors,
}: {
  errors: readonly ImportRowError[];
}) {
  const { t: tCommon } = useT('common');
  if (errors.length === 0) return null;
  const listed = errors.slice(0, LISTED_ROWS);
  const rest = errors.length - listed.length;
  return (
    <Alert
      variant="destructive"
      title={tCommon('import.rowErrorsTitle', { count: errors.length })}
    >
      <ul className="list-outside list-disc space-y-1 pl-4 text-sm">
        {listed.map((entry, position) => (
          <li key={`${entry.row}-${position}`}>
            {importRowErrorLine(tCommon, entry)}
          </li>
        ))}
        {rest > 0 ? (
          <li className="list-none">
            {tCommon('import.moreRows', { count: rest })}
          </li>
        ) : null}
      </ul>
    </Alert>
  );
}
