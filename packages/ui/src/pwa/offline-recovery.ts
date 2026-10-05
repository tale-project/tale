/**
 * Serialized by the PWA build into a precached script. Keep this function
 * self-contained: it also runs without React, translations or a live server.
 */
export function installOfflineRecovery(
  reload: (target: URL) => void = (target) => {
    if (location.pathname.endsWith('/offline.html'))
      location.replace(target.href);
    else location.reload();
  },
): () => void {
  const status = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const retry = document.getElementById('retry-button');
  const heading = document.getElementById('offline-title');
  const description = document.getElementById('offline-description');
  if (
    !(retry instanceof HTMLButtonElement) ||
    !status ||
    !statusText ||
    !heading ||
    !description
  )
    return () => {};

  const translations = {
    en: {
      device: "You're offline",
      backend: "Can't reach Tale",
      description: "We'll reconnect when Tale is available again.",
      offline: 'Waiting for a connection',
      checking: 'Checking connection…',
      online: 'Back online',
      retry: 'Try again',
    },
    de: {
      device: 'Du bist offline',
      backend: 'Tale ist nicht erreichbar',
      description:
        'Sobald Tale wieder erreichbar ist, verbinden wir dich erneut.',
      offline: 'Warten auf eine Verbindung',
      checking: 'Verbindung wird geprüft…',
      online: 'Wieder verbunden',
      retry: 'Erneut versuchen',
    },
    fr: {
      device: 'Tu es hors ligne',
      backend: 'Tale est inaccessible',
      description:
        'La connexion reprendra dès que Tale sera à nouveau disponible.',
      offline: 'En attente de connexion',
      checking: 'Vérification de la connexion…',
      online: 'Connexion rétablie',
      retry: 'Réessayer',
    },
  };
  const routeLocale = /^\/(?:[^/]+\/)?(en|de|fr)(?:\/|$)/.exec(
    location.pathname,
  )?.[1];
  const locale = routeLocale ?? navigator.language.split('-')[0];
  const labels =
    translations[locale === 'de' || locale === 'fr' ? locale : 'en'];
  document.documentElement.lang =
    locale === 'de' || locale === 'fr' ? locale : 'en';
  description.textContent = labels.description;
  retry.textContent = labels.retry;

  const scriptUrl = navigator.serviceWorker?.controller?.scriptURL;
  const scope = new URL('./', scriptUrl ?? location.href);
  const recoveryDocument = new URL(location.href);
  if (recoveryDocument.pathname.endsWith('/offline.html'))
    recoveryDocument.pathname = scope.pathname;
  const healthPath = document.body.dataset.healthProbe;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let probing = false;
  let stopped = false;

  const setState = (state: 'offline' | 'checking' | 'online'): void => {
    heading.textContent = navigator.onLine ? labels.backend : labels.device;
    document.title = heading.textContent;
    statusText.textContent = labels[state];
    status.classList.toggle('online', state === 'online');
  };

  async function probe(): Promise<boolean> {
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8_000);
    try {
      const documentUrl = new URL(recoveryDocument);
      const url = healthPath ? new URL(healthPath, scope) : documentUrl;
      url.searchParams.set('pwa-probe', String(Date.now()));
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: healthPath ? 'error' : 'follow',
        signal: controller.signal,
      });
      if (response.status !== 200) {
        void response.body?.cancel();
        return false;
      }
      if (healthPath) {
        const body: unknown = await response.json();
        const ready =
          body !== null &&
          typeof body === 'object' &&
          'ok' in body &&
          body.ok === true &&
          'service' in body &&
          body.service === 'backend';
        if (!ready) return false;
        // The API can be healthy while the web tier is still unavailable.
        // Verify the document too before navigating away from this shell.
        documentUrl.searchParams.set('pwa-probe', String(Date.now()));
        const documentResponse = await fetch(documentUrl, {
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'follow',
          signal: controller.signal,
        });
        const readyDocument =
          documentResponse.status === 200 &&
          documentResponse.headers
            .get('content-type')
            ?.includes('text/html') === true;
        if (readyDocument) await documentResponse.arrayBuffer();
        else void documentResponse.body?.cancel();
        return readyDocument;
      }
      const html =
        response.headers.get('content-type')?.includes('text/html') === true;
      if (html) await response.arrayBuffer();
      else void response.body?.cancel();
      return html;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      controller = undefined;
    }
  }

  const reconnect = async (): Promise<void> => {
    if (probing || stopped) return;
    clearTimeout(timer);
    probing = true;
    retry.setAttribute('disabled', '');
    setState('checking');
    const ready = await probe();
    if (stopped) return;
    if (ready) {
      stopped = true;
      setState('online');
      timer = setTimeout(() => reload(recoveryDocument), 400);
      return;
    }
    probing = false;
    retry.removeAttribute('disabled');
    setState('offline');
    timer = setTimeout(() => void reconnect(), 5_000);
  };

  const wake = (): void => {
    void reconnect();
  };
  const visible = (): void => {
    if (document.visibilityState === 'visible') wake();
  };
  const offline = (): void => {
    if (!probing) setState('offline');
  };
  retry.addEventListener('click', wake);
  window.addEventListener('online', wake);
  window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', visible);
  setState('offline');
  wake();

  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    retry.removeEventListener('click', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', offline);
    document.removeEventListener('visibilitychange', visible);
  };
}
