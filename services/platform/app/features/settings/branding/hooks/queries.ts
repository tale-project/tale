import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { api } from '@/convex/_generated/api';

export function useBranding() {
  return useActionQuery(
    configKeys.type('branding'),
    api.branding.file_actions.readBranding,
    {},
  );
}
