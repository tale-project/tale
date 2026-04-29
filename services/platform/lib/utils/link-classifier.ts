export type LinkKind =
  | { kind: 'internal'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'hash'; href: string }
  | { kind: 'special'; href: string };

export function classifyLink(href: string | undefined): LinkKind | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#')) return { kind: 'hash', href: trimmed };

  if (/^(mailto:|tel:|sms:)/i.test(trimmed)) {
    return { kind: 'special', href: trimmed };
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { kind: 'internal', to: trimmed };
  }

  if (typeof window === 'undefined') {
    return { kind: 'external', href: trimmed };
  }

  try {
    const url = new URL(trimmed, window.location.href);
    if (url.origin === window.location.origin) {
      return { kind: 'internal', to: url.pathname + url.search + url.hash };
    }
    return { kind: 'external', href: url.toString() };
  } catch {
    return { kind: 'external', href: trimmed };
  }
}
