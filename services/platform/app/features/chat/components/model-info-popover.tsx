'use client';

import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useState } from 'react';

const TAG_LABEL_KEYS: Record<string, string> = {
  chat: 'modelSelector.tags.chat',
  vision: 'modelSelector.tags.vision',
  embedding: 'modelSelector.tags.embedding',
  'image-generation': 'modelSelector.tags.imageGeneration',
  'image-edit': 'modelSelector.tags.imageEdit',
  transcription: 'modelSelector.tags.transcription',
  'text-to-speech': 'modelSelector.tags.textToSpeech',
};

interface InfoRowProps {
  label: string;
  children: React.ReactNode;
}

function InfoRow({ label, children }: InfoRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <Text variant="muted" className="shrink-0 text-xs">
        {label}
      </Text>
      <div className="text-right text-xs">{children}</div>
    </div>
  );
}

interface ModelInfoPopoverProps {
  /** Human-readable provider name (the provider's displayName). */
  providerName?: string;
  /** Locale-resolved model description; shown as prose at the top of the popover. */
  description?: string;
  /** Capability tags for the model (chat, vision, …). */
  tags: string[];
  /** Provider slug for the settings link; omit to hide the link (non-admins). */
  providerSlug?: string;
  organizationId: string;
  t: (key: string) => string;
}

/**
 * Single info affordance per model row. Replaces the old capability-icon strip
 * and the provider-settings sliders link with one `Info` button that opens a
 * popover summarising the model's provider, capability types, and — for admins
 * who can manage providers — a link to that provider's settings.
 */
export function ModelInfoPopover({
  providerName,
  description,
  tags,
  providerSlug,
  organizationId,
  t,
}: ModelInfoPopoverProps) {
  const [open, setOpen] = useState(false);

  const typeLabels = tags
    .map((tag) => TAG_LABEL_KEYS[tag])
    .filter((key): key is string => Boolean(key))
    .map((key) => t(key));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="end"
      sideOffset={6}
      contentClassName="w-60"
      onOpenAutoFocus={(e) => e.preventDefault()}
      trigger={
        <button
          type="button"
          aria-label={t('modelSelector.viewInfo')}
          className="text-muted-foreground hover:text-foreground mt-0.5 flex items-center rounded-sm transition-colors"
          // Stop the row's select-and-close handler: clicking info should open
          // the popover, not pick the model.
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      }
    >
      {/* Popover content renders in a portal, outside the SearchableSelect's
          DOM subtree, so clicks here never bubble to the row's select handler —
          no stopPropagation needed. */}
      <div className="space-y-3">
        {description ? (
          <Text variant="muted" className="text-xs leading-relaxed">
            {description}
          </Text>
        ) : null}
        {providerName ? (
          <InfoRow label={t('modelSelector.info.provider')}>
            <Text className="text-xs">{providerName}</Text>
          </InfoRow>
        ) : null}
        {typeLabels.length ? (
          <InfoRow label={t('modelSelector.info.type')}>
            <Text className="text-xs">{typeLabels.join(', ')}</Text>
          </InfoRow>
        ) : null}
        {providerSlug ? (
          <Link
            to="/dashboard/$id/settings/providers/$providerName"
            params={{ id: organizationId, providerName: providerSlug }}
            className="text-primary block text-xs hover:underline"
            onClick={() => setOpen(false)}
          >
            {t('modelSelector.viewProvider')}
          </Link>
        ) : null}
      </div>
    </Popover>
  );
}
