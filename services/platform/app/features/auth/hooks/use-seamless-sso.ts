import { useCallback, useEffect, useRef, useState } from 'react';

import { useIsSsoConfigured } from '@/app/features/auth/hooks/queries';
import { getEnv } from '@/lib/env';

const SILENT_AUTH_TIMEOUT_MS = 5000;

type SeamlessSsoState = {
  isAttempting: boolean;
  succeeded: boolean;
  failed: boolean;
};

export function useSeamlessSso() {
  const { data: ssoConfig, isLoading } = useIsSsoConfigured();
  const [state, setState] = useState<SeamlessSsoState>({
    isAttempting: false,
    succeeded: false,
    failed: false,
  });
  const attemptedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (iframeRef.current) {
      iframeRef.current.remove();
      iframeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isLoading || attemptedRef.current) {
      return undefined;
    }

    if (!ssoConfig?.enabled || !ssoConfig.seamlessSsoEnabled) {
      return undefined;
    }

    attemptedRef.current = true;
    setState({ isAttempting: true, succeeded: false, failed: false });

    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const callbackUri = `${siteUrl}${basePath}/http_api/api/sso/callback`;
    const authorizeUrl = `${siteUrl}${basePath}/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}&seamless=true`;

    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.setAttribute('title', 'SSO authentication');
    iframeRef.current = iframe;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== siteUrl) {
        return;
      }

      if (event.data?.type === 'sso-silent-success') {
        cleanup();
        window.removeEventListener('message', handleMessage);
        setState({ isAttempting: false, succeeded: true, failed: false });
        const dashboardUrl = `${basePath}/dashboard`;
        window.location.href = dashboardUrl;
      }

      if (event.data?.type === 'sso-silent-failure') {
        cleanup();
        window.removeEventListener('message', handleMessage);
        setState({ isAttempting: false, succeeded: false, failed: true });
      }
    };

    window.addEventListener('message', handleMessage);

    timeoutRef.current = setTimeout(() => {
      cleanup();
      window.removeEventListener('message', handleMessage);
      setState({ isAttempting: false, succeeded: false, failed: true });
    }, SILENT_AUTH_TIMEOUT_MS);

    iframe.src = authorizeUrl;
    document.body.appendChild(iframe);

    return () => {
      cleanup();
      window.removeEventListener('message', handleMessage);
    };
  }, [isLoading, ssoConfig, cleanup]);

  return state;
}
