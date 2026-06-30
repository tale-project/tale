'use client';

/**
 * Surface a rejected fire-and-forget install/reinstall as a destructive toast
 * (+ console.error) instead of letting it vanish as an unhandled promise
 * rejection.
 *
 * The one-click Install / "Add to this project" / readiness Reinstall handlers
 * call these actions without awaiting them, so without this they'd swallow
 * failures silently. The install wizard (`doInstall`) and the ⋯ lifecycle menu
 * (`AppLifecycleActions`) already do their own try/catch + toast, so they don't
 * use this helper.
 *
 * `failureTitle` is passed pre-resolved (the caller runs `t(...)`) so the i18n
 * key stays statically visible to the message-usage check.
 */
import { toast } from '@/app/hooks/use-toast';

export function notifyOnInstallFailure(
  action: Promise<unknown>,
  failureTitle: string,
): void {
  void action.catch((err: unknown) => {
    console.error(err);
    toast({
      title: failureTitle,
      description: err instanceof Error ? err.message : undefined,
      variant: 'destructive',
    });
  });
}
