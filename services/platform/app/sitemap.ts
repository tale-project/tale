import type { MetadataRoute } from 'next';

const baseUrl = process.env.SITE_URL || 'https://app.tale.dev';

const baseSitemap: Partial<MetadataRoute.Sitemap[number]> = {
  changeFrequency: 'weekly',
  priority: 0.8,
};

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      ...baseSitemap,
      url: baseUrl,
      priority: 1.0,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/log-in`,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/sign-up`,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/demo`,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/demo/churn-calculator`,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/demo/subject-line-tester`,
    },
    {
      ...baseSitemap,
      url: `${baseUrl}/churn-survey-generator`,
    },
  ];
}
