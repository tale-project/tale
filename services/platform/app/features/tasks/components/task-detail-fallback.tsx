import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { ResponsiveDialogTitle } from '@tale/ui/responsive-dialog';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

/**
 * What the task sheet shows before it has a task: a skeleton while the read
 * is in flight, a "we couldn't find that task" state with Close when the
 * read settled on nothing (a deleted task, a stale notification link, a
 * tampered `?task=`), and the generic failure when the read broke.
 */
export function TaskDetailFallback({
  state,
  onClose,
}: {
  state: 'loading' | 'missing' | 'error';
  onClose: () => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  if (state === 'loading') {
    return (
      <>
        <ResponsiveDialogTitle className="sr-only">
          {t('title')}
        </ResponsiveDialogTitle>
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
      <ResponsiveDialogTitle className="text-lg leading-snug font-semibold">
        {t('title')}
      </ResponsiveDialogTitle>
      <Text as="p" variant="muted" role="status">
        {state === 'missing' ? t('detail.notFound') : tCommon('errors.generic')}
      </Text>
      <Row gap={2} justify="end">
        <Button type="button" variant="secondary" onClick={onClose}>
          {tCommon('actions.close')}
        </Button>
      </Row>
    </Stack>
  );
}
