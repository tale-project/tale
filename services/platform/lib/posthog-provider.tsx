'use client';

import { useEffect, type ReactNode } from 'react';
import posthog from 'posthog-js';
import { getEnv } from '@/lib/env';

interface PostHogProviderProps {
  children: ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
  useEffect(() => {
    const apiKey = getEnv('POSTHOG_KEY');
    const apiHost = getEnv('POSTHOG_HOST');

    if (!apiKey) {
      return;
    }

    posthog.init(apiKey, {
      api_host: apiHost,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
    });

    return () => {
      posthog.reset();
    };
  }, []);

  return <>{children}</>;
}

export { posthog };
