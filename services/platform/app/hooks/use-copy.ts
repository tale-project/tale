'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

export interface UseCopyOptions {
  /** Duration in ms to show the copied state (default: 2000) */
  copiedDuration?: number;
  /** Callback when copy succeeds */
  onSuccess?: () => void;
  /** Callback when copy fails */
  onError?: (error: Error) => void;
  /** Whether to show a toast on error (default: true) */
  showErrorToast?: boolean;
}

interface UseCopyReturn {
  /** Whether the value was recently copied */
  copied: boolean;
  /** Copy the given value to clipboard */
  copy: (value: string) => Promise<boolean>;
  /** Reset the copied state */
  reset: () => void;
}

/**
 * Hook for copying text to clipboard with state management.
 * Handles the copied state, error handling, and optional toast notifications.
 *
 * @example
 * ```tsx
 * const { copied, copy } = useCopy();
 *
 * return (
 *   <button onClick={() => copy('text to copy')}>
 *     {copied ? <Check /> : <Copy />}
 *   </button>
 * );
 * ```
 *
 * @example
 * ```tsx
 * // With options
 * const { copied, copy } = useCopy({
 *   copiedDuration: 3000,
 *   onSuccess: () => console.log('Copied!'),
 * });
 * ```
 */
function useCopy(options: UseCopyOptions = {}): UseCopyReturn {
  const {
    copiedDuration = 2000,
    onSuccess,
    onError,
    showErrorToast = true,
  } = options;

  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const { t: tCommon } = useT('common');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Store toast and translation in refs to keep the copy callback stable
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tCommonRef = useRef(tCommon);
  tCommonRef.current = tCommon;

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (value: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);

        // Clear any existing timeout
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // Reset after duration
        timeoutRef.current = setTimeout(() => {
          setCopied(false);
        }, copiedDuration);

        onSuccess?.();
        return true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Failed to copy');
        console.error('Copy to clipboard failed:', err);

        if (showErrorToast) {
          toastRef.current({
            title: tCommonRef.current('errors.failedToCopy'),
            variant: 'destructive',
          });
        }

        onError?.(err);
        return false;
      }
    },
    [copiedDuration, onSuccess, onError, showErrorToast],
  );

  const reset = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setCopied(false);
  }, []);

  return { copied, copy, reset };
}

/**
 * Props for the CopyButton component pattern.
 */
export interface CopyButtonRenderProps {
  copied: boolean;
  onClick: () => void;
}

/**
 * Hook that returns render props for a copy button.
 * Useful when you want the component to manage its own value.
 *
 * @example
 * ```tsx
 * function MyCopyButton({ value }: { value: string }) {
 *   const { copied, onClick } = useCopyButton(value);
 *
 *   return (
 *     <button onClick={onClick}>
 *       {copied ? 'Copied!' : 'Copy'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useCopyButton(
  value: string,
  options: UseCopyOptions = {}
): CopyButtonRenderProps {
  const { copied, copy } = useCopy(options);

  const onClick = useCallback(() => {
    copy(value);
  }, [copy, value]);

  return { copied, onClick };
}
