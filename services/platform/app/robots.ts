import type { MetadataRoute } from 'next';

const baseUrl = process.env.SITE_URL || 'https://app.tale.dev';

export default function robots(): MetadataRoute.Robots {
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
