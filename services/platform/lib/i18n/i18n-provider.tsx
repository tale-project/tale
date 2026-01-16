'use client';

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type { Messages, Namespace } from './types';

interface I18nContextValue {
  messages: Messages;
  locale: string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  children: ReactNode;
  messages: Messages;
  locale: string;
}

export function I18nProvider({ children, messages, locale }: I18nProviderProps) {
  return (
    <I18nContext.Provider value={{ messages, locale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18nContext() {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error('useI18nContext must be used within an I18nProvider');
  }
  return context;
}

type NestedKeyOf<T, Prefix extends string = ''> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? NestedKeyOf<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>
          : Prefix extends ''
          ? K
          : `${Prefix}.${K}`
        : never;
    }[keyof T]
  : never;

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split('.');
  let result: unknown = obj;
  for (const key of keys) {
    if (result && typeof result === 'object' && key in result) {
      result = (result as Record<string, unknown>)[key];
    } else {
      return path;
    }
  }
  return typeof result === 'string' ? result : path;
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

type TranslationFunction<N extends Namespace> = {
  (key: string, params?: Record<string, unknown>): string;
  raw: (key: string) => unknown;
};

export function createTranslationFunction<N extends Namespace>(
  messages: Messages,
  namespace: N,
): TranslationFunction<N> {
  const namespaceMessages = messages[namespace] as Record<string, unknown>;

  const t = (key: string, params?: Record<string, unknown>): string => {
    const value = getNestedValue(namespaceMessages, key);
    return interpolate(value, params);
  };

  t.raw = (key: string): unknown => {
    const keys = key.split('.');
    let result: unknown = namespaceMessages;
    for (const k of keys) {
      if (result && typeof result === 'object' && k in result) {
        result = (result as Record<string, unknown>)[k];
      } else {
        return undefined;
      }
    }
    return result;
  };

  return t;
}
