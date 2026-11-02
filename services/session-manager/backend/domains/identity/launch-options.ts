import type { LaunchOptions } from 'camoufox-js';

import type { Identity } from './types.ts';

/**
 * The `camoufox-js` launch options that reproduce an identity: the fingerprint
 * it was drawn with, and the values Camoufox would draw at random on every
 * launch, pinned.
 *
 * `launchOptions` changes the objects it is given, so every call gets copies.
 */
export function identityLaunchOptions(identity: Identity): LaunchOptions {
  const [maxWidth, maxHeight] = identity.maxScreen;
  return {
    fingerprint: structuredClone(identity.fingerprint),
    os: identity.os,
    // Without the bound a launch shrinks the screen to the current display,
    // which also re-seeds fonts, WebGL and the audio seed.
    screen: { maxWidth, maxHeight },
    webgl_config: [...identity.webgl],
    // The caller's config wins over what Camoufox would draw.
    config: { ...identity.pinned },
    // Silences the warning about passing a fingerprint back in.
    i_know_what_im_doing: true,
    // Without it the language is drawn again on every launch.
    ...(identity.locale ? { locale: identity.locale } : {}),
  };
}
