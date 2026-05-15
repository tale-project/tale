/**
 * `PiiConfigPreview` — the live-tokenizer preview pane.
 *
 * Split out of `pii-config-panel.tsx` so the heavy code path is in its
 * own bundle chunk. The panel itself only needs lightweight UI imports;
 * everything in this file (the tokenizer, the 43-locale registry, and
 * libphonenumber-js) lazy-loads when the panel actually mounts. Without
 * the split, every consumer of `<PiiConfigPanel>` pays the detector
 * bundle cost on the panel's first render even if the user never
 * scrolls down to the preview.
 *
 * Lives in the same package as the panel so that the panel can pull it
 * in via `React.lazy(() => import('./pii-config-preview'))`.
 */

import type { TFunction } from 'i18next';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  createTokenizer,
  type TokenEntry,
  type TokenizeResult,
  type Tokenizer,
} from '@/lib/pii';

import type { PiiConfigPanelValue } from './pii-config-panel';
import {
  PiiHighlightedText,
  type PiiHighlightSegment,
} from './pii-highlighted-text';
import { piiTypeIcon } from './pii-type-icons';
import { piiTypeLabel } from './pii-type-labels';

export interface PiiConfigPreviewProps {
  config: PiiConfigPanelValue;
  detectionLocales: string | string[];
  initialInput: string;
  mockAi: (prompt: string) => string;
}

export function PiiConfigPreview({
  config,
  detectionLocales,
  initialInput,
  mockAi,
}: PiiConfigPreviewProps): ReactNode {
  // Resolve translations here (rather than receive them as props) so the
  // i18n key-usage scanner can see the `useT('piiConfigPanel')` /
  // `useT('piiTypes')` namespace bindings and the static `tPiiConfigPanel('...')`
  // literals together — props-passed TFunctions hide that linkage.
  const { t: tPiiConfigPanel } = useT('piiConfigPanel');
  const { t: tTypes } = useT('piiTypes');
  const [input, setInput] = useState(initialInput);
  const [aiResponseOverride, setAiResponseOverride] = useState<string | null>(
    null,
  );

  // Build the patterns object the tokenizer expects from the active
  // config. Unenabled built-ins map to `false`; address / nationalId
  // carry their locale selector when enabled.
  const tokenizer: Tokenizer = useMemo(() => {
    const locales =
      detectionLocales === '*' ? ('*' as const) : [detectionLocales].flat();
    const enabled = new Set(config.enabledPatterns);
    const isEnabled = (name: string) => enabled.has(name);
    return createTokenizer({
      mode: 'tokenize',
      patterns: {
        email: isEnabled('email'),
        phone: isEnabled('phone'),
        creditCard: isEnabled('creditCard'),
        cvc: isEnabled('cvc'),
        iban: isEnabled('iban'),
        ipAddress: isEnabled('ipAddress'),
        ssn: isEnabled('ssn'),
        dateOfBirth: isEnabled('dateOfBirth'),
        address: isEnabled('address') ? { locales } : false,
        nationalId: isEnabled('nationalId') ? { locales } : false,
      },
      customPatterns: config.customPatterns,
    });
  }, [config.enabledPatterns, config.customPatterns, detectionLocales]);

  const result: TokenizeResult = useMemo(
    () => tokenizer.tokenize(input),
    [tokenizer, input],
  );

  // Reset AI override whenever input or tokens change.
  useEffect(() => {
    setAiResponseOverride(null);
  }, [input, config.mode, config.enabledPatterns, config.customPatterns]);

  const detectedSegments: PiiHighlightSegment[] = result.segments.map((s) => ({
    start: s.start,
    end: s.end,
    type: s.type,
  }));

  const anyPatternsEnabled =
    config.enabledPatterns.length > 0 || config.customPatterns.length > 0;

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)]/40 p-4">
      <Stage
        step={1}
        title={tPiiConfigPanel('inputTitle')}
        hint={tPiiConfigPanel('inputHint')}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          aria-label={tPiiConfigPanel('inputTitle')}
          className="w-full rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 font-sans text-sm leading-relaxed text-[color:var(--color-fg-base)] focus:ring-2 focus:ring-[color:var(--color-accent-base)]/30 focus:outline-none"
        />
      </Stage>

      <Stage
        step={2}
        title={tPiiConfigPanel('detectedTitle')}
        hint={tPiiConfigPanel('detectedHint')}
      >
        {!anyPatternsEnabled ? (
          <NoPatternsNotice tPiiConfigPanel={tPiiConfigPanel} />
        ) : (
          <>
            <DetectionSummary
              result={result}
              tTypes={tTypes}
              tPiiConfigPanel={tPiiConfigPanel}
            />
            <PiiHighlightedText
              text={input}
              segments={detectedSegments}
              variant="redacted"
              className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-sm"
            />
          </>
        )}
      </Stage>

      {config.mode === 'tokenize' && anyPatternsEnabled && (
        <TokenizeStages
          result={result}
          tokenizer={tokenizer}
          mockAi={mockAi}
          aiResponseOverride={aiResponseOverride}
          setAiResponseOverride={setAiResponseOverride}
          tPiiConfigPanel={tPiiConfigPanel}
        />
      )}

      {config.mode === 'mask' && anyPatternsEnabled && (
        <MaskStage
          input={input}
          result={result}
          tPiiConfigPanel={tPiiConfigPanel}
        />
      )}

      {config.mode === 'block' && anyPatternsEnabled && (
        <BlockStage
          input={input}
          result={result}
          tPiiConfigPanel={tPiiConfigPanel}
        />
      )}
    </div>
  );
}

