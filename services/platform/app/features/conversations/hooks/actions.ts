import { useBackendAction } from '@/app/hooks/use-backend-action';

export function useImproveMessage() {
  return useBackendAction('conversations/actions:improveMessage');
}
