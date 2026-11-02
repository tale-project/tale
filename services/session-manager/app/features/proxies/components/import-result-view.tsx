import { Button } from '@tale/ui/button';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { InlineCode } from '@tale/ui/inline-code';
import { Text } from '@tale/ui/text';
import { useEffect, useRef } from 'react';

import type { ImportResult } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useParseErrorText } from '../hooks/use-parse-error-text';
import { hostPortOfDisplay } from '../lib/address';

/**
 * How many lines of a kind the report lists before it counts the rest, as the
 * platform's import report does for its rows (`import-row-errors-alert.tsx`
 * lists ten). Fifty is a screenful of line numbers: enough to find the pattern
 * of a list that is wrong all through, and a 2,000-line paste in the wrong
 * format does not become a 2,000-line page.
 */
const LISTED_LINES = 50;

/** What the API shows of a line it will not print: the line number says where. */
const MASKED_INPUT = '***';

export interface ImportResultViewProps {
  result: ImportResult;
  /**
   * Shows a proxy in the table (it narrows the search to it). An import made
   * away from the table (for a session that needs a proxy) has none to show:
   * the duplicates are then listed without that link.
   */
  onShow?: (query: string) => void;
}

/**
 * What an import did: how many lines were added, repeated an earlier proxy or
 * could not be read, and which. The lines that could not be read come first
 * and open, as they are what the person has to fix; the duplicates are
 * folded away, as importing a list again makes every line one. Each list stops
 * at fifty lines and counts the rest.
 */
export function ImportResultView({ result, onShow }: ImportResultViewProps) {
  const { t } = useT('proxies');
  const parseErrorText = useParseErrorText();
  const summaryRef = useRef<HTMLElement>(null);
  const { added, duplicates, errors } = result;

  // The form this replaces held the focus: the outcome takes it, and a screen
  // reader reads it out.
  useEffect(() => {
    summaryRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Text
        ref={summaryRef}
        variant="label"
        role="status"
        tabIndex={-1}
        className="outline-none"
      >
        {t('result.summary', {
          added: added.length,
          duplicates: duplicates.length,
          errors: errors.length,
        })}
      </Text>

      {errors.length > 0 && (
        <CollapsibleDetails
          defaultOpen
          summary={t('result.errors', { count: errors.length })}
        >
          <ul className="mt-2 flex flex-col gap-3">
            {errors.slice(0, LISTED_LINES).map((error) => (
              <li key={error.line} className="flex flex-col gap-1">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Text as="span" variant="caption" className="tabular-nums">
                    {t('result.line', { line: error.line })}
                  </Text>
                  {error.input === MASKED_INPUT ? null : (
                    <InlineCode className="break-all">{error.input}</InlineCode>
                  )}
                </span>
                <Text as="span" variant="body">
                  {parseErrorText(error.code, error.params, error.message)}
                </Text>
              </li>
            ))}
            <More listed={errors.length} />
          </ul>
        </CollapsibleDetails>
      )}

      {duplicates.length > 0 && (
        <CollapsibleDetails
          summary={t('result.duplicates', { count: duplicates.length })}
        >
          <ul className="mt-2 flex flex-col gap-2">
            {duplicates.slice(0, LISTED_LINES).map((duplicate) => (
              <li
                key={duplicate.line}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
              >
                <Text as="span" variant="caption" className="tabular-nums">
                  {t('result.line', { line: duplicate.line })}
                </Text>
                <InlineCode className="break-all">
                  {duplicate.display}
                </InlineCode>
                {onShow !== undefined && (
                  <Button
                    type="button"
                    variant="link"
                    className="text-xs"
                    onClick={() => onShow(hostPortOfDisplay(duplicate.display))}
                  >
                    {t('result.show')}{' '}
                    <span className="sr-only">{duplicate.display}</span>
                  </Button>
                )}
              </li>
            ))}
            <More listed={duplicates.length} />
          </ul>
        </CollapsibleDetails>
      )}
    </div>
  );
}

/** The lines a list does not show, counted: nothing when it shows them all. */
function More({ listed }: { listed: number }) {
  const { t } = useT('proxies');
  if (listed <= LISTED_LINES) return null;
  return (
    <li className="list-none">
      <Text as="span" variant="muted">
        {t('result.more', { count: listed - LISTED_LINES })}
      </Text>
    </li>
  );
}
