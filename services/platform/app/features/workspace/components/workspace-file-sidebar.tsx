'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Terminal,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format-bytes';

import type { ThreadFileItem } from '../types';

interface WorkspaceFileSidebarProps {
  files: ThreadFileItem[];
  activePath: string | null;
  onSelect: (path: string) => void;
  /** Paths currently being streamed by a `file_write` tool. Marks the row with a pulse + "Writing…" meta. */
  streamingPaths?: Set<string>;
}

type SourceKey = 'run_output' | 'agent_write' | 'user_upload';

interface SectionSpec {
  key: SourceKey;
  labelKey: string;
  defaultLabel: string;
  icon: LucideIcon;
  defaultOpen: boolean;
  /** Tailwind classes for the section header (visual weight tier). */
  headerClass: string;
  iconClass: string;
  /** Extra wrapper classes — used to mark the tertiary "footer" zone. */
  wrapperClass?: string;
}

const SECTIONS: SectionSpec[] = [
  {
    key: 'run_output',
    labelKey: 'canvas.sourceRunOutput',
    defaultLabel: 'Code output',
    icon: Terminal,
    defaultOpen: true,
    headerClass: 'text-sm font-semibold text-foreground',
    iconClass: 'size-4',
  },
  {
    key: 'agent_write',
    labelKey: 'canvas.sourceAgentWrite',
    defaultLabel: 'AI files',
    icon: Sparkles,
    defaultOpen: true,
    headerClass: 'text-sm font-medium text-foreground',
    iconClass: 'size-3.5',
  },
  {
    key: 'user_upload',
    labelKey: 'canvas.sourceUserUpload',
    defaultLabel: 'Uploaded',
    icon: Upload,
    defaultOpen: false,
    headerClass: 'text-xs font-normal text-muted-foreground',
    iconClass: 'size-3.5',
    wrapperClass: 'border-border/60 mt-2 border-t pt-2',
  },
];

function WorkspaceFileSidebarComponent({
  files,
  activePath,
  onSelect,
  streamingPaths,
}: WorkspaceFileSidebarProps) {
  const { t } = useT('chat');
  const { locale } = useLocale();

  const grouped = useMemo(() => {
    const out: Record<SourceKey, ThreadFileItem[]> = {
      run_output: [],
      agent_write: [],
      user_upload: [],
    };
    for (const f of files) {
      out[f.source].push(f);
    }
    return out;
  }, [files]);

  const [openState, setOpenState] = useState<Record<SourceKey, boolean>>(() => {
    const init: Record<SourceKey, boolean> = {
      run_output: false,
      agent_write: false,
      user_upload: false,
    };
    for (const s of SECTIONS) init[s.key] = s.defaultOpen;
    return init;
  });

  // Auto-open the section that contains the active file (so a tertiary
  // file the user just clicked stays visible).
  useEffect(() => {
    if (!activePath) return;
    const containing = files.find((f) => f.path === activePath);
    if (!containing) return;
    setOpenState((prev) =>
      prev[containing.source] ? prev : { ...prev, [containing.source]: true },
    );
  }, [activePath, files]);

  const totalCount = files.length;

  return (
    <Stack
      gap={0}
      className="border-border w-56 shrink-0 overflow-y-auto border-r py-1"
    >
      {SECTIONS.map((section) => {
        const items = grouped[section.key];
        if (items.length === 0) return null;
        const isOpen = openState[section.key];
        const label = t(section.labelKey, {
          defaultValue: section.defaultLabel,
        });
        const Icon = section.icon;
        const Chevron = isOpen ? ChevronDown : ChevronRight;
        return (
          <div key={section.key} className={cn('px-1', section.wrapperClass)}>
            <button
              type="button"
              onClick={() =>
                setOpenState((prev) => ({
                  ...prev,
                  [section.key]: !prev[section.key],
                }))
              }
              aria-expanded={isOpen}
              className={cn(
                'hover:bg-muted/40 flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors',
                section.headerClass,
              )}
            >
              <Chevron className="text-muted-foreground size-3 shrink-0" />
              <Icon
                className={cn(
                  'text-muted-foreground shrink-0',
                  section.iconClass,
                )}
              />
              <span className="truncate">{label}</span>
              <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
                {items.length}
              </span>
            </button>
            {isOpen && (
              <Stack as="ul" gap={0} className="py-0.5">
                {items.map((f) => {
                  const isActive = f.path === activePath;
                  const isStreaming = streamingPaths?.has(f.path) ?? false;
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
                          'hover:bg-muted/60 flex w-full flex-col gap-0.5 rounded px-3 py-1.5 text-left text-xs transition-colors',
                          isActive && 'bg-muted',
                        )}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span className="flex items-center gap-1.5 truncate font-mono">
                          {isStreaming && (
                            <span
                              className="bg-primary inline-block size-1.5 shrink-0 animate-pulse rounded-full"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{filename}</span>
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1 truncate text-[10px]">
                          {dir && <span className="truncate">{dir}/</span>}
                          {isStreaming ? (
                            <span>
                              ·{' '}
                              {t('canvas.writing', {
                                defaultValue: 'Writing…',
                              })}
                            </span>
                          ) : (
                            <span>· {formatBytes(f.size, locale)}</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </Stack>
            )}
          </div>
        );
      })}
      {totalCount === 0 && (
        <div className="text-muted-foreground p-3">
          <Text variant="caption">
            {t('canvas.noFilesYet', { defaultValue: 'No files yet' })}
          </Text>
        </div>
      )}
    </Stack>
  );
}

export const WorkspaceFileSidebar = memo(WorkspaceFileSidebarComponent);
