'use client';

import { X } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useComposerCapabilities } from '../hooks/use-composer-capabilities';

interface ComposerCapabilityPillsProps {
  organizationId: string;
}

export function ComposerCapabilityPills({
  organizationId,
}: ComposerCapabilityPillsProps) {
  const { t } = useT('composer');
  const { enabledCapabilities, setCapabilityEnabled } = useChatLayout();
  const capabilities = useComposerCapabilities(organizationId);

  const active = capabilities.filter(
    (cap) => cap.ready && enabledCapabilities.includes(cap.slug),
  );

  if (active.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {active.map((cap) => {
        const Icon = cap.icon;
        return (
          <Tooltip key={cap.slug} content={cap.tooltip} side="top">
            <div className="group bg-accent text-accent-foreground ring-border/60 hover:bg-accent/80 inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 transition-colors">
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{cap.label}</span>
              <button
                type="button"
                aria-label={t('capabilityDisable', { name: cap.label })}
                onClick={() => setCapabilityEnabled(cap.slug, false)}
                className="hover:bg-foreground/10 focus-visible:ring-ring -mr-1 ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:outline-none"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
