import { buttonVariants } from '@tale/ui/button';
import { ContentArea } from '@tale/ui/content-area';
import { SuspenseBoundary } from '@tale/ui/error-boundaries/suspense-boundary';
import { Stack } from '@tale/ui/layout';
import { TALE_DOCS_URL } from '@tale/ui/seo/globals';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, FileJson } from 'lucide-react';
import { lazy } from 'react';

import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = lazy(() => import('swagger-ui-react'));

export const Route = createFileRoute('/docs')({
  head: () => ({
    meta: seo('apiDocs'),
  }),
  // Warm the (heavy) swagger-ui-react chunk during the loader so it's cached by
  // render time — removes the Suspense fallback flash on first visit.
  loader: () => {
    void import('swagger-ui-react').catch((error: unknown) => {
      console.warn('Failed to preload Swagger UI chunk', error);
    });
  },
  component: ApiDocsPage,
});

function SwaggerSkeleton() {
  return (
    <Skeletonize loading className="contents">
      <ContentArea variant="page" gap={4} className="p-8">
        <div className="max-w-md">
          <SkeletonBox fullWidth>
            <div className="h-10" />
          </SkeletonBox>
        </div>
        <div className="w-3/4">
          <SkeletonBox fullWidth>
            <div className="h-8" />
          </SkeletonBox>
        </div>
        <Stack gap={2}>
          <div className="w-1/2">
            <SkeletonBox fullWidth>
              <div className="h-6" />
            </SkeletonBox>
          </div>
          <SkeletonBox fullWidth>
            <div className="h-24 w-full" />
          </SkeletonBox>
          <SkeletonBox fullWidth>
            <div className="h-24 w-full" />
          </SkeletonBox>
          <SkeletonBox fullWidth>
            <div className="h-24 w-full" />
          </SkeletonBox>
        </Stack>
      </ContentArea>
    </Skeletonize>
  );
}

/**
 * The rendered reference is one of three developer surfaces; the other two
 * (the prose guides on the docs site and the raw OpenAPI document Swagger
 * renders) were only reachable by knowing their URLs (2026-09-14
 * evaluation, g9-2).
 */
export function DeveloperSurfaces() {
  const { t } = useT('settings');
  const linkClass = buttonVariants({ variant: 'secondary', size: 'sm' });
  return (
    <nav
      aria-label={t('apiDocs.openDocs')}
      className="mx-auto flex max-w-[1400px] flex-wrap gap-2 px-4 pt-6"
    >
      <a
        href={`${TALE_DOCS_URL}/develop/api-reference`}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClass}
      >
        <BookOpen className="mr-2 size-4" />
        {t('apiDocs.guides')}
      </a>
      <a href="/openapi.json" className={linkClass}>
        <FileJson className="mr-2 size-4" />
        {t('apiDocs.openapiDocument')}
      </a>
    </nav>
  );
}

/** The rendered reference's configuration — one object for the page's
 * life, so the (heavy) Swagger UI never re-mounts on a render. */
export const SWAGGER_UI_OPTIONS = {
  url: '/openapi.json',
  docExpansion: 'list' as const,
  defaultModelsExpandDepth: 1,
  defaultModelExpandDepth: 2,
  displayRequestDuration: true,
  filter: true,
  showExtensions: true,
  showCommonExtensions: true,
  tryItOutEnabled: true,
  // The key a reader pastes lives in the page's memory only — the docs say
  // "keep the key behind your own backend", and with persistence on it was
  // written to localStorage in plaintext on the product origin, restored on
  // every load, and never cleared (2026-09-14 evaluation, h1).
  persistAuthorization: false,
  deepLinking: false,
  tagsSorter: 'alpha' as const,
  operationsSorter: 'alpha' as const,
  requestInterceptor: (req: Record<string, unknown>) => {
    if (typeof req.url === 'string' && req.url.includes('/api/')) {
      req.credentials = 'include';
    }
    return req;
  },
};

function ApiDocsPage() {
  // Prevent TanStack Router from intercepting Swagger UI internal link clicks
  const handleClick = (e: React.MouseEvent) => {
    if (!(e.target instanceof HTMLElement)) return;
    const anchor = e.target.closest('a');
    if (anchor && anchor.getAttribute('href')?.startsWith('#')) {
      e.stopPropagation();
    }
  };

  return (
    // The app shell locks document scroll (`#root` is `overflow:clip`), so the
    // docs page owns its own scroll region instead of unlocking the viewport.
    <div
      className="bg-background h-dvh overflow-y-auto"
      onClickCapture={handleClick}
    >
      <DeveloperSurfaces />
      <main className="swagger-ui-standalone">
        <SuspenseBoundary fallback={<SwaggerSkeleton />}>
          <SwaggerUI {...SWAGGER_UI_OPTIONS} />
        </SuspenseBoundary>
      </main>

      <style>{`
        .swagger-ui-standalone .swagger-ui {
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 1rem;
        }
        .swagger-ui-standalone .swagger-ui .info {
          margin: 30px 0;
        }
        .swagger-ui-standalone .swagger-ui .scheme-container {
          background: transparent;
          box-shadow: none;
          padding: 0;
        }
        .swagger-ui-standalone .swagger-ui .opblock-tag {
          border-bottom: 1px solid hsl(var(--border));
        }
        .swagger-ui-standalone .swagger-ui .opblock {
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .swagger-ui-standalone .swagger-ui .btn {
          border-radius: 6px;
        }
        .swagger-ui-standalone .swagger-ui input[type=text],
        .swagger-ui-standalone .swagger-ui textarea {
          border-radius: 6px;
        }
        .swagger-ui-standalone .swagger-ui .model-box {
          border-radius: 8px;
        }
        /* Dark mode support */
        .dark .swagger-ui-standalone .swagger-ui,
        .dark .swagger-ui-standalone .swagger-ui .info .title,
        .dark .swagger-ui-standalone .swagger-ui .info p,
        .dark .swagger-ui-standalone .swagger-ui .opblock-tag,
        .dark .swagger-ui-standalone .swagger-ui .opblock .opblock-summary-description,
        .dark .swagger-ui-standalone .swagger-ui .opblock-description-wrapper p,
        .dark .swagger-ui-standalone .swagger-ui .response-col_description__inner p,
        .dark .swagger-ui-standalone .swagger-ui table thead tr th,
        .dark .swagger-ui-standalone .swagger-ui table tbody tr td,
        .dark .swagger-ui-standalone .swagger-ui .parameter__name,
        .dark .swagger-ui-standalone .swagger-ui .parameter__type,
        .dark .swagger-ui-standalone .swagger-ui .model-title,
        .dark .swagger-ui-standalone .swagger-ui .model {
          color: hsl(var(--foreground));
        }
        .dark .swagger-ui-standalone .swagger-ui .opblock-tag {
          border-color: hsl(var(--border));
        }
        .dark .swagger-ui-standalone .swagger-ui .opblock {
          background: hsl(var(--muted) / 0.3);
          border-color: hsl(var(--border));
        }
        .dark .swagger-ui-standalone .swagger-ui section.models {
          border-color: hsl(var(--border));
        }
        .dark .swagger-ui-standalone .swagger-ui section.models .model-container {
          background: hsl(var(--muted) / 0.3);
        }
      `}</style>
    </div>
  );
}
