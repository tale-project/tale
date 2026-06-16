// Type declarations for @novnc/novnc (v1.7.0 ships untyped ESM).
// The package's `exports` map is a single string (`"./core/rfb.js"`), so the
// ONLY importable specifier is the bare package name `@novnc/novnc`, whose
// default export is the `RFB` client class. These types cover only the small
// RFB surface this project uses (read-only screencast viewer).

declare module '@novnc/novnc' {
  /**
   * Options accepted by the `RFB` constructor. We pass an empty object and set
   * the behavioral knobs as instance properties after construction (the
   * approach noVNC documents for read-only viewers).
   */
  export interface RFBOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  /**
   * The `detail` payload carried by the RFB `CustomEvent`s we listen for.
   * `disconnect` carries `{ clean }`; `securityfailure` carries
   * `{ status, reason }`. All fields are optional so a single typed shape can
   * cover every event without an `any`-typed `detail` (which would force unsafe
   * assertions at the call site).
   */
  export interface RFBEventDetail {
    clean?: boolean;
    status?: number;
    reason?: string;
  }

  /**
   * Minimal `RFB` typing. `RFB` extends an EventTarget mixin, so the DOM
   * `addEventListener` / `removeEventListener` signatures cover event wiring;
   * the `CustomEvent.detail` payloads (`clean`, `status`, `reason`) are read at
   * the call site via `RFBEventDetail`.
   */
  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);

    /** When true, never sends pointer/keyboard input upstream. */
    viewOnly: boolean;
    /** Scale the remote framebuffer to fit the local container. */
    scaleViewport: boolean;
    /** Clip (vs. scrollbar) the remote framebuffer to the container. */
    clipViewport: boolean;
    /** Grab keyboard focus when the canvas is clicked. */
    focusOnClick: boolean;
    /** CSS background painted behind/around the framebuffer. */
    background: string;

    /** Close the connection and tear down the canvas. */
    disconnect(): void;

    addEventListener(
      type: string,
      listener: (event: CustomEvent<RFBEventDetail>) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
      type: string,
      listener: (event: CustomEvent<RFBEventDetail>) => void,
      options?: boolean | EventListenerOptions,
    ): void;
  }
}
