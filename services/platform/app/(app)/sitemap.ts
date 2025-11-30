import type { MetadataRoute } from 'next';

const baseSitemap: Partial<MetadataRoute.Sitemap[number]> = {
  changeFrequency: 'weekly',
  priority: 0.8,
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://app.tale.dev';

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
