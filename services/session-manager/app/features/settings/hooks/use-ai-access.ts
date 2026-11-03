import { useQueryClient } from '@tanstack/react-query';

import { useApiMutation } from '@/app/hooks/use-api-mutation';
import { settingsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import { useT } from '@/lib/i18n/client';

import { useSettings } from './use-settings';

/**
 * AI access, which the switch changes at once rather than through Save.
 *
 * Unlike the start page it has no draft to protect: it is one click on one
 * value, and what the switch says must be what the server does. An "on" that
 * waited for Save would leave `/mcp` answering 403 while the page showed the
 * connection instructions, which is how an assistant fails to connect with no
 * hint why. So the write goes out on the click; the switch shows where it is
 * going meanwhile and snaps back if the server refuses, with the one failure
 * toast of `useApiMutation`.
 */
export function useAiAccess() {
  const { t } = useT('settings');
  const queryClient = useQueryClient();
  const settings = useSettings();
  const change = useApiMutation({
    mutationFn: (enabled: boolean) =>
      settingsApi.update({ mcpEnabled: enabled }),
    errorTitle: t('aiAccess.switch.changeFailed'),
    // What follows the switch (how to connect) is shown for the saved value:
    // the answer is that value, so it is shown the moment the change is saved
    // and not after the settings have been read once more.
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.settings, saved);
    },
    invalidates: [queryKeys.settings],
  });

  return {
    settings,
    /** On or off; undefined until the settings are read. */
    enabled: change.isPending ? change.variables : settings.data?.mcpEnabled,
    isPending: change.isPending,
    setEnabled: change.mutate,
  };
}
