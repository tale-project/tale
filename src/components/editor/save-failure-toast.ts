import { readableErrorMessage } from '@tale/ui/error-message';
import { toast } from '@tale/ui/use-toast';
import type { TFunction } from 'i18next';

/**
 * The one toast a save that failed on the server raises, whichever gesture
 * ran it: the Save button and ⌘S through `EditorActions`, a native form
 * submit (Enter, a `type="submit"` Save) through `useFormEditor`'s `submit`.
 * It carries the controller's translated sentence, never a structured
 * error's serialized payload (see `EditorController.save`). `t` reads the
 * `common` namespace.
 */
export function toastSaveFailure(error: unknown, t: TFunction): void {
  toast({
    title: t('actions.save'),
    description: readableErrorMessage(error) ?? t('errors.somethingWentWrong'),
    variant: 'destructive',
  });
}
