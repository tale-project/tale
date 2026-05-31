import { Badge } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';

import { TASK_STATUS_BADGE_VARIANT, type TaskStatus } from '../lib/display';

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useT('tasks');
  return (
    <Badge variant={TASK_STATUS_BADGE_VARIANT[status]} dot>
      {t(`status.${status}`)}
    </Badge>
  );
}
