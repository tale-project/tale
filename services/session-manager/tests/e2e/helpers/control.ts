import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

const stateSchema = z.object({
  name: z.string(),
  closed: z.boolean(),
  /** What the fake browser was told: `['mouse', 'down', x, y, 'left', 1]`, `['key', 'down', 'a']`, … */
  events: z.array(z.tuple([z.string()], z.unknown())),
  dialogs: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      message: z.string(),
      default: z.string(),
    }),
  ),
  selection: z.string(),
});
export type BrowserState = z.infer<typeof stateSchema>;

export interface Faults {
  /** The next launches fail with this message (`null`: they work again). */
  launchError?: string | null;
  /** The next identities cannot be drawn (`null`: they can). */
  identityError?: string | null;
  launchDelayMs?: number;
  checkDelayMs?: number;
}

export type ExitIpAnswer =
  | { ip: string; country?: string | null }
  | { error: string };

/**
 * The fake browser and the fake proxy checker behind the server under test,
 * which a spec cannot reach any other way: it makes a page open a dialog, a
 * browser crash, a proxy fail, and reads what the fake browser was told.
 * `controlUrl` is the control server of the worker's own server (the `server`
 * fixture): another worker's fakes are never reachable from here.
 */
export class Control {
  constructor(
    private readonly request: APIRequestContext,
    private readonly controlUrl: string,
  ) {}

  async #call(method: string, path: string, data?: unknown): Promise<unknown> {
    const response = await this.request.fetch(`${this.controlUrl}${path}`, {
      method,
      data,
    });
    if (!response.ok()) {
      throw new Error(
        `${method} ${path} answered ${response.status()}: ${await response.text()}`,
      );
    }
    return response.json();
  }

  /** The latest browser launched for the session named `name`. */
  async browser(name: string): Promise<BrowserState> {
    return stateSchema.parse(
      await this.#call('GET', `/browsers/${encodeURIComponent(name)}`),
    );
  }

  /** The page of the session opens a dialog and waits for the answer. */
  async openDialog(
    name: string,
    dialog: {
      kind?: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
      message?: string;
      defaultValue?: string;
    } = {},
  ): Promise<void> {
    await this.#call(
      'POST',
      `/browsers/${encodeURIComponent(name)}/dialog`,
      dialog,
    );
  }

  /** The page of the session opens a drop-down list with these options. */
  async openSelect(name: string, options?: string[]): Promise<void> {
    await this.#call('POST', `/browsers/${encodeURIComponent(name)}/select`, {
      options,
    });
  }

  /** What the page has selected, as a copy asks for it. */
  async setSelection(name: string, text: string): Promise<void> {
    await this.#call(
      'POST',
      `/browsers/${encodeURIComponent(name)}/selection`,
      { text },
    );
  }

  /** The browser of the session dies, as if its process was killed. */
  async crash(name: string): Promise<void> {
    await this.#call('POST', `/browsers/${encodeURIComponent(name)}/crash`);
  }

  /** The person closes every tab of the session's browser. */
  async closeAllTabs(name: string): Promise<void> {
    await this.#call(
      'POST',
      `/browsers/${encodeURIComponent(name)}/close-tabs`,
    );
  }

  async faults(faults: Faults): Promise<void> {
    await this.#call('PUT', '/faults', faults);
  }

  /** By `host:port`, what the check of a proxy finds out (or why it fails). */
  async exitIps(answers: Record<string, ExitIpAnswer>): Promise<void> {
    await this.#call('PUT', '/exit-ips', answers);
  }

  /** Every fault and every scripted answer withdrawn. */
  async clear(): Promise<void> {
    await this.#call('DELETE', '/state');
  }
}
