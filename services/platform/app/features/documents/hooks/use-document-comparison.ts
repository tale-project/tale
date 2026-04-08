import { useCallback, useState } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import type { DocumentComparisonResult } from '@/convex/agent_tools/documents/helpers/fetch_document_comparison';

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
  const { mutateAsync: compareAction } = useConvexAction(
    api.documents.compare_documents.compareDocuments,
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
          throw new Error('Invalid comparison response');
        }
        setState({
          result,
          error: null,
          isPending: false,
        });
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Comparison failed';
        setState({ result: null, error: message, isPending: false });
        throw err;
      }
    },
    [compareAction, organizationId],
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
