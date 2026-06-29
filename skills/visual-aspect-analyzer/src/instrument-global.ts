// Browser entry point: `buildInstrumentBundle()` (Bun, in memory) bundles this
// to an IIFE and the driver injects it. Because the driver injects via
// `addInitScript`, this module's top-level code runs BEFORE the page's own
// scripts — so it patches `addEventListener` here to capture the page's
// interaction listeners (the "event boundary" signal `select.ts` reads), then
// pins the installer on `globalThis` for the driver's bootstrap to call.

import { installVisualAspectInstrument } from './instrument';
import { installListenerRegistry } from './listeners';

if (typeof EventTarget !== 'undefined') {
  try {
    const { registry } = installListenerRegistry(EventTarget.prototype);
    Reflect.set(globalThis, '__VA_LISTENERS', registry);
  } catch (err) {
    console.warn('[va] could not install listener registry', err);
  }
}

Reflect.set(
  globalThis,
  'installVisualAspectInstrument',
  installVisualAspectInstrument,
);
