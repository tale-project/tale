'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import * as Sentry from '@sentry/tanstackstart-react';

interface GlobalErrorDisplayProps {
  error: Error;
  reset?: () => void;
}

const FALLBACK_TEXT = {
  somethingWentWrong: 'Something went wrong',
  errorLoadingPage: 'An error occurred while loading this page.',
  tryAgain: 'Try again',
  persistsProblem: 'If this problem persists, please',
  contactSupport: 'contact support',
  showError: 'Show error',
  hideError: 'Hide error',
};

function useIsDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  return isDark;
}

function ErrorDetails({
  error,
  show,
  isDark,
}: {
  error: Error;
  show: boolean;
  isDark: boolean;
}) {
  if (!show) return null;

  const errorString = error.message || String(error);
  const stack = error.stack;

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.75rem',
        backgroundColor: isDark ? '#2d1f1f' : '#fef2f2',
        border: `1px solid ${isDark ? '#5c2c2c' : '#fecaca'}`,
        borderRadius: '0.375rem',
        textAlign: 'left',
        maxHeight: '200px',
        overflow: 'auto',
      }}
    >
      <pre
        style={{
          margin: 0,
          fontSize: '0.7rem',
          color: isDark ? '#f87171' : '#dc2626',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'monospace',
        }}
      >
        <code>{stack || errorString}</code>
      </pre>
    </div>
  );
}

export function GlobalErrorDisplay({ error, reset }: GlobalErrorDisplayProps) {
  const router = useRouter();
  const [showError, setShowError] = useState(false);
  const isDarkMode = useIsDarkMode();

  const logoSrc = isDarkMode
    ? '/assets/logo-white.svg'
    : '/assets/logo-black.svg';
  const textColor = isDarkMode ? '#f3f4f6' : '#111827';
  const mutedColor = isDarkMode ? '#9ca3af' : '#6b7280';

  useEffect(() => {
    Sentry.captureException(error, {
      tags: {
        errorBoundary: 'global',
      },
    });
  }, [error]);

  const handleReset = () => {
    if (reset) {
      reset();
    } else {
      router.invalidate();
    }
  };

  const toggleButtonStyle = {
    padding: '0.5rem 1rem',
    backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
    color: isDarkMode ? '#d1d5db' : '#374151',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
  };

  const primaryButtonStyle = {
    padding: '0.5rem 1rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
  };

  return (
    <div
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ padding: '2.5rem' }}>
        <img
          src={logoSrc}
          alt="Tale"
          style={{ width: '1.25rem', height: '1.25rem' }}
        />
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
          padding: '4rem 2rem',
        }}
      >
        <div style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              marginBottom: '0.5rem',
              color: textColor,
            }}
          >
            {FALLBACK_TEXT.somethingWentWrong}
          </h1>
          <p
            style={{
              color: mutedColor,
              fontSize: '0.875rem',
              marginBottom: '1.5rem',
            }}
          >
            {FALLBACK_TEXT.errorLoadingPage}
          </p>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <button onClick={handleReset} style={primaryButtonStyle}>
              {FALLBACK_TEXT.tryAgain}
            </button>
            <button
              onClick={() => setShowError(!showError)}
              style={toggleButtonStyle}
            >
              {showError ? FALLBACK_TEXT.hideError : FALLBACK_TEXT.showError}
            </button>
          </div>
          <p
            style={{
              color: mutedColor,
              fontSize: '0.75rem',
              marginTop: '1rem',
            }}
          >
            {FALLBACK_TEXT.persistsProblem}{' '}
            <a
              href="https://tale.dev/contact"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#3b82f6', textDecoration: 'underline' }}
            >
              {FALLBACK_TEXT.contactSupport}
            </a>
            .
          </p>
          <ErrorDetails error={error} show={showError} isDark={isDarkMode} />
        </div>
      </div>
    </div>
  );
}
