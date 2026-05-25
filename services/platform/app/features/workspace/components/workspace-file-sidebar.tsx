'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { memo } from 'react';

import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format-bytes';

import type { ThreadFileItem } from '../types';

interface WorkspaceFileSidebarProps {
  files: ThreadFileItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
}

function WorkspaceFileSidebarComponent({
  files,
  activePath,
  onSelect,
}: WorkspaceFileSidebarProps) {
  const { locale } = useLocale();
  return (
    <div className="border-border flex w-48 shrink-0 flex-col overflow-y-auto border-r">
      <ul className="flex flex-col py-1">
        {files.map((f) => {
          const isActive = f.path === activePath;
          const filename = f.path.split('/').pop() ?? f.path;
          const dir = f.path.includes('/')
            ? f.path.slice(0, f.path.lastIndexOf('/'))
            : null;
          return (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                className={cn(
                  'hover:bg-muted/60 flex w-full flex-col gap-0.5 px-3 py-1.5 text-left text-xs transition-colors',
                  isActive && 'bg-muted',
                )}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="truncate font-mono">{filename}</span>
                <span className="text-muted-foreground flex items-center gap-1 truncate text-[10px]">
                  {dir && <span className="truncate">{dir}/</span>}
                  <span>· {formatBytes(f.size, locale)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {files.length === 0 && (
        <div className="text-muted-foreground p-3">
          <Text variant="caption">No files yet</Text>
        </div>
      )}
    </div>
  );
}

export const WorkspaceFileSidebar = memo(WorkspaceFileSidebarComponent);
