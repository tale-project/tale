/** Installed on the exact original dialog before Escape. These are main-thread
 * animation callbacks, not proof of the compositor's last visible pixel. */
export function observeAcceptanceClose(dialog: Element) {
  if (
    document.querySelectorAll('[role="dialog"]').length !== 1 ||
    !dialog.isConnected ||
    dialog.getAttribute('role') !== 'dialog'
  )
    throw new Error('Expected one original connected modal');
  const overlays = document.querySelectorAll('.bg-bg-overlay[data-state]');
  if (overlays.length !== 1)
    throw new Error('Expected one production dialog overlay');
  const overlay = overlays[0]!;
  const identities = [
    { name: 'content', element: dialog },
    { name: 'overlay', element: overlay },
  ];
  const events: Record<string, unknown>[] = [];
  let overflow = false;
  const styles = (element: Element) => {
    const css = getComputedStyle(element);
    return {
      state: element.getAttribute('data-state'),
      animationName: css.animationName,
      animationDuration: css.animationDuration,
      animationDelay: css.animationDelay,
      animationTimingFunction: css.animationTimingFunction,
    };
  };
  const initial = identities.map(({ name, element }) => ({
    name,
    ...styles(element),
  }));
  const listeners: {
    element: Element;
    type: string;
    listener: EventListener;
  }[] = [];
  for (const { name, element } of identities)
    for (const type of ['animationstart', 'animationend', 'animationcancel']) {
      const listener: EventListener = (event) => {
        // Bubbling descendants and the other surface cannot certify this node.
        if (event.target !== element) return;
        const animation = event as AnimationEvent;
        if (events.length >= 64) {
          overflow = true;
          return;
        }
        events.push({
          name,
          type,
          at: performance.now(),
          eventTimestamp: event.timeStamp,
          eventAnimationName: animation.animationName,
          elapsedTime: animation.elapsedTime,
          pseudoElement: animation.pseudoElement,
          ...styles(element),
        });
      };
      element.addEventListener(type, listener);
      listeners.push({ element, type, listener });
    }
  const removals: { name: string; at: number }[] = [];
  let fullFrame: { tDom: number; tRaf: number; tFrame: number } | undefined;
  let cancelWatch = () => {};
  window.__acceptanceCloseReady = new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    let raf: number | undefined;
    let channel: MessageChannel | undefined;
    const cleanup = () => {
      observer.disconnect();
      clearTimeout(timer);
      if (raf !== undefined) cancelAnimationFrame(raf);
      channel?.port1.close();
      channel?.port2.close();
      window.removeEventListener('pagehide', pagehide);
    };
    cancelWatch = cleanup;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const check = () => {
      for (const { name, element } of identities) {
        if (
          !element.isConnected &&
          !removals.some((entry) => entry.name === name)
        )
          removals.push({ name, at: performance.now() });
      }
      if (started || identities.some(({ element }) => element.isConnected))
        return;
      started = true;
      const tDom = performance.now();
      raf = requestAnimationFrame(() => {
        const tRaf = performance.now();
        channel = new MessageChannel();
        channel.port1.addEventListener(
          'message',
          () => {
            if (identities.some(({ element }) => element.isConnected)) {
              fail(
                'An original modal surface reappeared before its exit frame',
              );
              return;
            }
            settled = true;
            fullFrame = { tDom, tRaf, tFrame: performance.now() };
            cleanup();
            resolve({
              ...fullFrame,
              label: 'modal-full-exit',
              source: 'original-content-and-overlay-removal',
            });
          },
          { once: true },
        );
        channel.port1.start();
        channel.port2.postMessage(0);
      });
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(
      () => fail('Full modal exit exceeded120seconds'),
      120_000,
    );
    const pagehide = () => fail('Document replaced before full modal exit');
    window.addEventListener('pagehide', pagehide, { once: true });
    observer.observe(document, { childList: true, subtree: true });
  });
  window.__acceptanceClose = () => {
    cancelWatch();
    for (const { element, type, listener } of listeners)
      element.removeEventListener(type, listener);
    return {
      initial,
      removals,
      fullFrame,
      events,
      overflow,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      final: identities.map(({ name, element }) => ({
        name,
        connected: element.isConnected,
      })),
      limit:
        'DOM unmount/rendering-opportunity and main-thread animation callbacks are separate observations; compositor endpoint remains independent review.',
    };
  };
}

declare global {
  interface Window {
    __acceptanceClose?: () => Record<string, unknown>;
    __acceptanceCloseReady?: Promise<{
      tDom: number;
      tRaf: number;
      tFrame: number;
      label: string;
      source: string;
    }>;
  }
}

/** Main-thread animation events certify only the original nodes. Retain them
 * separately from DOM readiness; compositor endpoints still require review. */
export function checkAcceptanceAnimation(value: unknown, unmountedAt: number) {
  const receipt = value as
    | {
        overflow?: boolean;
        reducedMotion?: boolean;
        events?: Record<string, unknown>[];
        final?: { name: string; connected: boolean }[];
        removals?: { name: string; at: number }[];
      }
    | undefined;
  if (
    !receipt ||
    receipt.overflow !== false ||
    receipt.reducedMotion !== false ||
    !Array.isArray(receipt.events) ||
    !Array.isArray(receipt.final) ||
    !Array.isArray(receipt.removals)
  )
    throw new Error('Missing or bounded-out normal-motion animation evidence');
  if (!Number.isFinite(unmountedAt))
    throw new Error('Missing dialog DOM endpoint');
  for (const name of ['content', 'overlay']) {
    if (
      receipt.final.filter((node) => node.name === name && !node.connected)
        .length !== 1
    )
      throw new Error('Original modal surface remains mounted');
    const removed = receipt.removals.filter((entry) => entry.name === name);
    if (
      removed.length !== 1 ||
      !Number.isFinite(removed[0]!.at) ||
      removed[0]!.at < 0 ||
      removed[0]!.at > unmountedAt
    )
      throw new Error(
        'Full-exit endpoint precedes an original surface removal',
      );
    const events = receipt.events.filter(
      (event) => event.name === name && event.state === 'closed',
    );
    if (events.some((event) => event.type === 'animationcancel'))
      throw new Error('Original exit animation was cancelled');
    const start = events.filter((event) => event.type === 'animationstart');
    const end = events.filter((event) => event.type === 'animationend');
    if (
      start.length !== 1 ||
      end.length !== 1 ||
      !start[0]!.eventAnimationName ||
      start[0]!.eventAnimationName !== end[0]!.eventAnimationName
    )
      throw new Error('Missing unambiguous original exit animation pair');
    if (
      typeof start[0]!.at !== 'number' ||
      typeof end[0]!.at !== 'number' ||
      !Number.isFinite(start[0]!.at) ||
      start[0]!.at < 0 ||
      start[0]!.at > end[0]!.at ||
      !Number.isFinite(end[0]!.at) ||
      end[0]!.at > removed[0]!.at
    )
      throw new Error('Exit animation did not finish before dialog removal');
  }
  return value;
}
