'use client';

import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { useT } from '@tale/ui/i18n/client';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Tooltip } from '@tale/ui/tooltip';
import { cva, type VariantProps } from 'class-variance-authority';
import { Eye, EyeOff, XCircle } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef, useState, useId, useEffect } from 'react';

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
import { Label } from './label';

const inputVariants = cva(
  // One height fits all (`h-9`). Disabled is a filled muted field
  // (design-system Input/Text `xZ0I9`), not an opacity wash.
  'placeholder:text-muted-foreground flex h-9 w-full text-base transition-[border-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[color:var(--color-bg-elevated)] disabled:text-[color:var(--color-fg-subtle)] aria-disabled:cursor-not-allowed aria-disabled:bg-[color:var(--color-bg-elevated)] aria-disabled:text-[color:var(--color-fg-subtle)]',
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
    passwordToggle?: boolean;
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

    // A field is "sensitive" when it holds a secret that is NOT an account
    // password — API keys, tokens, connector credentials. The caller opts in
    // via `sensitive`, OR it's a `type="password"` field that did NOT declare
    // an explicit `autoComplete`. The explicit-autoComplete carve-out keeps
    // genuine account forms working: login / 2FA / reset pass
    // `autoComplete="current-password"` / `"new-password"` because they *want*
    // the password manager to fill and save. Every credential-config field
    // passes no autoComplete, so it's protected automatically.
    const isSensitive = sensitive || (isPassword && autoComplete == null);

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
        ? show
          ? 'text'
          : 'password'
        : type;
    // For sensitive fields, mask via CSS unless revealed. For real password
    // fields, clear the browser's autofill `-webkit-text-security` overlay when
    // the value is revealed (it persists even after `type` flips to "text").
    const securityStyle: { WebkitTextSecurity?: 'disc' | 'none' } | undefined =
      isSensitive
        ? { WebkitTextSecurity: show ? 'none' : 'disc' }
        : isPassword && show
          ? { WebkitTextSecurity: 'none' }
          : undefined;
    // Whether to render the eye reveal button: any masked field that opts into
    // the toggle (sensitive secrets or genuine passwords).
    const showToggle = (isSensitive || isPassword) && passwordToggle;

    const resolvedAutoComplete =
      autoComplete ?? (isSensitive ? 'off' : undefined);
    // Belt-and-suspenders for password managers, which key off field
    // name/label rather than just `type`: explicitly opt out of 1Password /
    // LastPass / Bitwarden / Dashlane. (The `type="text"` switch above is what
    // actually stops the browser's own password dropdown.)
    const sensitiveAttrs = isSensitive
      ? {
          autoComplete: resolvedAutoComplete,
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

    if (showToggle) {
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
            <div className="relative rounded-lg">
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
                    'pr-10',
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
              <Tooltip
                content={show ? t('aria.hidePassword') : t('aria.showPassword')}
              >
                <button
                  type="button"
                  aria-label={
                    show ? t('aria.hidePassword') : t('aria.showPassword')
                  }
                  aria-pressed={show}
                  className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-2 my-auto inline-flex size-6 items-center justify-center rounded-md transition-colors duration-150"
                  onClick={() => setShow((v) => !v)}
                >
                  {show ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </Tooltip>
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
                `bg-input flex h-9 w-full items-center rounded-lg border border-[color:var(--color-border-input)] px-3 py-2 text-base transition-[border-color,box-shadow] duration-150 ${FIELD_FOCUS_WITHIN}`,
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
                  className="placeholder:text-muted-foreground [field-sizing:content] min-w-0 border-0 bg-transparent p-0 text-base outline-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:text-[color:var(--color-fg-subtle)] aria-disabled:cursor-not-allowed aria-disabled:text-[color:var(--color-fg-subtle)]"
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
