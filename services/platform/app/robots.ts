import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/get-site-url';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const baseUrl = await getSiteUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/log-in', '/sign-up', '/demo', '/churn-survey-generator'],
        disallow: ['/dashboard/', '/api/', '/convex-dashboard/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
