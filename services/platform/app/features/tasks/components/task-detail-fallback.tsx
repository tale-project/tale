import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { ResponsiveDialogTitle } from '@tale/ui/responsive-dialog';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { TaskReadAlert } from './task-read-alert';

type TaskDetailFallbackProps = {
  /**
   * Where it stands in: the board's task dialog, which it titles, or the
   * task page, where no dialog frames it and its title is the page heading.
   */
  surface?: 'dialog' | 'page';
  /** The dialog's way out. */
  onClose?: () => void;
  /** Takes the focus when a retry that worked takes the failure away. The
   *  dialog leaves it out: its focus trap takes the focus back itself. */
  onFocusLost?: () => void;
} & (
  | { state: 'loading' | 'missing' }
  | {
      state: 'error';
      /** What the read threw: its words follow the failure. */
      error: unknown;
      /** A retry of the read is under way. */
      retrying: boolean;
      /** Reads the task again. */
      onRetry: () => void;
    }
);

/**
 * What a task surface shows before it has a task: a skeleton while the read
 * is in flight, a "we couldn't find that task" state with Close when the
 * read settled on nothing (a deleted task, a stale notification link, a
 * tampered `?task=`), and when the read failed, what failed with **Try
 * again** — never a task that is gone (#4587).
 */
export function TaskDetailFallback(props: TaskDetailFallbackProps) {
  const { surface = 'dialog', onClose, onFocusLost } = props;
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  if (props.state === 'loading') {
    return (
      <>
        <FallbackTitle surface={surface} className="sr-only">
          {t('title')}
        </FallbackTitle>
        <Skeletonize loading>
          <Stack gap={3} aria-busy="true">
            <SkeletonBox>
              <div className="h-3 w-16" />
            </SkeletonBox>
            <SkeletonBox fullWidth>
              <div className="h-7" />
            </SkeletonBox>
            <SkeletonBox fullWidth>
              <div className="h-24" />
            </SkeletonBox>
          </Stack>
        </Skeletonize>
      </>
    );
  }

  return (
    <Stack gap={4}>
      <FallbackTitle
        surface={surface}
        className="text-lg leading-snug font-semibold"
      >
        {t('title')}
      </FallbackTitle>
      {props.state === 'error' ? (
        <TaskReadAlert
          message={[t('detail.loadFailed'), failureDetail(props.error)]
            .filter(Boolean)
            .join(' ')}
          retrying={props.retrying}
          onRetry={props.onRetry}
          onFocusLost={onFocusLost}
        />
      ) : (
        <Text as="p" variant="muted" role="status">
          {t('detail.notFound')}
        </Text>
      )}
      {onClose !== undefined && (
        <Row gap={2} justify="end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tCommon('actions.close')}
          </Button>
        </Row>
      )}
    </Stack>
  );
}

/** The dialog's own title, or the page's heading where no dialog frames it
 *  (a dialog title cannot render outside its dialog). */
function FallbackTitle({
  surface,
  className,
  children,
}: {
  surface: 'dialog' | 'page';
  className: string;
  children: ReactNode;
}) {
  return surface === 'dialog' ? (
    <ResponsiveDialogTitle className={className}>
      {children}
    </ResponsiveDialogTitle>
  ) : (
    <h1 className={className}>{children}</h1>
  );
}
