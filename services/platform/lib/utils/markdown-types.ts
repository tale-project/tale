import type { ComponentType } from 'react';

// oxlint-disable-next-line typescript/no-explicit-any -- Required by react-markdown's Components interface which uses ComponentType<any>
export type MarkdownComponentType = ComponentType<any>;

export type MarkdownComponentMap = Record<string, MarkdownComponentType>;
