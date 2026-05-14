/**
 * `PiiConfigPanel` — admin-facing PII configuration UI with a live
 * preview. The single canonical surface for editing a PII policy and
 * rehearsing its effect, shared between Storybook and the platform's
 * governance settings page.
 *
 * Sections, top to bottom:
 *
 *   1. Mode — segmented radio (`tokenize` / `mask` / `block`) with a
 *      one-line description of what each mode does.
 *   2. Patterns — checkbox row per built-in detector (`email`, `phone`,
 *      …). Translated labels come from the `piiTypes` namespace shipped
 *      by this package.
 *   3. Custom patterns — admin-supplied regexes (name + pattern +
 *      replacement). Compiles the regex locally with `try/catch` so the
 *      Save button can refuse a syntactically broken pattern before it
 *      ever reaches the server. Backend re-validates with `safe-regex2`.
 *   4. Live preview — the previous playground, simplified. Tokenizes
 *      using the **active** configuration so toggling a pattern off
 *      removes its detections from the highlight overlay live.
 *
 * Fully controlled: every edit fires `onChange(next)` with the complete
 * panel state so embedders can debounce, persist, or short-circuit
 * however they want.
 *
 * Translations come from the `piiConfigPanel` and `piiTypes` namespaces
 * — mounting the shared `<I18nProvider>` is the only consumer wiring.
 */

import {
  type BuiltInPatternName,
  BUILT_IN_PATTERN_NAMES,
  type PiiCustomPattern,
  createTokenizer,
  type TokenEntry,
  type TokenizeResult,
  type Tokenizer,
} from '@tale/pii';
import type { TFunction } from 'i18next';
import { Plus, ShieldAlert, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useT } from '../../i18n/client';
import { cn } from '../../lib/cn';
import { Checkbox } from '../forms/checkbox';
import { Field } from '../forms/field';
import { Input } from '../forms/input';
import { Button } from '../primitives/button';
import {
  PiiHighlightedText,
  type PiiHighlightSegment,
} from './pii-highlighted-text';
import { piiTypeIcon } from './pii-type-icons';
import { piiTypeLabel } from './pii-type-labels';

export type PiiConfigPanelMode = 'tokenize' | 'mask' | 'block';

export interface PiiConfigPanelValue {
  /** What the policy does when PII is detected. */
  mode: PiiConfigPanelMode;
  /** Built-in pattern names to enable. Subset of `BUILT_IN_PATTERN_NAMES`. */
  enabledPatterns: string[];
  /** Admin-supplied custom regex rules. */
  customPatterns: PiiCustomPattern[];
}

export interface PiiConfigPanelProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  /**
   * Read-only mode for admins without `write orgSettings`. Disables every
   * configuration control; the preview textarea stays interactive so the
   * admin can still inspect the active config.
   */
  disabled?: boolean;
  /**
   * Locales to enable in the live preview's detector. `'*'` (default)
   * loads every locale the library knows about — the right choice for
   * Storybook and ad-hoc demos. The platform passes `'*'` today because
   * the saved config doesn't expose a locale picker yet.
   */
  detectionLocales?: string | string[];
  /** Initial text in the preview area. */
  initialPreviewInput?: string;
  /** Mock AI handler for the tokenize round-trip stage. */
  mockAi?: (tokenizedPrompt: string) => string;
  className?: string;
}

const DEFAULT_PREVIEW_INPUT = [
  'Hi, I am Alice (alice@example.com, born 1990-04-15).',
  'Please ship to 350 Fifth Avenue, New York, NY 10118.',
  'Phone: +1 (415) 555-0123. IBAN: DE89370400440532013000.',
].join(' ');

const DEFAULT_MOCK_AI = (prompt: string): string =>
  `Thanks — I have noted the following details:\n\n${prompt}\n\nI'll follow up shortly.`;

