/** Serialized into the page only AFTER primary trace/profile retention. Never
 * captures text, HTML, form values, raw URLs, arbitrary data attributes or IDs. */
export async function snapshotDialogStyle(
  limits = { nodes: 100_000, patterns: 2000 },
) {
  if (
    !Number.isSafeInteger(limits.nodes) ||
    limits.nodes < 1 ||
    limits.nodes > 100_000 ||
    !Number.isSafeInteger(limits.patterns) ||
    limits.patterns < 1 ||
    limits.patterns > 2000
  )
    throw new Error('Invalid style inventory bound');
  const startedAt = performance.now();
  const deadline = startedAt + 5000;
  const errors: string[] = [];
  const attributes = [
    'role',
    'data-state',
    'data-slot',
    'aria-hidden',
    'aria-expanded',
    'aria-haspopup',
    'aria-disabled',
    'data-disabled',
    'data-scroll-locked',
  ] as const;
  const describe = (element: Element) => {
    const classes = [...element.classList].sort();
    if (classes.length > 128 || classes.some((value) => value.length > 256)) {
      errors.push('Class inventory exceeded its bound');
      return { tag: element.tagName, boundedOut: true };
    }
    const attrs: Record<string, string | boolean> = {};
    for (const name of attributes) {
      const value = element.getAttribute(name);
      if (value !== null) {
        if (value.length > 80 || !/^[a-zA-Z0-9 _-]*$/.test(value)) {
          errors.push('Unsupported structural attribute');
          continue;
        }
        attrs[name] = value;
      }
    }
    for (const name of ['inert', 'disabled', 'aria-controls'])
      attrs[name] = element.hasAttribute(name);
    return { tag: element.tagName, classes, attrs };
  };
  const styleProperties = [
    'display',
    'visibility',
    'pointer-events',
    'position',
    'contain',
    'content-visibility',
    'animation-name',
    'animation-duration',
    'animation-delay',
    'transition-property',
    'transition-duration',
    'overflow',
    'overflow-x',
    'overflow-y',
    'padding-right',
    'margin-right',
  ];
  const stylesOf = (css: CSSStyleDeclaration) =>
    Object.fromEntries(
      styleProperties.map((property) => {
        const value = css.getPropertyValue(property);
        if (value.length > 512)
          errors.push('Style property exceeded its bound');
        return [property, value.slice(0, 512)];
      }),
    );
  const computed = (element: Element) => stylesOf(getComputedStyle(element));
  const inline = (element: Element) => stylesOf((element as HTMLElement).style);
  const patterns = new Map<
    string,
    { kind: string; count: number; shape: ReturnType<typeof describe> }
  >();
  const representatives: { kind: string; ordinal: number; chain: unknown[] }[] =
    [];
  const counts = { Assign: 0, Priority: 0, dialog: 0, overlay: 0 };
  const walker = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_ELEMENT,
  );
  let examined = 0;
  let patternCharacters = 0;
  let node: Node | null = walker.currentNode;
  while (node) {
    if (performance.now() > deadline) {
      errors.push('Style inventory exceeded5s');
      break;
    }
    if (++examined > limits.nodes) {
      errors.push('Node inventory exceeded its bound');
      break;
    }
    const element = node as Element;
    const label = element.getAttribute('aria-label');
    const kind =
      element.matches('[role="region"] section button') &&
      (label === 'Assign' || label === 'Priority')
        ? label
        : element.getAttribute('role') === 'dialog'
          ? 'dialog'
          : element.matches('.bg-bg-overlay[data-state]')
            ? 'overlay'
            : undefined;
    if (kind) {
      const ordinal = counts[kind]++;
      const shape = describe(element);
      const key = JSON.stringify([kind, shape]);
      const existing = patterns.get(key);
      if (existing) existing.count++;
      else if (
        patterns.size < limits.patterns &&
        patternCharacters + key.length <= 4 * 1024 * 1024
      ) {
        patternCharacters += key.length;
        patterns.set(key, { kind, count: 1, shape });
      } else {
        errors.push('Pattern inventory exceeded its bound');
        break;
      }
      if (ordinal < 4) {
        const chain = [];
        let parent: Element | null = element;
        while (parent && chain.length < 12) {
          chain.push({
            ...describe(parent),
            computed: computed(parent),
            inline: inline(parent),
          });
          parent = parent.parentElement;
        }
        representatives.push({ kind, ordinal, chain });
      }
    }
    node = walker.nextNode();
  }
  const styles = [];
  let styleBytes = 0;
  for (const element of document.querySelectorAll('style')) {
    if (performance.now() > deadline) {
      errors.push('Style inventory exceeded5s');
      break;
    }
    const bytes = new TextEncoder().encode(element.textContent ?? '');
    styleBytes += bytes.length;
    if (styles.length >= 128 || styleBytes > 1024 * 1024) {
      errors.push('Injected stylesheet inventory exceeded its bound');
      break;
    }
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    styles.push({
      bytes: bytes.length,
      sha256: [...new Uint8Array(hash)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
    });
  }
  const links = [];
  for (const element of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"]',
  )) {
    if (links.length >= 128) {
      errors.push('Linked stylesheet inventory exceeded its bound');
      break;
    }
    const url = new URL(element.href, location.href);
    const safePath =
      url.origin === location.origin &&
      /^\/assets\/[a-zA-Z0-9_.-]+\.css$/.test(url.pathname)
        ? url.pathname
        : null;
    links.push({
      assetPath: safePath,
      disabled: element.disabled,
      media: element.media.slice(0, 128),
    });
    if (!safePath || element.media.length > 128)
      errors.push('Unknown linked stylesheet');
  }
  const root = [document.documentElement, document.body].map((element) =>
    Object.assign(describe(element), {
      computed: computed(element),
      inline: inline(element),
    }),
  );
  const active = document.activeElement
    ? describe(document.activeElement)
    : null;
  if (performance.now() > deadline) errors.push('Style inventory exceeded5s');
  const result = {
    complete: errors.length === 0,
    errors: [...new Set(errors)],
    scope:
      'post-collection structural inventory; no historical render count or transient invalidation proof',
    startedAt,
    finishedAt: performance.now(),
    timeOrigin: performance.timeOrigin,
    examined,
    counts,
    patterns: [...patterns.values()],
    representatives,
    styles,
    linkedStylesheets: document.querySelectorAll('link[rel="stylesheet"]')
      .length,
    links,
    root,
    active,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 8 * 1024 * 1024)
    throw new Error('Style inventory exceeded8MiB');
  return result;
}
