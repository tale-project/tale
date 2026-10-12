'use client';

import {
  type EntityRowAction,
  EntityRowActions,
} from '@tale/ui/entity/entity-row-actions';
import { HStack } from '@tale/ui/layout';
import { type RefObject, useRef } from 'react';

/**
 * A row's actions menu in the automation tables (versions, deployments,
 * runs). It owns its button, so an action that answers after the menu has
 * closed — a deploy refused in a dialog — returns focus to the row it was
 * chosen in.
 */
export function RowMenu({
  label,
  actions,
}: {
  /** Names the menu button for the row ("Actions for v3"). */
  label: string;
  actions: (button: RefObject<HTMLButtonElement | null>) => EntityRowAction[];
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    // The menu's clicks stay with the menu: the row itself opens its own
    // page.
    <HStack
      justify="end"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <EntityRowActions
        ariaLabel={label}
        triggerRef={buttonRef}
        actions={actions(buttonRef)}
      />
    </HStack>
  );
}
