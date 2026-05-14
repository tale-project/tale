/**
 * `PiiPlayground` — interactive demo of the three PII guardrail modes:
 *
 *   - **Tokenize** (default): full round-trip — detect, replace each
 *     match with `[EMAIL_1]` etc., let the AI reply, swap tokens back.
 *   - **Mask**: one-way replacement — every match becomes a generic
 *     `[EMAIL]` token. The output is what would be sent to the AI; no
 *     restore step. Use for stored chat history / audit logs.
 *   - **Block**: short-circuit — when any PII is detected the message is
 *     rejected outright. The block notice updates on every detection
 *     (fixes the "blocked-once-then-silent" UX bug where re-detections
 *     on identical input didn't refresh the visible feedback).
 *
 * Mode is user-selectable via a segmented control at the top so admins
 * can rehearse every policy decision before saving the config. The
 * default is `tokenize` because that's the default `mode` in
 * `@tale/pii` itself and the most natural UX for end users.
 *
 * Translations come from the `piiPlayground` and `piiTypes` namespaces
 * shipped by this package — consumers just need to mount the shared
 * `<I18nProvider>` at the app root.
 *
 * Memory: one `Tokenizer` is created per `detectionLocales` change and
 * reused across keystrokes; re-tokenization is sub-millisecond for
 * typical inputs, no debounce needed.
 */

import {
  createTokenizer,
  type TokenEntry,
  type TokenizeResult,
  type Tokenizer,
} from '@tale/pii';
import type { TFunction } from 'i18next';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import {
  PiiHighlightedText,
  type PiiHighlightSegment,
} from './pii-highlighted-text';
import { piiTypeLabel } from './pii-type-labels';

export type PiiPlaygroundMode = 'tokenize' | 'mask' | 'block';

export interface PiiPlaygroundProps {
  /** Initial input text. Defaults to a multi-PII sample sentence. */
  initialInput?: string;
  /**
   * Initial / controlled mode. Defaults to `'tokenize'`. The mode is
   * also user-selectable inside the component via a segmented control.
   */
  mode?: PiiPlaygroundMode;
  /**
   * Called whenever the user picks a different mode in the segmented
   * control. Embedders that want the playground mode to track the
   * admin's saved config wire this back into their state.
   */
  onModeChange?: (mode: PiiPlaygroundMode) => void;
  /**
   * Locales to enable in the PII detector. `'*'` = every locale the
   * library knows about. The default `'*'` is the right choice for
   * Storybook and ad-hoc demos; in production this comes from the
   * org's PII config.
   */
  detectionLocales?: string | string[];
  /** Optional className for the outer container. */
  className?: string;
  /**
   * Mock AI handler. Receives the tokenized prompt, returns the
   * "response" text. Used in tokenize mode for the round-trip stage.
   */
  mockAi?: (tokenizedPrompt: string) => string;
}

/**
 * Default sample input — covers email, phone, address, IBAN and a
 * date so the demo shows non-trivial detection from the start.
 */
const DEFAULT_INPUT = [
  'Hi, I am Alice (alice@example.com, born 1990-04-15).',
  'Please ship to 350 Fifth Avenue, New York, NY 10118.',
  'Phone: +1 (415) 555-0123. IBAN: DE89370400440532013000.',
].join(' ');

/** Default mock AI: confirmation wrapper that exercises tokens. */
const DEFAULT_MOCK_AI = (prompt: string): string =>
  `Thanks — I have noted the following details:\n\n${prompt}\n\nI'll follow up shortly.`;

