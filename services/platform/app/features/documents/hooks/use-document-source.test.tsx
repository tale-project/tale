// @vitest-environment jsdom
import { AppShell } from '@tale/ui/app-shell';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';

import { useDocumentSource } from './use-document-source';

function Providers({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

function sourceOf(sourceProvider?: string, sourceMode?: 'auto' | 'manual') {
  return renderHook(() => useDocumentSource(sourceProvider, sourceMode), {
    wrapper: Providers,
  }).result.current;
}

describe('useDocumentSource', () => {
  // The preview sidebar kept its own map of three providers and printed the
  // slug for every other one (`google_drive`, `agent`); the Source column and
  // the preview now read this one map.
  it.each([
    ['onedrive', 'auto', 'OneDrive (synced)', true],
    ['onedrive', 'manual', 'OneDrive (not synced)', false],
    ['sharepoint', 'manual', 'SharePoint (not synced)', false],
    ['google_drive', 'auto', 'Google Drive (synced)', true],
    ['google_drive', 'manual', 'Google Drive (not synced)', false],
    ['gdrive', 'auto', 'Google Drive (synced)', true],
  ] as const)('names %s (%s) as "%s"', (provider, mode, label, synced) => {
    expect(sourceOf(provider, mode)).toMatchObject({
      label,
      brand: true,
      synced,
    });
  });

  it.each([
    ['upload', 'Upload'],
    ['agent', 'Agent'],
    ['knowledge', 'Knowledge entry'],
    ['api_import', 'API'],
    ['webdav', 'WebDAV'],
    ['confluence', 'Confluence'],
  ] as const)('names %s as "%s" with no sync state', (provider, label) => {
    const source = sourceOf(provider, 'manual');
    expect(source).toMatchObject({ label, brand: false });
    expect(source?.synced).toBeUndefined();
  });

  it('keeps a provenance a REST caller named in its own words', () => {
    expect(sourceOf('erp-export')).toMatchObject({
      label: 'erp-export',
      brand: false,
    });
  });

  it('has nothing to say without a provenance', () => {
    expect(sourceOf(undefined)).toBeNull();
    expect(sourceOf('')).toBeNull();
  });
});
