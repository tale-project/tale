import type { Page, WebSocketRoute } from '@playwright/test';

/** The live view's socket, whatever the session. */
const LIVE_VIEW = /\/api\/sessions\/\d+\/stream$/;

/**
 * What the next socket the page opens to a live view meets:
 * - `through`: the server, which answers as it does for any page;
 * - `silent`: nothing answers, so the page stays "connecting" for good, as when the server is slow;
 * - `closed`: the socket is closed at once, as when the network is down.
 */
export type SocketMode = 'through' | 'silent' | 'closed';

export interface ViewerSockets {
  /** Read when the page opens a socket: set it before the page that opens it. */
  mode: SocketMode;
  /**
   * The network goes: the sockets that reach the server are closed from both
   * ends, and every one the page opens after that is closed at once.
   */
  cut: () => Promise<void>;
}

/** Puts the live view's sockets of the page in the hands of the spec; they reach the server until it says otherwise. */
export async function controlViewerSockets(page: Page): Promise<ViewerSockets> {
  const links: Array<{ page: WebSocketRoute; server: WebSocketRoute }> = [];
  const sockets: ViewerSockets = {
    mode: 'through',
    cut: async () => {
      sockets.mode = 'closed';
      for (const link of links.splice(0)) {
        await link.page.close();
        await link.server.close();
      }
    },
  };
  await page.routeWebSocket(LIVE_VIEW, (route) => {
    switch (sockets.mode) {
      case 'through':
        links.push({ page: route, server: route.connectToServer() });
        return;
      case 'closed':
        void route.close();
        return;
      case 'silent':
        return;
    }
  });
  return sockets;
}
