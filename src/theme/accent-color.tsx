'use client';

import { createContext, useContext, type ReactNode } from 'react';

const AccentColorContext = createContext<string | undefined>(undefined);
AccentColorContext.displayName = 'AccentColorContext';

/**
 * A host-supplied accent (an organization's brand colour) that tinted
 * components — the active tab indicator, the active sub-panel row — pick up
 * instead of the neutral default. Leave it unmounted for the plain design
 * system; the platform mounts it from its branding provider.
 */
export function AccentColorProvider({
  accentColor,
  children,
}: {
  accentColor?: string;
  children: ReactNode;
}) {
  return (
    <AccentColorContext.Provider value={accentColor}>
      {children}
    </AccentColorContext.Provider>
  );
}

/** The host accent colour, or `undefined` when the surface is unbranded. */
export function useAccentColor(): string | undefined {
  return useContext(AccentColorContext);
}
