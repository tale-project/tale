import { Bot, User } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

/**
 * Minimal assignee indicator: a Bot glyph for agents, a User glyph for humans,
 * tooltip = the raw id. The directory-resolved display name + real avatar lands
 * with the assignee picker (later in M1) and the collaboration milestone.
 */
export function AssigneeAvatar({
  assigneeType,
  assigneeId,
  size = 'sm',
}: {
  assigneeType?: 'user' | 'agent';
  assigneeId?: string;
  size?: 'sm' | 'md';
}) {
  const dimension = size === 'md' ? 'size-7' : 'size-5';
  const icon = size === 'md' ? 'size-4' : 'size-3';

  if (!assigneeType || !assigneeId) {
    return (
      <span
        className={cn(
          dimension,
          'inline-flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground',
        )}
        aria-label="Unassigned"
      >
        <User className={icon} aria-hidden="true" />
      </span>
    );
  }

  const isAgent = assigneeType === 'agent';
  return (
    <span
      title={assigneeId}
      className={cn(
        dimension,
        'inline-flex items-center justify-center rounded-full',
        isAgent ? 'bg-blue-100 text-blue-800' : 'bg-muted text-foreground',
      )}
    >
      {isAgent ? (
        <Bot className={icon} aria-hidden="true" />
      ) : (
        <User className={icon} aria-hidden="true" />
      )}
    </span>
  );
}
