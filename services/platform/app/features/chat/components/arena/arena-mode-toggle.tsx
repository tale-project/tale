'use client';

import { Button } from '@tale/ui/button';
import { Swords } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useArenaModeOptional } from './arena-mode-context';

export function ArenaModeToggle({ disabled }: { disabled?: boolean }) {
  const { t } = useT('chat');
  const arenaContext = useArenaModeOptional();

  if (!arenaContext) return null;

  const { isArenaMode, enableArenaMode, exitArenaMode } = arenaContext;

  const handleToggle = () => {
    if (isArenaMode) {
      exitArenaMode();
    } else {
      enableArenaMode();
    }
  };

  return (
    <Tooltip
      content={isArenaMode ? t('arena.disable') : t('arena.enable')}
      side="bottom"
      contentClassName="py-1.5"
    >
      <Button
        size="icon"
        variant="ghost"
        onClick={handleToggle}
        disabled={disabled}
        aria-label={t('arena.label')}
        aria-pressed={isArenaMode}
        className={cn(isArenaMode && 'bg-accent text-accent-foreground')}
      >
        <Swords
          className={cn(
            'size-5 p-0.25',
            isArenaMode ? 'text-accent-foreground' : 'text-muted-foreground',
          )}
        />
      </Button>
    </Tooltip>
  );
}
