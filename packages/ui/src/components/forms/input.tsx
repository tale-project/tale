'use client';

import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { useT } from '@tale/ui/i18n/client';
import { SkeletonBox } from '@tale/ui/skeleton';
import { cva, type VariantProps } from 'class-variance-authority';
import { XCircle } from 'lucide-react';
import type {
  HTMLInputTypeAttribute,
  InputHTMLAttributes,
  ReactNode,
} from 'react';
import { forwardRef, useState, useId, useEffect, useRef } from 'react';

import {
  DisabledReasonTooltip,
  hasDisabledReason,
} from '../overlays/disabled-reason';
import {
  FIELD_FOCUS,
  FIELD_FOCUS_WITHIN,
  FIELD_INVALID,
  FIELD_INVALID_WITHIN,
} from './field-focus';
import { FieldShell } from './field-shell';
import {
  CopyValueButton,
  FIELD_ACTIONS_END,
  fieldActionsRoom,
  RevealToggle,
  type RevealLabels,
} from './field-value-actions';
import { Label } from './label';

const inputVariants = cva(
  // One height fits all (`h-9`). Disabled is a filled muted field
  // (design-system Input/Text `xZ0I9`), not an opacity wash.
  'placeholder:text-muted-foreground flex h-9 w-full text-base transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[color:var(--color-bg-elevated)] disabled:text-[color:var(--color-fg-subtle)] aria-disabled:cursor-not-allowed aria-disabled:bg-[color:var(--color-bg-elevated)] aria-disabled:text-[color:var(--color-fg-subtle)] md:text-sm',
  {
    variants: {
      variant: {
        default: `bg-input rounded-lg border border-[color:var(--color-border-input)] px-3 py-2 ${FIELD_FOCUS}`,
        unstyled: 'border-0 bg-transparent ring-0 ring-offset-0',
        // Borderless, text-like display for values the user cannot edit in
        // context. Keeps the field's footprint (`h-9` from the base + the same
        // `border`/`px`/`py` box as `default`) so toggling editable ↔ read-only
        // causes no layout shift; just drops the visible ring + filled bg.
        readOnly:
          'rounded-lg border border-transparent bg-transparent px-3 py-2 ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'prefix'
> &
  VariantProps<typeof inputVariants> & {
    /**
     * The input type. `password` WITHOUT an explicit `autoComplete` is treated
     * as `sensitive`: a text input masked with CSS, which dodges the browser's
     * saved-password dropdown but leaves the value readable to assistive
     * technology. `password` WITH an explicit `autoComplete` is a real
     * password input (what an account form wants, and the way to keep a
     * single-line secret out of the accessibility tree); its reveal toggle
     * switches the type.
     */
    type?: HTMLInputTypeAttribute;
    /**
     * Whether a masked field (a password, or a `sensitive` one) shows the reveal
     * toggle. `false` leaves the value masked for good: a value that was shown
     * is masked again when the toggle goes.
     */
    passwordToggle?: boolean;
    /**
     * The words of the reveal toggle, when "Show password" does not say what
     * is revealed (a card number, a token). The label names what the button
     * does now, so the two swap as it is pressed. Defaults to the shared
     * "Show password" / "Hide password".
     */
    revealLabels?: RevealLabels;
    /**
     * A copy button INSIDE the field, on its right edge beside the reveal
     * toggle (copy first, then the eye). It copies what the field holds at
     * that moment, a masked value included, without showing it; nothing is
     * copied from an empty field.
     *
     * Beside a fixed `prefix` / `suffix` a lone copy button gives way and the
     * addon keeps its frame. On a masked field the reveal toggle's frame takes
     * the addon's place (an addon is never drawn beside the toggle), so there
     * `copyable` works and the addon is not drawn.
     *
     * Turning `copyable` (or the masking) on or off after the field mounted
     * changes the frame the input is drawn in, which remounts it: an
     * uncontrolled field loses what was typed and its focus. Give the field a
     * `key` that changes with it, or keep it constant.
     */
    copyable?: boolean;
    /** The copy button's name (default "Copy"): in a form of several values, "Copy Password" says which. */
    copyLabel?: string;
    /** What a screen reader hears once the value is copied (default "Copied"). */
    copiedLabel?: string;
    /**
     * Explains *why* the field is disabled, surfaced in a tooltip on hover AND
     * focus and to screen readers. Only takes effect while the field is
     * `disabled`; ignored otherwise, so callers can pass it unconditionally.
     *
     * A natively-`disabled` field emits no pointer events and leaves the tab
     * order, so no tooltip could reach it. When a disabled field carries a
     * `disabledReason` the field therefore stays focusable and `readOnly`
     * (still rendered visually disabled and inert to edits), swaps `disabled`
     * for `aria-disabled`, and lets the shared Tooltip wire `aria-describedby`.
     */
    disabledReason?: ReactNode;
    /**
     * Mark the field as holding a secret (API key, token, credential). Suppresses
     * the browser's "save password" prompt and password-manager autofill overlays
     * so the value is never cached in the credential store. `type="password"`
     * fields are treated as sensitive automatically.
     *
     * Masking is visual only. A sensitive field is a text input drawn as dots,
     * so assistive technology reads its value as it reads any text field's.
     * For a single-line secret that must stay out of the accessibility tree,
     * pass `type="password"` with an explicit `autoComplete` (a real password
     * input, see `type`) and the password-manager opt-out hints yourself:
     * `data-1p-ignore`, `data-lpignore="true"`, `data-form-type="other"`,
     * `data-bwignore="true"`.
     */
    sensitive?: boolean;
    errorMessage?: string;
    isInvalid?: boolean;
    label?: string;
    description?: ReactNode;
    /** A note rendered below the input (above the error) — for rules that make sense after seeing the field. */
    hint?: ReactNode;
    /**
     * A fixed, non-editable addon rendered INSIDE the field's border, right after
     * the value (e.g. a locked email domain `@acme.com`). The value input is
     * transparent and content-sized so the two read as one string, and the border
     * + focus ring live on the wrapper. Not combined with `passwordToggle`.
     */
    suffix?: ReactNode;
    /**
     * The mirror of `suffix`: a fixed, non-editable addon rendered INSIDE the
     * field's border, right before the value (e.g. a reserved env-var
     * namespace `TALE_PROVIDER_KEY_`). Same wrapper chrome as `suffix`; not
     * combined with `passwordToggle`.
     */
    prefix?: ReactNode;
    /** Optional hover/focus tooltip on the label (the deeper "why/format"). */
    labelInfo?: ReactNode;
    required?: boolean;
    wrapperClassName?: string;
    /**
     * Let the control fill the frame instead of the settings 20rem control
     * column (see `FieldShell`) — for a field whose width its caller owns, like
     * a toolbar search box. Forwarded straight to the shell.
     */
    wideControl?: boolean;
  };

// Mask the input surface without moving its label, description or toggle.
const InputBase = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      passwordToggle = true,
      revealLabels,
      copyable = false,
      copyLabel,
      copiedLabel,
      sensitive,
      autoComplete,
      disabled,
      disabledReason,
      readOnly,
      variant,
      errorMessage,
      isInvalid,
      label,
      description,
      hint,
      suffix,
      prefix,
      labelInfo,
      required,
      wrapperClassName,
      wideControl = false,
      id: providedId,
      style,
      'aria-describedby': callerDescribedBy,
      ...props
    },
    ref,
  ) => {
    const { t } = useT('common');
    const generatedId = useId();
    const id = providedId ?? generatedId;
    const errorId = `${id}-error`;
    const descriptionId = `${id}-description`;
    const hintId = `${id}-hint`;
    const isPassword = type === 'password';
    // A native `readOnly` input auto-selects the borderless display variant
    // (transparent, no ring) unless the caller pins an explicit `variant`, so
    // informational values render as text with no layout shift vs. editing.
    const resolvedVariant = variant ?? (readOnly ? 'readOnly' : undefined);
    // Soft-disable keeps the field focusable + hoverable (so the reason tooltip
    // reaches pointer and keyboard users) while `readOnly` blocks edits.
    const softDisabled = Boolean(disabled) && hasDisabledReason(disabledReason);
    const disabledAttrs = {
      disabled: softDisabled ? undefined : disabled,
      // Only the soft-disabled branch needs `aria-disabled`; a natively
      // `disabled` field already conveys the state.
      'aria-disabled': softDisabled || undefined,
      readOnly: softDisabled ? true : readOnly,
    };
    const [show, setShow] = useState(false);
    const [showShake, setShowShake] = useState(false);
    // The frame the field and its buttons are drawn in, for what Copy has to
    // read: the value of an uncontrolled field is not the caller's state, and
    // the caller's `ref` (a form library registers its field there) stays the
    // caller's, handed to the input untouched.
    const frameRef = useRef<HTMLDivElement>(null);

    // A field is "sensitive" when it holds a secret that is NOT an account
    // password — API keys, tokens, connector credentials. The caller opts in
    // via `sensitive`, OR it's a `type="password"` field that did NOT declare
    // an explicit `autoComplete`. The explicit-autoComplete carve-out keeps
    // genuine account forms working: login / 2FA / reset pass
    // `autoComplete="current-password"` / `"new-password"` because they *want*
    // the password manager to fill and save. Every credential-config field
    // passes no autoComplete, so it's protected automatically.
    const isSensitive = sensitive || (isPassword && autoComplete == null);
    // Whether to render the eye reveal button: any masked field that opts into
    // the toggle (sensitive secrets or genuine passwords).
    const showToggle = (isSensitive || isPassword) && passwordToggle;
    // A reveal belongs to the masking that gave it. When the field stops being
    // masked (its type or `sensitive` changed) or loses its toggle, the reveal
    // is forgotten, so masking that comes back starts hidden instead of showing
    // a value the person last saw masked.
    if (show && !showToggle) setShow(false);
    const revealed = show && showToggle;

    // The crux of the fix: Chrome treats ANY `type="password"` as an account
    // password and shows its saved-password dropdown / "Suggest strong
    // password" on focus — and largely ignores `autocomplete` hints telling it
    // otherwise. So a sensitive field is rendered as `type="text"` and masked
    // purely with CSS (`-webkit-text-security`). To the browser it's plain
    // text → no password dropdown, no save prompt, no strong-password
    // suggestion — but it still shows as dots and the eye toggle still reveals
    // it. Genuine `type="password"` fields keep real type-switching so the
    // password manager continues to work as expected.
    const inputType = isSensitive
      ? 'text'
      : isPassword
        ? revealed
          ? 'text'
          : 'password'
        : type;
    // For sensitive fields, mask via CSS unless revealed. For real password
    // fields, clear the browser's autofill `-webkit-text-security` overlay when
    // the value is revealed (it persists even after `type` flips to "text").
    const securityStyle: { WebkitTextSecurity?: 'disc' | 'none' } | undefined =
      isSensitive
        ? { WebkitTextSecurity: revealed ? 'none' : 'disc' }
        : isPassword && revealed
          ? { WebkitTextSecurity: 'none' }
          : undefined;
    // The buttons the field carries inside its border. A fixed prefix or
    // suffix has its own frame (below), which a button does not share: the
    // toggle keeps the field it always had, a lone copy button gives way.
    const showCopy = copyable && (showToggle || !(suffix || prefix));
    const actionCount = (showToggle ? 1 : 0) + (showCopy ? 1 : 0);

    const resolvedAutoComplete =
      autoComplete ?? (isSensitive ? 'off' : undefined);
    // Belt-and-suspenders for password managers, which key off field
    // name/label rather than just `type`: explicitly opt out of 1Password /
    // LastPass / Bitwarden / Dashlane. (The `type="text"` switch above is what
    // actually stops the browser's own password dropdown.)
    const sensitiveAttrs = isSensitive
      ? {
          autoComplete: resolvedAutoComplete,
          // A text input drawn as dots is still a text input to the browser:
          // it would spell-check the secret (enhanced spell checking sends the
          // text to a server), capitalise it and correct it. A real password
          // field gets none of that, so this stand-in asks for none of it.
          spellCheck: false,
          autoCapitalize: 'off',
          autoCorrect: 'off',
          'data-1p-ignore': true,
          'data-lpignore': 'true',
          'data-form-type': 'other',
          'data-bwignore': 'true',
        }
      : { autoComplete: resolvedAutoComplete };
    const hasError = !!errorMessage;
    const showInvalid = hasError || !!isInvalid;
    // Merge caller-supplied `aria-describedby` with the internal ids so a
    // parent passing e.g. a counter id doesn't clobber the internal error /
    // description associations the Input owns.
    const describedBy =
      [
        description && descriptionId,
        hint && hintId,
        hasError && errorId,
        callerDescribedBy,
      ]
        .filter(Boolean)
        .join(' ') || undefined;

    // Trigger shake animation when error appears
    useEffect(() => {
      if (showInvalid) {
        setShowShake(true);
        const timer = setTimeout(() => setShowShake(false), 400);
        return () => clearTimeout(timer);
      }
      return undefined;
    }, [showInvalid, errorMessage]);

    if (actionCount > 0) {
      return (
        <FieldShell
          {...(label !== undefined
            ? {
                label: (
                  <Label
                    htmlFor={id}
                    required={required}
                    error={hasError}
                    info={labelInfo}
                  >
                    {label}
                  </Label>
                ),
              }
            : {})}
          {...(description !== undefined
            ? {
                description: (
                  <Description id={descriptionId}>{description}</Description>
                ),
              }
            : {})}
          {...(hint !== undefined
            ? {
                hint: <Description id={hintId}>{hint}</Description>,
              }
            : {})}
          {...(errorMessage !== undefined
            ? {
                error: (
                  <p
                    id={errorId}
                    role="alert"
                    aria-live="polite"
                    className="text-destructive flex items-center gap-1.5 text-sm"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    {errorMessage}
                  </p>
                ),
              }
            : {})}
          {...(wrapperClassName !== undefined
            ? { className: wrapperClassName }
            : {})}
          wideControl={wideControl}
        >
          <SkeletonBox asChild>
            <div ref={frameRef} className="relative rounded-lg">
              <DisabledReasonTooltip
                reason={disabledReason}
                active={softDisabled}
              >
                <input
                  id={id}
                  type={inputType}
                  {...sensitiveAttrs}
                  {...disabledAttrs}
                  className={cn(
                    inputVariants({ variant: resolvedVariant }),
                    showInvalid &&
                      'border-destructive focus-visible:ring-destructive',
                    showShake && 'animate-shake',
                    fieldActionsRoom(actionCount),
                    className,
                  )}
                  ref={ref}
                  required={required}
                  aria-invalid={showInvalid || undefined}
                  aria-describedby={describedBy}
                  aria-errormessage={hasError ? errorId : undefined}
                  {...props}
                  style={{ ...style, ...securityStyle }}
                />
              </DisabledReasonTooltip>
              <div className={FIELD_ACTIONS_END}>
                {showCopy && (
                  <CopyValueButton
                    getValue={() =>
                      frameRef.current?.querySelector('input')?.value ?? ''
                    }
                    label={copyLabel}
                    copiedLabel={copiedLabel}
                  />
                )}
                {showToggle && (
                  <RevealToggle
                    revealed={revealed}
                    onToggle={() => setShow((v) => !v)}
                    labels={
                      revealLabels ?? {
                        show: t('aria.showPassword'),
                        hide: t('aria.hidePassword'),
                      }
                    }
                  />
                )}
              </div>
            </div>
          </SkeletonBox>
        </FieldShell>
      );
    }

    if (suffix || prefix) {
      return (
        <FieldShell
          {...(label !== undefined
            ? {
                label: (
                  <Label
                    htmlFor={id}
                    required={required}
                    error={hasError}
                    info={labelInfo}
                  >
                    {label}
                  </Label>
                ),
              }
            : {})}
          {...(description !== undefined
            ? {
                description: (
                  <Description id={descriptionId}>{description}</Description>
                ),
              }
            : {})}
          {...(hint !== undefined
            ? {
                hint: <Description id={hintId}>{hint}</Description>,
              }
            : {})}
          {...(errorMessage !== undefined
            ? {
                error: (
                  <p
                    id={errorId}
                    role="alert"
                    aria-live="polite"
                    className="text-destructive flex items-center gap-1.5 text-sm"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    {errorMessage}
                  </p>
                ),
              }
            : {})}
          {...(wrapperClassName !== undefined
            ? { className: wrapperClassName }
            : {})}
          wideControl={wideControl}
        >
          {/* The border + focus ring live on the wrapper; the input is
              transparent and content-sized so the value and the fixed
              prefix/suffix read as one contiguous string. Clicking anywhere
              in the box focuses the field — the inner input owns the
              semantics. */}
          <SkeletonBox asChild>
            {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- focus-forwarding wrapper; the child input is the interactive control */}
            <div
              className={cn(
                `bg-input flex h-9 w-full items-center rounded-lg border border-[color:var(--color-border-input)] px-3 py-2 text-base transition-[border-color,box-shadow] duration-150 md:text-sm ${FIELD_FOCUS_WITHIN}`,
                showInvalid && FIELD_INVALID_WITHIN,
                showShake && 'animate-shake',
                className,
              )}
              onMouseDown={(e) => {
                if (!(e.target instanceof HTMLInputElement)) {
                  e.preventDefault();
                  e.currentTarget.querySelector('input')?.focus();
                }
              }}
            >
              {prefix && (
                <span className="text-muted-foreground shrink-0 select-none">
                  {prefix}
                </span>
              )}
              <DisabledReasonTooltip
                reason={disabledReason}
                active={softDisabled}
              >
                <input
                  id={id}
                  type={inputType}
                  {...sensitiveAttrs}
                  {...disabledAttrs}
                  className="placeholder:text-muted-foreground [field-sizing:content] min-w-0 border-0 bg-transparent p-0 text-base outline-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-[color:var(--color-fg-subtle)] aria-disabled:cursor-not-allowed aria-disabled:text-[color:var(--color-fg-subtle)] md:text-sm"
                  ref={ref}
                  required={required}
                  aria-invalid={showInvalid || undefined}
                  aria-describedby={describedBy}
                  aria-errormessage={hasError ? errorId : undefined}
                  {...props}
                  style={{ ...style, ...securityStyle }}
                />
              </DisabledReasonTooltip>
              {suffix && (
                <span className="text-muted-foreground shrink-0 select-none">
                  {suffix}
                </span>
              )}
            </div>
          </SkeletonBox>
        </FieldShell>
      );
    }

    return (
      <FieldShell
        {...(label !== undefined
          ? {
              label: (
                <Label
                  htmlFor={id}
                  required={required}
                  error={hasError}
                  info={labelInfo}
                >
                  {label}
                </Label>
              ),
            }
          : {})}
        {...(description !== undefined
          ? {
              description: (
                <Description id={descriptionId}>{description}</Description>
              ),
            }
          : {})}
        {...(hint !== undefined
          ? {
              hint: <Description id={hintId}>{hint}</Description>,
            }
          : {})}
        {...(errorMessage !== undefined
          ? {
              error: (
                <p
                  id={errorId}
                  role="alert"
                  aria-live="polite"
                  className="text-destructive flex items-center gap-1.5 text-sm"
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  {errorMessage}
                </p>
              ),
            }
          : {})}
        {...(wrapperClassName !== undefined
          ? { className: wrapperClassName }
          : {})}
        wideControl={wideControl}
      >
        <DisabledReasonTooltip reason={disabledReason} active={softDisabled}>
          <SkeletonBox asChild>
            <input
              id={id}
              type={inputType}
              {...sensitiveAttrs}
              {...disabledAttrs}
              className={cn(
                inputVariants({ variant: resolvedVariant }),
                showInvalid && FIELD_INVALID,
                showShake && 'animate-shake',
                className,
              )}
              ref={ref}
              required={required}
              aria-invalid={showInvalid || undefined}
              aria-describedby={describedBy}
              aria-errormessage={hasError ? errorId : undefined}
              {...props}
              style={{ ...style, ...securityStyle }}
            />
          </SkeletonBox>
        </DisabledReasonTooltip>
      </FieldShell>
    );
  },
);
InputBase.displayName = 'InputBase';

// Keep the same control tree while its own surface is masked.
export const Input = InputBase;
Input.displayName = 'Input';
