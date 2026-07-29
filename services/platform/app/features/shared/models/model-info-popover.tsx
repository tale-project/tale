'use client';

import { Row } from '@tale/ui/layout';
import { Popover } from '@tale/ui/popover';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

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
    <Row gap={3} align="start" justify="between">
      <Text variant="muted" className="shrink-0 text-xs">
        {label}
      </Text>
      <div className="text-right text-xs">{children}</div>
    </Row>
  );
}

/** The capability fields surfaced in the popover — a structural subset of the
 *  `getModelCapabilities` query row, so callers can pass that row straight
 *  through. All optional: the source only reports what it knows. */
export interface ModelInfoCapabilities {
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCentsPerMillion?: number;
  outputCentsPerMillion?: number;
  reasoning?: { knob: 'effort' | 'budget-tokens' };
  promptCaching?: { mode: 'explicit-breakpoints' | 'auto-server' | 'none' };
  supportsTools?: boolean;
  supportsVision?: boolean;
}

interface ModelInfoPopoverProps {
  /** Human-readable provider name (the provider's displayName). */
  providerName?: string;
  /** Locale-resolved model description; shown as prose at the top of the popover. */
  description?: string;
  /** Capability tags for the model (chat, vision, …). */
  tags: string[];
  /** Cached catalog capabilities (cost, context window, reasoning, …). When
   *  present, each known field renders as its own row below provider/type. */
  capabilities?: ModelInfoCapabilities;
  /** Provider slug for the settings link; omit to hide the link (non-admins). */
  providerSlug?: string;
  organizationId: string;
  /** Extra classes for the trigger button — e.g. `mt-0` to undo the default
   *  list-baseline nudge when placed beside a form control instead of a row. */
  triggerClassName?: string;
}

/** `1000000` → `1M`, `128000` → `128K`, smaller counts kept as-is. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(n);
}

/** Cents-per-million → a `$X/M` dollar string (the cache stores cents). */
function formatCost(centsPerMillion: number): string {
  const dollars = centsPerMillion / 100;
  // Sub-dollar prices need cents precision; whole-dollar+ reads fine at 2dp.
  return `$${dollars < 1 ? dollars.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : dollars.toFixed(2)}/M`;
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
  capabilities,
  providerSlug,
  organizationId,
  triggerClassName,
}: ModelInfoPopoverProps) {
  const { t } = useT('chat');
  const [open, setOpen] = useState(false);

  const typeLabels = tags
    .map((tag) => TAG_LABEL_KEYS[tag])
    .filter((key): key is string => Boolean(key))
    .map((key) => t(key));

  const reasoningLabel = capabilities?.reasoning
    ? capabilities.reasoning.knob === 'effort'
      ? t('modelSelector.info.reasoningEffort')
      : t('modelSelector.info.reasoningBudget')
    : null;
  const cachingLabel =
    capabilities?.promptCaching && capabilities.promptCaching.mode !== 'none'
      ? capabilities.promptCaching.mode === 'explicit-breakpoints'
        ? t('modelSelector.info.cachingExplicit')
        : t('modelSelector.info.cachingAuto')
      : null;

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
          className={cn(
            'text-muted-foreground hover:text-foreground mt-0.5 flex items-center rounded-sm transition-colors',
            triggerClassName,
          )}
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
        {capabilities?.contextWindow ? (
          <InfoRow label={t('modelSelector.info.contextWindow')}>
            <Text className="text-xs">
              {formatTokens(capabilities.contextWindow)}
            </Text>
          </InfoRow>
        ) : null}
        {capabilities?.maxOutputTokens ? (
          <InfoRow label={t('modelSelector.info.maxOutput')}>
            <Text className="text-xs">
              {formatTokens(capabilities.maxOutputTokens)}
            </Text>
          </InfoRow>
        ) : null}
        {capabilities?.inputCentsPerMillion != null ? (
          <InfoRow label={t('modelSelector.info.inputCost')}>
            <Text className="text-xs">
              {formatCost(capabilities.inputCentsPerMillion)}
            </Text>
          </InfoRow>
        ) : null}
        {capabilities?.outputCentsPerMillion != null ? (
          <InfoRow label={t('modelSelector.info.outputCost')}>
            <Text className="text-xs">
              {formatCost(capabilities.outputCentsPerMillion)}
            </Text>
          </InfoRow>
        ) : null}
        {reasoningLabel ? (
          <InfoRow label={t('modelSelector.info.reasoning')}>
            <Text className="text-xs">{reasoningLabel}</Text>
          </InfoRow>
        ) : null}
        {cachingLabel ? (
          <InfoRow label={t('modelSelector.info.promptCaching')}>
            <Text className="text-xs">{cachingLabel}</Text>
          </InfoRow>
        ) : null}
        {capabilities?.supportsTools != null ? (
          <InfoRow label={t('modelSelector.info.tools')}>
            <Text className="text-xs">
              {t(
                capabilities.supportsTools
                  ? 'modelSelector.info.supported'
                  : 'modelSelector.info.notSupported',
              )}
            </Text>
          </InfoRow>
        ) : null}
        {capabilities?.supportsVision != null ? (
          <InfoRow label={t('modelSelector.info.vision')}>
            <Text className="text-xs">
              {t(
                capabilities.supportsVision
                  ? 'modelSelector.info.supported'
                  : 'modelSelector.info.notSupported',
              )}
            </Text>
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
