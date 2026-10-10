import { useCallback, useState } from 'react';

import { extractErrorCode } from '@/app/features/shared/lib/extract-error-code';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { failureDetail } from '@/app/lib/backend/adapters';
import { COMPARISON_OFFLINE } from '@/app/lib/backend/documents';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';

import type { DocumentComparisonResult } from '../components/document-comparison/comparison-types';

interface UseDocumentComparisonOptions {
  organizationId: string;
}

interface ComparisonState {
  result: DocumentComparisonResult | null;
  error: string | null;
  isPending: boolean;
}

function isDocumentComparisonResult(
  value: unknown,
): value is DocumentComparisonResult {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'changeBlocks' in value &&
    'stats' in value &&
    'baseDocument' in value &&
    'comparisonDocument' in value
  );
}

export function useDocumentComparison({
  organizationId,
}: UseDocumentComparisonOptions) {
  const { t } = useT('documents');
  // The history dialog reports a failed comparison itself, in its toast and
  // under the version picker; the hook's default toast would say it twice.
  const { mutateAsync: compareAction } = useBackendAction(
    'documents/compare_documents:compareDocuments',
    { errorToast: false },
  );
  const [state, setState] = useState<ComparisonState>({
    result: null,
    error: null,
    isPending: false,
  });

  const compare = useCallback(
    async (args: {
      baseStorageId: string;
      baseFileName: string;
      comparisonStorageId: string;
      comparisonFileName: string;
    }) => {
      setState({ result: null, error: null, isPending: true });
      try {
        const result = await compareAction({
          organizationId,
          baseStorageId: args.baseStorageId,
          baseFileName: args.baseFileName,
          comparisonStorageId: args.comparisonStorageId,
          comparisonFileName: args.comparisonFileName,
        });
        if (!isDocumentComparisonResult(result)) {
          // An answer of the wrong shape is a fault, not words for the
          // person: `failureDetail` shows no runtime error's message.
          throw new TypeError('Invalid comparison response');
        }
        setState({
          result,
          error: null,
          isPending: false,
        });
        return result;
      } catch (err) {
        // The offline lane refuses without words of its own: they are said
        // here, in the person's language, for this state and the caller.
        const refusal =
          extractErrorCode(err) === COMPARISON_OFFLINE
            ? new AppError({
                code: COMPARISON_OFFLINE,
                message: t('history.compareOffline'),
              })
            : err;
        // A refusal's own words, else the localized line for a fault.
        const message = failureDetail(refusal) ?? t('history.compareFailed');
        setState({ result: null, error: message, isPending: false });
        throw refusal;
      }
    },
    [compareAction, organizationId, t],
  );

  const reset = useCallback(() => {
    setState({ result: null, error: null, isPending: false });
  }, []);

  return {
    compare,
    reset,
    result: state.result,
    error: state.error,
    isPending: state.isPending,
  };
}
