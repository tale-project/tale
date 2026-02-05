import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy, useMemo } from 'react';
import { Stack } from '@/app/components/ui/layout/layout';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import 'swagger-ui-react/swagger-ui.css';

const SwaggerUI = lazy(() => import('swagger-ui-react'));

export const Route = createFileRoute('/docs')({
  component: ApiDocsPage,
});

function SwaggerSkeleton() {
  return (
    <Stack gap={4} className="p-8">
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-8 w-3/4" />
      <Stack gap={2}>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </Stack>
    </Stack>
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
      requestInterceptor: (req: Record<string, unknown>) => {
        if (typeof req.url === 'string' && req.url.includes('/api/')) {
          req.credentials = 'include';
        }
        return req;
      },
    }),
    [],
  );

  return (
    <div className="min-h-screen bg-background">
      <main className="swagger-ui-standalone">
        <Suspense fallback={<SwaggerSkeleton />}>
          <SwaggerUI {...swaggerConfig} />
        </Suspense>
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
