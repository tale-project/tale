import { Row } from '@tale/ui/layout';
import { SkeletonBox, SkeletonCircle, SkeletonText } from '@tale/ui/skeleton';

import { CHAT_COMPOSER_FRAME_CLASS } from '@/app/features/chat/lib/layout';

/**
 * The reply box wears the chat composer's frame — the same border, radius,
 * lift and inset — so writing to a customer, to the assistant or on a task
 * looks like one composer. Only the bottom inset is its own: the action row
 * below the editor carries its buttons.
 */
export const MESSAGE_EDITOR_FRAME_CLASS = `${CHAT_COMPOSER_FRAME_CLASS} pb-2 sm:pb-3`;

/** The empty editor's field and action row, shared by chunk and data loading. */
export function MessageEditorPlaceholder() {
  return (
    <div className={MESSAGE_EDITOR_FRAME_CLASS}>
      <div className="h-[5rem] text-sm leading-normal">
        <SkeletonText lines={3} />
      </div>
      <Row justify="between" className="pt-1">
        <Row gap={2}>
          {[0, 1].map((index) => (
            <SkeletonBox key={index} asChild>
              <div className="size-9 rounded-lg" />
            </SkeletonBox>
          ))}
        </Row>
        <SkeletonCircle asChild>
          <div className="size-9 rounded-full" />
        </SkeletonCircle>
      </Row>
    </div>
  );
}