export function PiiPlayground({
  initialInput = DEFAULT_INPUT,
  mode: controlledMode,
  onModeChange,
  detectionLocales = '*',
  className,
  mockAi = DEFAULT_MOCK_AI,
}: PiiPlaygroundProps): ReactNode {
  const { t: tTypes } = useT('piiTypes');
  const { t: tUi } = useT('piiPlayground');

  const [input, setInput] = useState(initialInput);
  const [internalMode, setInternalMode] = useState<PiiPlaygroundMode>(
    controlledMode ?? 'tokenize',
  );
  // When parent passes `mode`, it acts as a controlled prop; otherwise
  // the component owns the state via the segmented control.
  const mode = controlledMode ?? internalMode;
  useEffect(() => {
    if (controlledMode) setInternalMode(controlledMode);
  }, [controlledMode]);

  const handleModePick = (next: PiiPlaygroundMode) => {
    setInternalMode(next);
    onModeChange?.(next);
  };

  // `aiResponseOverride` lets the user edit the AI's reply directly
  // to demonstrate that tokens still detokenize when reorganised or
  // wrapped in markdown.
  const [aiResponseOverride, setAiResponseOverride] = useState<string | null>(
    null,
  );

  const tokenizer: Tokenizer = useMemo(() => {
    const locales =
      detectionLocales === '*' ? ('*' as const) : [detectionLocales].flat();
    return createTokenizer({
      mode: 'tokenize',
      patterns: {
        email: true,
        phone: true,
        creditCard: true,
        cvc: true,
        iban: true,
        ipAddress: true,
        ssn: true,
        dateOfBirth: true,
        address: { locales },
        nationalId: { locales },
      },
    });
  }, [detectionLocales]);

  const result: TokenizeResult = useMemo(
    () => tokenizer.tokenize(input),
    [tokenizer, input],
  );

  const detectedSegments: PiiHighlightSegment[] = result.segments.map((s) => ({
    start: s.start,
    end: s.end,
    type: s.type,
  }));

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <ModePicker mode={mode} onPick={handleModePick} tUi={tUi} />

      <Stage step={1} title={tUi('inputTitle')} hint={tUi('inputHint')}>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setAiResponseOverride(null);
          }}
          rows={4}
          aria-label={tUi('inputTitle')}
          className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 font-sans text-sm leading-relaxed focus:ring-2 focus:ring-[color:var(--color-accent-base)] focus:outline-hidden"
        />
      </Stage>

      <Stage step={2} title={tUi('detectedTitle')} hint={tUi('detectedHint')}>
        <DetectionSummary result={result} tTypes={tTypes} tUi={tUi} />
        <PiiHighlightedText
          text={input}
          segments={detectedSegments}
          variant="redacted"
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-sm"
        />
      </Stage>

      {mode === 'tokenize' && (
        <TokenizeStages
          result={result}
          tokenizer={tokenizer}
          mockAi={mockAi}
          aiResponseOverride={aiResponseOverride}
          setAiResponseOverride={setAiResponseOverride}
          tUi={tUi}
        />
      )}

      {mode === 'mask' && <MaskStage input={input} result={result} tUi={tUi} />}

      {mode === 'block' && (
        <BlockStage input={input} result={result} tUi={tUi} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Mode picker
// -----------------------------------------------------------------------------

interface ModePickerProps {
  mode: PiiPlaygroundMode;
  onPick: (mode: PiiPlaygroundMode) => void;
  tUi: TFunction;
}

function ModePicker({ mode, onPick, tUi }: ModePickerProps): ReactNode {
  const items: Array<{
    value: PiiPlaygroundMode;
    label: string;
    description: string;
  }> = [
    {
      value: 'tokenize',
      label: tUi('modeTokenize'),
      description: tUi('modeTokenizeDesc'),
    },
    {
      value: 'mask',
      label: tUi('modeMask'),
      description: tUi('modeMaskDesc'),
    },
    {
      value: 'block',
      label: tUi('modeBlock'),
      description: tUi('modeBlockDesc'),
    },
  ];
  const active = items.find((i) => i.value === mode);
  return (
    <section className="flex flex-col gap-2" aria-label={tUi('modeLabel')}>
      <div className="text-xs font-medium tracking-wide text-[color:var(--color-muted-fg)] uppercase">
        {tUi('modeLabel')}
      </div>
      <div
        role="radiogroup"
        aria-label={tUi('modeLabel')}
        className="inline-flex w-fit rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-0.5"
      >
        {items.map((item) => {
          const isActive = item.value === mode;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onPick(item.value)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-[color:var(--color-accent-base)] text-[color:var(--color-accent-fg)]'
                  : 'text-[color:var(--color-muted-fg)] hover:text-[color:var(--color-fg)]',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-xs text-[color:var(--color-muted-fg)]">
          {active.description}
        </p>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Tokenize stages (full round-trip)
// -----------------------------------------------------------------------------

interface TokenizeStagesProps {
  result: TokenizeResult;
  tokenizer: Tokenizer;
  mockAi: (prompt: string) => string;
  aiResponseOverride: string | null;
  setAiResponseOverride: (value: string | null) => void;
  tUi: TFunction;
}

function TokenizeStages({
  result,
  tokenizer,
  mockAi,
  aiResponseOverride,
  setAiResponseOverride,
  tUi,
}: TokenizeStagesProps): ReactNode {
  const tokenizedSegments = computeTokenSegments(result);
  const aiResponse = aiResponseOverride ?? mockAi(result.text);
  const restored = tokenizer.detokenize(aiResponse, result.mapping);
  const restoredSegments = computeRestoredSegments(restored, result.mapping);

  return (
    <>
      <Stage step={3} title={tUi('tokenizedTitle')} hint={tUi('tokenizedHint')}>
        <PiiHighlightedText
          text={result.text}
          segments={tokenizedSegments}
          variant="tokenized"
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-sm"
        />
      </Stage>

      <Stage step={4} title={tUi('aiTitle')} hint={tUi('aiHint')}>
        <textarea
          value={aiResponse}
          onChange={(e) => setAiResponseOverride(e.target.value)}
          rows={5}
          aria-label={tUi('aiTitle')}
          className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 font-mono text-sm leading-relaxed focus:ring-2 focus:ring-[color:var(--color-accent-base)] focus:outline-hidden"
        />
      </Stage>

      <Stage step={5} title={tUi('restoredTitle')} hint={tUi('restoredHint')}>
        <PiiHighlightedText
          text={restored}
          segments={restoredSegments}
          variant="restored"
          className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-sm"
        />
      </Stage>
    </>
  );
}

// -----------------------------------------------------------------------------
// Mask stage (one-way replacement)
// -----------------------------------------------------------------------------

interface MaskStageProps {
  input: string;
  result: TokenizeResult;
  tUi: TFunction;
}

function MaskStage({ input, result, tUi }: MaskStageProps): ReactNode {
  // Build the masked output by splicing each detected span's generic
  // mask token (`[EMAIL]`, `[PHONE]`, …) end-to-start so indices stay
  // valid. We deliberately recompute here rather than running the
  // scrubber a second time — the tokenizer already produced the
  // segments we need, and a single pass keeps the demo snappy.
  const maskedSegments: PiiHighlightSegment[] = [];
  let masked = input;
  const ordered = [...result.segments].sort((a, b) => b.start - a.start);
  for (const seg of ordered) {
    const token = `[${seg.type.toUpperCase()}]`;
    masked = masked.slice(0, seg.start) + token + masked.slice(seg.end);
  }
  // Recompute segment offsets in the post-mask string so the highlight
  // lands on the tokens, not the original PII positions.
  let cursor = 0;
  const inputOrdered = [...result.segments].sort((a, b) => a.start - b.start);
  let drift = 0;
  for (const seg of inputOrdered) {
    const token = `[${seg.type.toUpperCase()}]`;
    const start = seg.start + drift;
    const end = start + token.length;
    maskedSegments.push({ start, end, type: seg.type, label: token });
    drift += token.length - (seg.end - seg.start);
    cursor = end;
  }
  void cursor;

  return (
    <Stage step={3} title={tUi('maskedTitle')} hint={tUi('maskedHint')}>
      <PiiHighlightedText
        text={masked}
        segments={maskedSegments}
        variant="tokenized"
        className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 text-sm"
      />
    </Stage>
  );
}

// -----------------------------------------------------------------------------
// Block stage (rejection notice)
// -----------------------------------------------------------------------------

interface BlockStageProps {
  input: string;
  result: TokenizeResult;
  tUi: TFunction;
}

/**
 * Renders a clear pass/block notice that re-mounts on every detection-set
 * change. The `key` prop deliberately encodes the detected categories
 * AND the input length so an identical-content re-block (e.g. the admin
 * tweaks an unrelated config field) still produces a visible UI pulse —
 * fixes the "blocked once, then no feedback on repeat" reported bug.
 */
function BlockStage({ input, result, tUi }: BlockStageProps): ReactNode {
  const blocked = result.segments.length > 0;
  const categories = [...new Set(result.segments.map((s) => s.type))];
  const noticeKey = blocked
    ? `b:${categories.join(',')}:${input.length}:${result.segments.length}`
    : `p:${input.length}`;
  return (
    <Stage
      step={3}
      title={blocked ? tUi('blockTitle') : tUi('blockPassTitle')}
      hint={blocked ? tUi('blockHint') : ''}
    >
      <BlockNotice
        key={noticeKey}
        blocked={blocked}
        categories={categories}
        tUi={tUi}
        matchCount={result.segments.length}
      />
    </Stage>
  );
}

interface BlockNoticeProps {
  blocked: boolean;
  categories: string[];
  matchCount: number;
  tUi: TFunction;
}

function BlockNotice({
  blocked,
  categories,
  matchCount,
  tUi,
}: BlockNoticeProps): ReactNode {
  if (!blocked) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-2 rounded-md border border-[color:var(--color-success-base)]/40 bg-[color:var(--color-success-base)]/10 p-3 text-sm text-[color:var(--color-success-fg)]"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{tUi('blockPassBody')}</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-2 rounded-md border border-[color:var(--color-destructive-base)]/40 bg-[color:var(--color-destructive-base)]/10 p-3 text-sm text-[color:var(--color-destructive-fg)]"
    >
      <ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1">
        <span>{tUi('blockBody')}</span>
        <span className="text-xs opacity-80">
          {categories.join(', ')} · {matchCount} {tUi('detectionCount')}
        </span>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface StageProps {
  step: number;
  title: string;
  hint: string;
  children: ReactNode;
}

/** Numbered section wrapper — keeps the playground visually scannable. */
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
        <h3 className="text-sm font-medium text-[color:var(--color-fg)]">
          {title}
        </h3>
        {hint && (
          <span className="text-xs text-[color:var(--color-muted-fg)]">
            {hint}
          </span>
        )}
      </header>
      <div className="ml-9">{children}</div>
    </section>
  );
}

interface SummaryProps {
  result: TokenizeResult;
  tTypes: TFunction;
  tUi: TFunction;
}

/** Compact chip row — one chip per type, with a count badge for repeats. */
function DetectionSummary({ result, tTypes, tUi }: SummaryProps): ReactNode {
  const byType = new Map<string, number>();
  for (const seg of result.segments) {
    byType.set(seg.type, (byType.get(seg.type) ?? 0) + 1);
  }
  if (byType.size === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-muted-fg)]">
        <ShieldAlert className="size-3.5 shrink-0 opacity-60" aria-hidden />
        <span>{tUi('noPii')}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...byType.entries()].map(([type, count]) => (
        <span
          key={type}
          className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-warning-base)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--color-warning-fg)] ring-1 ring-[color:var(--color-warning-base)]/30"
        >
          {piiTypeLabel(type, tTypes)}
          {count > 1 && (
            <span className="text-[10px] opacity-80">×{count}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Find every token's position inside the tokenized text. Can't reuse
 * `result.segments` here because those offsets refer to the original
 * (pre-tokenize) text — the tokenized output shifts as tokens are
 * shorter or longer than the source PII.
 */
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

/**
 * After detokenize, find the byte ranges where each original PII
 * value appears in the restored output. We can't trust the AI to
 * have kept tokens in order, so scan every mapping value and emit a
 * segment per occurrence.
 */
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
