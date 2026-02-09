interface ServiceWorkerMessageEvent extends ExtendableMessageEvent {
  data: {
    type: 'SKIP_WAITING' | 'CACHE_URLS' | 'CLEAR_CACHE';
    urls?: string[];
  };
}

interface Navigator {
  connection?: NetworkInformation;
  mozConnection?: NetworkInformation;
  webkitConnection?: NetworkInformation;
}

interface NetworkInformation extends EventTarget {
  downlink?: number;
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  rtt?: number;
  saveData?: boolean;
  addEventListener(
    type: 'change',
    listener: (this: NetworkInformation, ev: Event) => void,
  ): void;
  removeEventListener(
    type: 'change',
    listener: (this: NetworkInformation, ev: Event) => void,
  ): void;
}

interface SyncEvent extends ExtendableEvent {
  readonly lastChance: boolean;
  readonly tag: string;
}

interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
  addEventListener(
    type: 'sync',
    listener: (this: ServiceWorkerGlobalScope, ev: SyncEvent) => void,
  ): void;
  addEventListener(
    type: 'message',
    listener: (
      this: ServiceWorkerGlobalScope,
      ev: ServiceWorkerMessageEvent,
    ) => void,
  ): void;
}

interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

interface ServiceWorkerRegistration {
  readonly sync: SyncManager;
}