// Default export so the dynamic-import wrapper in pii-config-panel can
// use `React.lazy(() => import(...))` without an additional `.then(mod => ...)`.
export default PiiConfigPreview;

function NoPatternsNotice({
  tPiiConfigPanel,
}: {
  tPiiConfigPanel: TFunction;
}): ReactNode {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-xs text-[color:var(--color-fg-muted)]"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
      <span>{tPiiConfigPanel('noPatternsEnabled')}</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Preview stages
// -----------------------------------------------------------------------------

interface StageProps {
  step: number;
  title: string;
  hint: string;
  children: ReactNode;
}

function Stage({ step, title, hint, children }: StageProps): ReactNode {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--color-accent-base)] text-xs font-medium text-[color:var(--color-accent-fg)]"
        >
          {step}
        </span>
        <h4 className="text-sm font-medium text-[color:var(--color-fg-base)]">
          {title}
        </h4>
        {hint && (
          <span className="text-xs text-[color:var(--color-fg-muted)]">
            {hint}
          </span>
        )}
      </header>
      <div className="ml-9 flex flex-col gap-2">{children}</div>
    </section>
  );
}

interface TokenizeStagesProps {
  result: TokenizeResult;
  tokenizer: Tokenizer;
  mockAi: (prompt: string) => string;
  aiResponseOverride: string | null;
  setAiResponseOverride: (value: string | null) => void;
  tPiiConfigPanel: TFunction;
}

function TokenizeStages({
  result,
  tokenizer,
  mockAi,
  aiResponseOverride,
  setAiResponseOverride,
  tPiiConfigPanel,
}: TokenizeStagesProps): ReactNode {
  const tokenizedSegments = computeTokenSegments(result);
  const aiResponse = aiResponseOverride ?? mockAi(result.text);
  const restored = tokenizer.detokenize(aiResponse, result.mapping);
  const restoredSegments = computeRestoredSegments(restored, result.mapping);

  return (
    <>
      <Stage
        step={3}
        title={tPiiConfigPanel('tokenizedTitle')}
        hint={tPiiConfigPanel('tokenizedHint')}
      >
        <PiiHighlightedText
          text={result.text}
          segments={tokenizedSegments}
          variant="tokenized"
          className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-sm"
        />
      </Stage>

      <Stage
        step={4}
        title={tPiiConfigPanel('aiTitle')}
        hint={tPiiConfigPanel('aiHint')}
      >
        <textarea
          value={aiResponse}
          onChange={(e) => setAiResponseOverride(e.target.value)}
          rows={5}
          aria-label={tPiiConfigPanel('aiTitle')}
          className="w-full rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 font-mono text-sm leading-relaxed text-[color:var(--color-fg-base)] focus:ring-2 focus:ring-[color:var(--color-accent-base)]/30 focus:outline-none"
        />
      </Stage>

      <Stage
        step={5}
        title={tPiiConfigPanel('restoredTitle')}
        hint={tPiiConfigPanel('restoredHint')}
      >
        <PiiHighlightedText
          text={restored}
          segments={restoredSegments}
          variant="restored"
          className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-sm"
        />
      </Stage>
    </>
  );
}

interface MaskStageProps {
  input: string;
  result: TokenizeResult;
  tPiiConfigPanel: TFunction;
}

function MaskStage({
  input,
  result,
  tPiiConfigPanel,
}: MaskStageProps): ReactNode {
  // Build the masked output by splicing each detected span's generic
  // mask token (`[EMAIL]`, `[PHONE]`, …) end-to-start so indices stay
  // valid. Same approach the playground used previously.
  const maskedSegments: PiiHighlightSegment[] = [];
  let masked = input;
  const ordered = [...result.segments].sort((a, b) => b.start - a.start);
  for (const seg of ordered) {
    const token = `[${seg.type.toUpperCase()}]`;
    masked = masked.slice(0, seg.start) + token + masked.slice(seg.end);
  }
  const inputOrdered = [...result.segments].sort((a, b) => a.start - b.start);
  let drift = 0;
  for (const seg of inputOrdered) {
    const token = `[${seg.type.toUpperCase()}]`;
    const start = seg.start + drift;
    const end = start + token.length;
    maskedSegments.push({ start, end, type: seg.type, label: token });
    drift += token.length - (seg.end - seg.start);
  }

  return (
    <Stage
      step={3}
      title={tPiiConfigPanel('maskedTitle')}
      hint={tPiiConfigPanel('maskedHint')}
    >
      <PiiHighlightedText
        text={masked}
        segments={maskedSegments}
        variant="tokenized"
        className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-sm"
      />
    </Stage>
  );
}

