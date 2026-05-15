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
 *   4. Live preview — lazy-loaded. The preview pulls in `createTokenizer`,
 *      the 43-locale registry, and libphonenumber-js — none of which the
 *      mode / patterns / custom-patterns sections need to render. Code-
 *      splitting it keeps the panel's initial render fast; the preview
 *      hydrates asynchronously underneath a small skeleton.
 *
 * Fully controlled: every edit fires `onChange(next)` with the complete
 * panel state so embedders can debounce, persist, or short-circuit
 * however they want.
 *
 * Translations come from the `piiConfigPanel` and `piiTypes` namespaces
 * — mounting the shared `<I18nProvider>` is the only consumer wiring.
 */

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import { Field } from '@tale/ui/field';
import { Input } from '@tale/ui/input';
import type { TFunction } from 'i18next';
import { Plus, Trash2 } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { BUILT_IN_PATTERN_NAMES } from '@/lib/pii/patterns/names';
import type { PiiCustomPattern } from '@/lib/pii/schemas/config';
import { cn } from '@/lib/utils/cn';

import { piiTypeIcon } from './pii-type-icons';
import { piiTypeLabel } from './pii-type-labels';

// Re-import the type alias so we can keep the existing type name; it's
// the same `BuiltInPatternName` literal union but routed through the
// bundle-light entry point.
type BuiltInPatternName = (typeof BUILT_IN_PATTERN_NAMES)[number];

// `@/lib/pii`'s `createTokenizer` (and its locale registry +
// libphonenumber-js) is the heaviest single chunk in this panel. The
// rest of the form (mode, patterns, custom-patterns) doesn't need any
// of it, so lazy-split the preview pane into its own chunk that loads
// after first paint.
const PiiConfigPreview = lazy(() => import('./pii-config-preview'));

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
  const { t: tPiiConfigPanel } = useT('piiConfigPanel');

  return (
    <div className={cn('flex flex-col gap-8', className)}>
      <ModeSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
      />
      <PatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
        tTypes={tTypes}
      />
      <CustomPatternsSection
        value={value}
        onChange={onChange}
        disabled={disabled}
        tPiiConfigPanel={tPiiConfigPanel}
      />
      <Section
        title={tPiiConfigPanel('previewTitle')}
        description={tPiiConfigPanel('previewDescription')}
      >
        <Suspense fallback={<PreviewSkeleton />}>
          <PiiConfigPreview
            config={value}
            detectionLocales={detectionLocales}
            initialInput={initialPreviewInput}
            mockAi={mockAi}
          />
        </Suspense>
      </Section>
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

function PreviewSkeleton(): ReactNode {
  // Cheap placeholder that occupies roughly the same vertical space as
  // the loaded preview, so the page doesn't jump when the chunk hydrates.
  return (
    <div
      aria-busy="true"
      className="h-64 animate-pulse rounded-lg border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)]/40"
    />
  );
}

// -----------------------------------------------------------------------------
// Mode section
// -----------------------------------------------------------------------------

interface ModeSectionProps {
  value: PiiConfigPanelValue;
  onChange: (next: PiiConfigPanelValue) => void;
  disabled: boolean;
  tPiiConfigPanel: TFunction;
}

function ModeSection({
  value,
  onChange,
  disabled,
  tPiiConfigPanel,
}: ModeSectionProps): ReactNode {
  const items: Array<{
    value: PiiConfigPanelMode;
    label: string;
    description: string;
  }> = [
    {
      value: 'tokenize',
      label: tPiiConfigPanel('modeTokenize'),
      description: tPiiConfigPanel('modeTokenizeDesc'),
    },
    {
      value: 'mask',
      label: tPiiConfigPanel('modeMask'),
      description: tPiiConfigPanel('modeMaskDesc'),
    },
    {
      value: 'block',
      label: tPiiConfigPanel('modeBlock'),
      description: tPiiConfigPanel('modeBlockDesc'),
    },
  ];
  const active = items.find((i) => i.value === value.mode);
  return (
    <Section title={tPiiConfigPanel('modeLabel')}>
      <div
        role="radiogroup"
        aria-label={tPiiConfigPanel('modeLabel')}
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
  tPiiConfigPanel: TFunction;
  tTypes: TFunction;
}

function PatternsSection({
  value,
  onChange,
  disabled,
  tPiiConfigPanel,
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
      title={tPiiConfigPanel('patternsTitle')}
      description={tPiiConfigPanel('patternsDescription')}
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
  tPiiConfigPanel: TFunction;
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
  tPiiConfigPanel,
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
    } catch (err) {
      // `console.debug` (not `warn`) so an admin typing an in-progress
      // regex doesn't spam the console on every keystroke. The
      // user-visible signal is the field error below; this line is for
      // dev-mode introspection only.
      console.debug(
        `[pii] custom pattern regex invalid: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      return tPiiConfigPanel('customPatternInvalidRegex');
    }
  }, [draft, tPiiConfigPanel]);

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
      title={tPiiConfigPanel('customPatternsTitle')}
      description={tPiiConfigPanel('customPatternsDescription')}
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
              aria-label={`${tPiiConfigPanel('removeCustomPattern')} — ${p.name}`}
            />
          </div>
        ))}

        {draft && (
          <div className="flex flex-col gap-3 rounded-md border border-[color:var(--color-border-base)] bg-[color:var(--color-bg-elevated)] p-3">
            <Field label={tPiiConfigPanel('customPatternNameLabel')}>
              <Input
                value={draft.name}
                disabled={disabled}
                onChange={(e) => updateDraft({ name: e.target.value })}
                placeholder={tPiiConfigPanel('customPatternNamePlaceholder')}
              />
            </Field>
            <Field
              label={tPiiConfigPanel('customPatternRegexLabel')}
              error={regexError ?? undefined}
            >
              <Input
                value={draft.regex}
                disabled={disabled}
                onChange={(e) => updateDraft({ regex: e.target.value })}
                placeholder={tPiiConfigPanel('customPatternRegexPlaceholder')}
                className="font-mono"
              />
            </Field>
            <Field label={tPiiConfigPanel('customPatternReplacementLabel')}>
              <Input
                value={draft.replacement}
                disabled={disabled}
                onChange={(e) => updateDraft({ replacement: e.target.value })}
                placeholder={tPiiConfigPanel(
                  'customPatternReplacementPlaceholder',
                )}
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
                {tPiiConfigPanel('saveCustomPattern')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setDraft(null)}
              >
                {tPiiConfigPanel('cancelCustomPattern')}
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
            {tPiiConfigPanel('addCustomPattern')}
          </Button>
        )}
      </div>
    </Section>
  );
}
