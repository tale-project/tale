import { Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, useMemo } from 'react';

import { SuspenseBoundary } from '@/app/components/error-boundaries/core/suspense-boundary';
import { ContentArea } from '@/app/components/layout/content-area';
import { seo } from '@/lib/utils/seo';

import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = lazy(() => import('swagger-ui-react'));

export const Route = createFileRoute('/docs')({
  head: () => ({
    meta: seo('apiDocs'),
  }),
  component: ApiDocsPage,
});

function SwaggerSkeleton() {
  return (
    <Skeletonize loading className="contents">
      <ContentArea variant="page" gap={4} className="p-8">
        <SkeletonBox>
          <div className="h-10 w-full max-w-md" />
        </SkeletonBox>
        <SkeletonBox>
          <div className="h-8 w-3/4" />
        </SkeletonBox>
        <Stack gap={2}>
          <SkeletonBox>
            <div className="h-6 w-1/2" />
          </SkeletonBox>
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

function ApiDocsPage() {
  const swaggerConfig = useMemo(
    () => ({
      url: '/openapi.json',
      docExpansion: 'list' as const,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 2,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      deepLinking: false,
      tagsSorter: 'alpha' as const,
      operationsSorter: 'alpha' as const,
      requestInterceptor: (req: Record<string, unknown>) => {
        if (typeof req.url === 'string' && req.url.includes('/api/')) {
          req.credentials = 'include';
        }
        return req;
      },
    }),
    [],
  );

  // Prevent TanStack Router from intercepting Swagger UI internal link clicks
  const handleClick = (e: React.MouseEvent) => {
    if (!(e.target instanceof HTMLElement)) return;
    const anchor = e.target.closest('a');
    if (anchor && anchor.getAttribute('href')?.startsWith('#')) {
      e.stopPropagation();
    }
  };

  return (
    <div className="bg-background min-h-dvh" onClickCapture={handleClick}>
      <main className="swagger-ui-standalone">
        <SuspenseBoundary fallback={<SwaggerSkeleton />}>
          <SwaggerUI {...swaggerConfig} />
        </SuspenseBoundary>
      </main>

      <style>{`
        /* Override global overflow:clip so the docs page can scroll */
        html:has(.swagger-ui-standalone),
        html:has(.swagger-ui-standalone) body,
        html:has(.swagger-ui-standalone) #root {
          overflow: auto !important;
          height: auto !important;
        }
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
