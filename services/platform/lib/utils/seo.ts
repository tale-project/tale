interface SeoParams {
  title: string;
  description?: string;
}

export function seo({ title, description }: SeoParams) {
  const tags: Array<Record<string, string>> = [
    { title },
    { name: 'og:title', content: title },
    { name: 'og:type', content: 'website' },
  ];

  if (description) {
    tags.push(
      { name: 'description', content: description },
      { name: 'og:description', content: description },
    );
  }

  return tags;
}
