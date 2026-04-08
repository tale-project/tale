import { useEffect, useRef } from 'react';

import { getEnv } from '@/lib/env';

interface SilentSsoFrameProps {
  onSuccess: () => void;
  onFailure: () => void;
}

const SILENT_AUTH_TIMEOUT_MS = 5000;

export function SilentSsoFrame({ onSuccess, onFailure }: SilentSsoFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handledRef = useRef(false);

  useEffect(() => {
    const siteUrl = getEnv('SITE_URL');

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== siteUrl || handledRef.current) {
        return;
      }

      if (event.data?.type === 'sso-silent-success') {
        handledRef.current = true;
        onSuccess();
      }

      if (event.data?.type === 'sso-silent-failure') {
        handledRef.current = true;
        onFailure();
      }
    };

    window.addEventListener('message', handleMessage);

    const timeout = setTimeout(() => {
      if (!handledRef.current) {
        handledRef.current = true;
        onFailure();
      }
    }, SILENT_AUTH_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, [onSuccess, onFailure]);

  const siteUrl = getEnv('SITE_URL');
  const basePath = getEnv('BASE_PATH');
  const callbackUri = `${siteUrl}${basePath}/http_api/api/sso/callback`;
  const authorizeUrl = `${siteUrl}${basePath}/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}&seamless=true`;

  return (
    <iframe
      ref={iframeRef}
      src={authorizeUrl}
      style={{ display: 'none' }}
      aria-hidden="true"
      tabIndex={-1}
      title="SSO authentication"
    />
  );
}
