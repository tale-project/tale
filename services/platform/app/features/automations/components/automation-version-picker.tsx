'use client';

import { Button } from '@tale/ui/button';
import { ErrorDisplayCompact } from '@tale/ui/error-boundaries/error-display-compact';
import { Popover } from '@tale/ui/popover';
import { Spinner } from '@tale/ui/spinner';
import { ChevronDown } from 'lucide-react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useT } from '@/lib/i18n/client';

import { useAutomationVersions } from '../hooks/queries';
import { AutomationVersionPickerTarget } from './automation-version-picker-target';
import { VersionList } from './version-list';

interface AutomationVersionPickerProps {
  organizationId: string;
  automationSlug: string;
  projectId?: string;
  currentVersion?: number;
  deployedVersion?: number;
  onSelectVersion?: (version: number) => void;
  showHistory?: boolean;
  portal?: boolean;
}

export function AutomationVersionPicker({
  organizationId,
  automationSlug,
  projectId,
  currentVersion,
  deployedVersion,
  onSelectVersion,
  showHistory = false,
  portal = false,
}: AutomationVersionPickerProps) {
  const { t } = useT('automations');
  const headingId = useId();
  const headingRef = useRef<HTMLSpanElement>(null);
  const target = useContext(AutomationVersionPickerTarget);
  const [open, setOpen] = useState(showHistory);
  const versions = useAutomationVersions(organizationId, automationSlug);
  useEffect(() => {
    if (showHistory) setOpen(true);
  }, [showHistory]);

  const picker = (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      aria-labelledby={headingId}
      contentClassName="w-[min(28rem,calc(100vw-1rem))] max-w-none p-2"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('detail.versionSelect')}
          className="w-auto shrink-0 gap-1.5"
        >
          {currentVersion === undefined
            ? t('versions.title')
            : t('versions.versionLabel', { version: currentVersion })}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
    >
      <span
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-muted-foreground block px-3 pt-1 pb-2 text-xs font-medium"
      >
        {t('versions.title')}
      </span>
      {versions.isPending ? (
        <Spinner label={t('versions.title')} />
      ) : versions.isError ? (
        <div role="alert">
          <ErrorDisplayCompact
            error={versions.error}
            organizationId={organizationId}
            reset={() => void versions.refetch()}
            onFocusLost={() => headingRef.current?.focus()}
          />
        </div>
      ) : (
        <VersionList
          organizationId={organizationId}
          automationSlug={automationSlug}
          projectId={projectId}
          versions={versions.data ?? []}
          deployedVersion={deployedVersion}
          currentVersion={currentVersion}
          headingId={headingId}
          onSelectVersion={
            onSelectVersion === undefined
              ? undefined
              : (next) => {
                  setOpen(false);
                  if (next !== currentVersion) onSelectVersion(next);
                }
          }
        />
      )}
    </Popover>
  );
  if (!portal) return picker;
  return target === null ? null : createPortal(picker, target);
}
