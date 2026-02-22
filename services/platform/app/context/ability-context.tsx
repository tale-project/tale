'use client';

import { createContext } from 'react';

import { defineAbilityFor, type AppAbility } from '@/lib/permissions/ability';

export const AbilityContext = createContext<AppAbility>(defineAbilityFor(null));
