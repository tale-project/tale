/**
 * `branding` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../branding.ts` are what
 * actually serve them.
 */

/**
 * The branding versions an image write moved between: the `hash` it left and
 * the `previousHash` it found (`null` when there was no branding file).
 */
export interface BrandingWriteVersions {
  hash: string;
  previousHash: string | null;
}

export interface BrandingContract {
  'branding/file_actions:deleteImage': {
    kind: 'action';
    args: { organizationId: string; type: string };
    returns: BrandingWriteVersions;
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
      /** The branding version the save was made from; a save whose version
       * is no longer current is refused (`CONFIG_VERSION_CONFLICT`). */
      expectedHash?: string;
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
      /** As for `saveBranding`: the image is stored only while the branding
       * is still this version. */
      expectedHash?: string;
    };
    returns: { filename: string } & BrandingWriteVersions;
  };
  'branding/file_actions:snapshotToHistory': {
    kind: 'action';
    args: { organizationId: string };
    returns: null | { timestamp: string };
  };
}
