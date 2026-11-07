import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SUPPORT_URL,
  SupportUrlProvider,
  supportUrlFor,
  useSupportUrl,
} from './support-url';

describe('useSupportUrl', () => {
  it('points at tale.dev/contact outside a provider', () => {
    const { result } = renderHook(() => useSupportUrl());
    expect(result.current).toBe('https://tale.dev/contact');
    expect(DEFAULT_SUPPORT_URL).toBe('https://tale.dev/contact');
  });

  it('reads the page the nearest provider names', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SupportUrlProvider url="https://help.example.com/outer">
        <SupportUrlProvider url="https://help.example.com/inner">
          {children}
        </SupportUrlProvider>
      </SupportUrlProvider>
    );
    const { result } = renderHook(() => useSupportUrl(), { wrapper });
    expect(result.current).toBe('https://help.example.com/inner');
  });

  it('keeps the enclosing page when a provider names none', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SupportUrlProvider url="https://help.example.com/outer">
        <SupportUrlProvider url={undefined}>{children}</SupportUrlProvider>
      </SupportUrlProvider>
    );
    const { result } = renderHook(() => useSupportUrl(), { wrapper });
    expect(result.current).toBe('https://help.example.com/outer');
  });

  it('keeps the default under a provider that names none', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SupportUrlProvider url="">{children}</SupportUrlProvider>
    );
    const { result } = renderHook(() => useSupportUrl(), { wrapper });
    expect(result.current).toBe(DEFAULT_SUPPORT_URL);
  });

  it("lets a display's own page win over the provider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SupportUrlProvider url="https://help.example.com/provider">
        {children}
      </SupportUrlProvider>
    );
    const { result } = renderHook(
      () => useSupportUrl('https://help.example.com/prop'),
      { wrapper },
    );
    expect(result.current).toBe('https://help.example.com/prop');
  });
});

describe('supportUrlFor', () => {
  it('returns the page unchanged without an organization', () => {
    expect(supportUrlFor('https://tale.dev/contact')).toBe(
      'https://tale.dev/contact',
    );
  });

  it('appends the organization as the query string', () => {
    expect(supportUrlFor('https://tale.dev/contact', 'org_1')).toBe(
      'https://tale.dev/contact?organizationId=org_1',
    );
  });

  it('extends an existing query string', () => {
    expect(
      supportUrlFor('https://help.example.com/new?source=tale', 'org_1'),
    ).toBe('https://help.example.com/new?source=tale&organizationId=org_1');
    expect(supportUrlFor('https://help.example.com/new?', 'org_1')).toBe(
      'https://help.example.com/new?organizationId=org_1',
    );
  });

  it('keeps a fragment after the query string', () => {
    expect(supportUrlFor('https://help.example.com/#contact', 'org_1')).toBe(
      'https://help.example.com/?organizationId=org_1#contact',
    );
  });

  it('replaces an organizationId the page already carries', () => {
    expect(
      supportUrlFor(
        'https://help.example.com/new?organizationId=x&source=tale',
        'org_1',
      ),
    ).toBe('https://help.example.com/new?source=tale&organizationId=org_1');
    expect(
      supportUrlFor(
        'https://help.example.com/?organizationId=x&organizationId=y#top',
        'org_1',
      ),
    ).toBe('https://help.example.com/?organizationId=org_1#top');
  });

  it('keeps a parameter that only starts with organizationId', () => {
    expect(
      supportUrlFor('https://help.example.com/?organizationIds=a', 'org_1'),
    ).toBe('https://help.example.com/?organizationIds=a&organizationId=org_1');
  });

  it('replaces encoded organization keys without rewriting other values', () => {
    const result = supportUrlFor(
      'https://help.example.com/?%6FrganizationId=old&organization%49d=older&source=a%20b&source=a+b&?organizationId=keep#top',
      'org_1',
    );
    expect(new URL(result).searchParams.getAll('organizationId')).toEqual([
      'org_1',
    ]);
    expect(result).toBe(
      'https://help.example.com/?source=a%20b&source=a+b&?organizationId=keep&organizationId=org_1#top',
    );
  });

  it('encodes the organization', () => {
    expect(supportUrlFor('https://help.example.com/', 'a&b=c')).toBe(
      'https://help.example.com/?organizationId=a%26b%3Dc',
    );
  });
});
