import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (_ns: string) => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'apiDocs.openDocs': 'API documentation',
        'apiDocs.guides': 'Developer guides',
        'apiDocs.openapiDocument': 'OpenAPI document (JSON)',
      };
      return translations[key] ?? key;
    },
  }),
}));

// The rendered reference used to be the only surface `/docs` pointed at:
// the guides and the raw OpenAPI document were reachable only by knowing
// their URLs (2026-09-14 evaluation, g9-2). The header names both.
import { DeveloperSurfaces, SWAGGER_UI_OPTIONS } from './docs';

describe('DeveloperSurfaces', () => {
  it('links the developer guides on the docs site and the OpenAPI document', async () => {
    const { container } = render(<DeveloperSurfaces />);
    const guides = screen.getByRole('link', { name: 'Developer guides' });
    expect(guides).toHaveAttribute(
      'href',
      `${TALE_DOCS_URL}/develop/api-reference`,
    );
    expect(guides).toHaveAttribute('target', '_blank');
    expect(guides).toHaveAttribute('rel', 'noopener noreferrer');
    const document = screen.getByRole('link', {
      name: 'OpenAPI document (JSON)',
    });
    expect(document).toHaveAttribute('href', '/openapi.json');
    expect(document).not.toHaveAttribute('target');
    expect(
      screen.getByRole('navigation', { name: 'API documentation' }),
    ).toBeInTheDocument();
    await checkAccessibility(container);
  });
});

describe('the rendered reference’s Swagger UI options', () => {
  it('keeps a pasted API key in page memory only, never in localStorage', () => {
    // With persistence on, the key was written to localStorage in
    // plaintext on the product origin and restored on every load
    // (2026-09-14 evaluation, h1).
    expect(SWAGGER_UI_OPTIONS.persistAuthorization).toBe(false);
  });

  it('sends the session along on the reference’s own API calls only', () => {
    const api = SWAGGER_UI_OPTIONS.requestInterceptor({ url: '/api/v1/me' });
    expect(api.credentials).toBe('include');
    const other = SWAGGER_UI_OPTIONS.requestInterceptor({
      url: '/openapi.json',
    });
    expect(other).not.toHaveProperty('credentials');
  });
});
