type LinkKind =
  | { kind: 'internal'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'hash'; href: string }
  | { kind: 'special'; href: string };

// Backend-proxied path prefixes: served by Caddy/Vite via reverse-proxy to
// Convex or the platform server. They are NOT TanStack Router routes, so
// `router.navigate` against them is a silent no-op (left-click does nothing).
const BACKEND_PREFIXES = ['/api/', '/http_api/', '/ws_api/', '/metrics/'];

function isBackendPath(pathname: string): boolean {
  return BACKEND_PREFIXES.some(
    (p) => pathname === p.slice(0, -1) || pathname.startsWith(p),
  );
}

export function classifyLink(href: string | undefined): LinkKind | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('#')) return { kind: 'hash', href: trimmed };

  if (/^(mailto:|tel:|sms:)/i.test(trimmed)) {
    return { kind: 'special', href: trimmed };
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return isBackendPath(trimmed)
      ? { kind: 'external', href: trimmed }
      : { kind: 'internal', to: trimmed };
  }

  if (typeof window === 'undefined') {
    return { kind: 'external', href: trimmed };
  }

  try {
    const url = new URL(trimmed, window.location.href);
    if (url.origin === window.location.origin) {
      return isBackendPath(url.pathname)
        ? { kind: 'external', href: url.toString() }
        : { kind: 'internal', to: url.pathname + url.search + url.hash };
    }
    return { kind: 'external', href: url.toString() };
  } catch {
    return { kind: 'external', href: trimmed };
  }
}
