import { useEffect } from 'react';

interface DocumentMeta {
  title: string;
  description: string;
  canonicalPath?: string;
}

const SITE_TITLE = 'Tale';
const SITE_URL = 'https://tale.dev';

function setMeta(
  selector: string,
  attr: 'name' | 'property',
  key: string,
  content: string,
) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function useDocumentMeta({
  title,
  description,
  canonicalPath,
}: DocumentMeta) {
  useEffect(() => {
    const fullTitle = title.includes(SITE_TITLE)
      ? title
      : `${title} | ${SITE_TITLE}`;
    document.title = fullTitle;

    setMeta('meta[name="description"]', 'name', 'description', description);
    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle);
    setMeta(
      'meta[property="og:description"]',
      'property',
      'og:description',
      description,
    );
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle);
    setMeta(
      'meta[name="twitter:description"]',
      'name',
      'twitter:description',
      description,
    );

    if (canonicalPath !== undefined) {
      const canonical = `${SITE_URL}${canonicalPath}`;
      setLink('canonical', canonical);
      setMeta('meta[property="og:url"]', 'property', 'og:url', canonical);
    } else {
      document.head.querySelector('link[rel="canonical"]')?.remove();
      document.head.querySelector('meta[property="og:url"]')?.remove();
    }
  }, [title, description, canonicalPath]);
}