export function PiiConfigPanel({
  value,
  onChange,
  disabled = false,
  detectionLocales = '*',
  initialPreviewInput = DEFAULT_PREVIEW_INPUT,
  mockAi = DEFAULT_MOCK_AI,
  className,
}: PiiConfigPanelProps): ReactNode {
  const { t: tTypes } = useT('piiTypes');
  const { t: tUi } = useT('piiConfigPanel');

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <ModeSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tUi={tUi}
      />
      <PatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tUi={tUi}
        tTypes={tTypes}
      />
      <CustomPatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tUi={tUi}
      />
      <PreviewSection
        config={value}
        detectionLocales={detectionLocales}
        initialInput={initialPreviewInput}
        mockAi={mockAi}
        tUi={tUi}
        tTypes={tTypes}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Section wrapper
// -----------------------------------------------------------------------------

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

function Section({ title, description, children }: SectionProps): ReactNode {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[color:var(--color-fg-base)]">
          {title}
        </h3>
        {description && (
          <p className="text-xs text-[color:var(--color-fg-muted)]">
            {description}
          </p>
        )}
      </header>
      {children}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Mode section
// -----------------------------------------------------------------------------

interface ModeSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tUi: TFunction;
}

function ModeSection({
  value,
  onChange,
  disabled,
  tUi,
}: ModeSectionProps): ReactNode {
  const items: Array<{
    value: PiiConfigPanelMode;
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
  const active = items.find((i) => i.value === value.mode);
  return (
    <Section title={tUi('modeLabel')}>
      <div
        role="radiogroup"
        aria-label={tUi('modeLabel')}
        className="inline-flex w-fit rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] p-0.5"
      >
        {items.map((item) => {
          const isActive = item.value === value.mode;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => onChange({ ...value, mode: item.value })}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                isActive
                  ? 'bg-[color:var(--color-accent-base)] text-[color:var(--color-accent-fg)] shadow-sm'
                  : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg-base)]',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-xs text-[color:var(--color-fg-muted)]">
          {active.description}
        </p>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Built-in patterns section
// -----------------------------------------------------------------------------

interface PatternsSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tUi: TFunction;
  tTypes: TFunction;
}

function PatternsSection({
  value,
  onChange,
  disabled,
  tUi,
  tTypes,
}: PatternsSectionProps): ReactNode {
  const enabled = new Set(value.enabledPatterns);

  const togglePattern = (name: BuiltInPatternName, on: boolean) => {
    const next = new Set(enabled);
    if (on) next.add(name);
    else next.delete(name);
    onChange({ ...value, enabledPatterns: [...next] });
  };

  return (
    <Section
      title={tUi('patternsTitle')}
      description={tUi('patternsDescription')}
    >
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {BUILT_IN_PATTERN_NAMES.map((name) => {
          const Icon = piiTypeIcon(name);
          const id = `pii-pattern-${name}`;
          return (
            <li key={name}>
              <label
                htmlFor={id}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] px-3 py-2 text-sm transition-colors',
                  disabled
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer hover:border-[color:var(--color-accent-base)]/40',
                )}
              >
                <Checkbox
                  id={id}
                  checked={enabled.has(name)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    togglePattern(name, checked === true)
                  }
                />
                <Icon
                  className="size-4 shrink-0 text-[color:var(--color-fg-muted)]"
                  aria-hidden
                />
                <span className="text-[color:var(--color-fg-base)]">
                  {piiTypeLabel(name, tTypes)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Custom patterns section
// -----------------------------------------------------------------------------

interface CustomPatternsSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tUi: TFunction;
}

interface CustomPatternDraft {
  name: string;
  regex: string;
  replacement: string;
}

function CustomPatternsSection({
  value,
  onChange,
  disabled,
  tUi,
}: CustomPatternsSectionProps): ReactNode {
  const [draft, setDraft] = useState<CustomPatternDraft | null>(null);

  const updateDraft = (patch: Partial<CustomPatternDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const regexError = useMemo(() => {
    if (!draft || !draft.regex) return null;
    try {
      // Pure validation. Result is unused — `new RegExp` throws on a
      // structural failure which is the only thing we need to catch
      // here. ReDoS detection happens server-side at save time.
      void new RegExp(draft.regex);
      return null;
    } catch {
      return tUi('customPatternInvalidRegex');
    }
  }, [draft, tUi]);

  const canSave =
    draft !== null &&
    draft.name.trim() !== '' &&
    draft.regex.trim() !== '' &&
    draft.replacement.trim() !== '' &&
    regexError === null;

  const saveDraft = () => {
    if (!draft || !canSave) return;
    const next = [
      ...value.customPatterns,
      {
        name: draft.name.trim(),
        regex: draft.regex,
        replacement: draft.replacement.trim(),
      },
    ];
    onChange({ ...value, customPatterns: next });
    setDraft(null);
  };

  const removePattern = (index: number) => {
    const next = value.customPatterns.filter((_, i) => i !== index);
    onChange({ ...value, customPatterns: next });
  };

  return (
    <Section
      title={tUi('customPatternsTitle')}
      description={tUi('customPatternsDescription')}
    >
      <div className="flex flex-col gap-2">
        {value.customPatterns.map((p, index) => (
          <div
            key={`${p.name}-${index}`}
            className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] px-3 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-[color:var(--color-fg-base)]">
                {p.name}
              </span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[color:var(--color-fg-muted)]">
                <span className="font-mono">{p.regex}</span>
                <span aria-hidden>→</span>
                <span className="font-mono">{p.replacement}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              icon={Trash2}
              disabled={disabled}
              onClick={() => removePattern(index)}
              aria-label={`${tUi('removeCustomPattern')} — ${p.name}`}
            />
          </div>
        ))}

        {draft && (
          <div className="flex flex-col gap-3 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] p-3">
            <Field label={tUi('customPatternNameLabel')}>
              <Input
                value={draft.name}
                disabled={disabled}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder={tUi('customPatternNamePlaceholder')}
              />
            </Field>
            <Field
              label={tUi('customPatternRegexLabel')}
              error={regexError ?? undefined}
            >
              <Input
                value={draft.regex}
                disabled={disabled}
                onChange={(e) => updateDraft({ regex: e.target.value })}
                placeholder={tUi('customPatternRegexPlaceholder')}
                className="font-mono"
              />
            </Field>
            <Field label={tUi('customPatternReplacementLabel')}>
              <Input
                value={draft.replacement}
                disabled={disabled}
                onChange={(e) => updateDraft({ replacement: e.target.value })}
                placeholder={tUi('customPatternReplacementPlaceholder')}
                className="font-mono"
              />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled || !canSave}
                onClick={saveDraft}
              >
                {tUi('saveCustomPattern')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setDraft(null)}
              >
                {tUi('cancelCustomPattern')}
              </Button>
            </div>
          </div>
        )}

        {!draft && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Plus}
            disabled={disabled}
            onClick={() => setDraft({ name: '', regex: '', replacement: '' })}
            className="w-fit"
          >
            {tUi('addCustomPattern')}
          </Button>
        )}
      </div>
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Preview section (live demo)
// -----------------------------------------------------------------------------

interface PreviewSectionProps {
  config: PiiConfigPanelValue;
  detectionLocales: string | string[];
  initialInput: string;
  mockAi: (prompt: string) => string;
  tUi: TFunction;
  tTypes: TFunction;
}

function PreviewSection({
  config,
  detectionLocales,
  initialInput,
  mockAi,
  tUi,
  tTypes,
}: PreviewSectionProps): ReactNode {
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
    <Section
      title={tUi('previewTitle')}
      description={tUi('previewDescription')}
    >
      <div className="flex flex-col gap-6 rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)]/40 p-4">
        <Stage step={1} title={tUi('inputTitle')} hint={tUi('inputHint')}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={4}
            aria-label={tUi('inputTitle')}
            className="w-full rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 font-sans text-sm leading-relaxed text-[color:var(--color-fg-base)] focus:ring-2 focus:ring-[color:var(--color-accent-base)]/30 focus:outline-none"
          />
        </Stage>

        <Stage step={2} title={tUi('detectedTitle')} hint={tUi('detectedHint')}>
          {!anyPatternsEnabled ? (
            <NoPatternsNotice tUi={tUi} />
          ) : (
            <>
              <DetectionSummary result={result} tTypes={tTypes} tUi={tUi} />
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
            tUi={tUi}
          />
        )}

        {config.mode === 'mask' && anyPatternsEnabled && (
          <MaskStage input={input} result={result} tUi={tUi} />
        )}

        {config.mode === 'block' && anyPatternsEnabled && (
          <BlockStage input={input} result={result} tUi={tUi} />
        )}
      </div>
    </Section>
  );
}

function NoPatternsNotice({ tUi }: { tUi: TFunction }): ReactNode {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-xs text-[color:var(--color-fg-muted)]"
    >
      <ShieldAlert className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
      <span>{tUi('noPatternsEnabled')}</span>
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
          className="rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 text-sm"
        />
      </Stage>

      <Stage step={4} title={tUi('aiTitle')} hint={tUi('aiHint')}>
        <textarea
          value={aiResponse}
          onChange={(e) => setAiResponseOverride(e.target.value)}
          rows={5}
          aria-label={tUi('aiTitle')}
          className="w-full rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-base)] p-3 font-mono text-sm leading-relaxed text-[color:var(--color-fg-base)] focus:ring-2 focus:ring-[color:var(--color-accent-base)]/30 focus:outline-none"
        />
      </Stage>

      <Stage step={5} title={tUi('restoredTitle')} hint={tUi('restoredHint')}>
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
  tUi: TFunction;
}

function MaskStage({ input, result, tUi }: MaskStageProps): ReactNode {
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
    <Stage step={3} title={tUi('maskedTitle')} hint={tUi('maskedHint')}>
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
  tUi: TFunction;
}

function BlockStage({ input, result, tUi }: BlockStageProps): ReactNode {
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
      className="flex items-start gap-2 rounded-md border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 p-3 text-sm text-[color:var(--color-danger)]"
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

interface SummaryProps {
  result: TokenizeResult;
  tTypes: TFunction;
  tUi: TFunction;
}

function DetectionSummary({ result, tTypes, tUi }: SummaryProps): ReactNode {
  const byType = new Map<string, number>();
  for (const seg of result.segments) {
    byType.set(seg.type, (byType.get(seg.type) ?? 0) + 1);
  }
  if (byType.size === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-[color:var(--color-fg-muted)]">
        <ShieldAlert className="size-3.5 shrink-0 opacity-60" aria-hidden />
        <span>{tUi('noPii')}</span>
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
