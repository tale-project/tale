import { Badge } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';

import { TASK_PRIORITY_BADGE_VARIANT, type TaskPriority } from '../lib/display';

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useT('tasks');
  return (
    <Badge variant={TASK_PRIORITY_BADGE_VARIANT[priority]}>
      {t(`priority.${priority}`)}
    </Badge>
  );
}