interface BlockStageProps {
  input: string;
  result: TokenizeResult;
  tPiiConfigPanel: TFunction;
}

function BlockStage({
  input,
  result,
  tPiiConfigPanel,
}: BlockStageProps): ReactNode {
  const blocked = result.segments.length > 0;
  const categories = [...new Set(result.segments.map((s) => s.type))];
  // Re-mount on every detection-set change so the notice "pulses" — the
  // playground originally added this to fix a UX bug where an identical
  // re-block produced no visible feedback. Keep the same trick here.
  const noticeKey = blocked
    ? `b:${categories.join(',')}:${input.length}:${result.segments.length}`
    : `p:${input.length}`;
  return (
    <Stage
      step={3}
      title={
        blocked
          ? tPiiConfigPanel('blockTitle')
          : tPiiConfigPanel('blockPassTitle')
      }
      hint={blocked ? tPiiConfigPanel('blockHint') : ''}
    >
      <BlockNotice
        key={noticeKey}
        blocked={blocked}
        categories={categories}
        tPiiConfigPanel={tPiiConfigPanel}
        matchCount={result.segments.length}
      />
    </Stage>
  );
}

interface BlockNoticeProps {
  blocked: boolean;
  categories: string[];
  matchCount: number;
  tPiiConfigPanel: TFunction;
}

function BlockNotice({
  blocked,
  categories,
  matchCount,
  tPiiConfigPanel,
}: BlockNoticeProps): ReactNode {
  if (!blocked) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 rounded-md border border-[color:var(--color-success-base)]/40 bg-[color:var(--color-success-base)]/10 p-3 text-sm text-[color:var(--color-success-fg)]"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{tPiiConfigPanel('blockPassBody')}</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2 rounded-md border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 p-3 text-sm text-[color:var(--color-danger)]"
    >
      <ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span>{tPiiConfigPanel('blockBody')}</span>
        <span className="text-xs opacity-80">
          {categories.join(', ')} · {matchCount}{' '}
          {tPiiConfigPanel('detectionCount')}
        </span>
      </div>
    </div>
  );
}

interface SummaryProps {
  result: TokenizeResult;
  tTypes: TFunction;
  tPiiConfigPanel: TFunction;
}

function DetectionSummary({
  result,
  tTypes,
  tPiiConfigPanel,
}: SummaryProps): ReactNode {
  const byType = new Map<string, number>();
  for (const seg of result.segments) {
    byType.set(seg.type, (byType.get(seg.type) ?? 0) + 1);
  }
  if (byType.size === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
        <ShieldAlert className="size-3.5 shrink-0 opacity-60" aria-hidden />
        <span>{tPiiConfigPanel('noPii')}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...byType.entries()].map(([type, count]) => {
        const Icon = piiTypeIcon(type);
        return (
          <span
            key={type}
            className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-warning-base)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--color-warning-fg)] ring-1 ring-[color:var(--color-warning-base)]/30"
          >
            <Icon className="size-3 opacity-80" aria-hidden />
            {piiTypeLabel(type, tTypes)}
            {count > 1 && (
              <span className="text-[10px] opacity-80">×{count}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function computeTokenSegments(result: TokenizeResult): PiiHighlightSegment[] {
  if (Object.keys(result.mapping).length === 0) return [];
  const out: PiiHighlightSegment[] = [];
  for (const [token, entry] of Object.entries(result.mapping)) {
    let idx = 0;
    while ((idx = result.text.indexOf(token, idx)) !== -1) {
      out.push({
        start: idx,
        end: idx + token.length,
        type: entry.type,
        label: token,
      });
      idx += token.length;
    }
  }
  return out;
}

function computeRestoredSegments(
  restored: string,
  mapping: Record<string, TokenEntry>,
): PiiHighlightSegment[] {
  if (Object.keys(mapping).length === 0) return [];
  const out: PiiHighlightSegment[] = [];
  for (const entry of Object.values(mapping)) {
    if (!entry.value) continue;
    let idx = 0;
    while ((idx = restored.indexOf(entry.value, idx)) !== -1) {
      out.push({
        start: idx,
        end: idx + entry.value.length,
        type: entry.type,
      });
      idx += entry.value.length;
    }
  }
  return out;
}
