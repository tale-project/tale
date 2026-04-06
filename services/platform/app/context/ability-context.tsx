'use client';

import { createContext } from 'react';

import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const AbilityContext = createContext<AppAbility>(
  defineAbilityFor('disabled'),
);

/** Whether the role query is still loading (ability may not reflect the real role yet). */
export const AbilityLoadingContext = createContext<boolean>(true);
