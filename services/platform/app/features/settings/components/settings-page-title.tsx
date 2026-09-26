'use client';

import { createContext, useContext } from 'react';

/**
 * The open settings page's own name — the label its header already shows
 * ("Teams", or "Budgets" under "Governance · Budgets"). A section titled the
 * same keeps that heading for assistive tech but does not print it a second
 * time under the header.
 */
const SettingsPageTitleContext = createContext<string | undefined>(undefined);

export const SettingsPageTitleProvider = SettingsPageTitleContext.Provider;

export function useSettingsPageTitle(): string | undefined {
  return useContext(SettingsPageTitleContext);
}
