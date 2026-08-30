/**
 * `branding` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../branding.ts` are what
 * actually serve them.
 */

export interface BrandingContract {
  'branding/file_actions:deleteImage': {
    kind: 'action';
    args: { organizationId: string; type: string };
    returns: null;
  };
  'branding/file_actions:readBranding': {
    kind: 'action';
    args: { organizationId?: string };
    returns: {
      appName?: string;
      accentColor?: string;
      logoUrl: null | string;
      faviconLightUrl: null | string;
      faviconDarkUrl: null | string;
      logoFilename?: string;
      faviconLightFilename?: string;
      faviconDarkFilename?: string;
      hash: string;
    };
  };
  'branding/file_actions:saveBranding': {
    kind: 'action';
    args: {
      config: {
        accentColor?: string;
        logoFilename?: string;
        faviconLightFilename?: string;
        faviconDarkFilename?: string;
      };
      organizationId: string;
    };
    returns: { hash: string };
  };
  'branding/file_actions:saveImage': {
    kind: 'action';
    args: {
      organizationId: string;
      type: string;
      mimeType: string;
      base64: string;
    };
    returns: { filename: string };
  };
  'branding/file_actions:snapshotToHistory': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | { timestamp: string };
  };
}
