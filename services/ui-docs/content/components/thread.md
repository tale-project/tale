---
title: Conversation thread
description: Show chat turns, task comments and what happened between them in one calm reading column.
---

A conversation thread is how Tale shows a chat and a task's discussion alike: the reader's own words on the right, every other voice on the left under its name, and what happened in between as quiet one-line events. Use the thread pieces for any surface that reads as a conversation, so chats, tasks and the inbox never drift apart.

```tsx
import { ThreadMessage } from '@tale/ui/thread/thread-message';
import { ThreadEvent, ThreadEventGroup, ThreadEventActor } from '@tale/ui/thread/thread-event';
import { ThreadDayDivider } from '@tale/ui/thread/thread-day-divider';
import { ThreadTime } from '@tale/ui/thread/thread-time';
import { ReadMore } from '@tale/ui/read-more';
import { Avatar } from '@tale/ui/avatar';
```

## Read a conversation

<Demo name="thread/basic" />

Press **Read more** under the agent's message to open the rest of it in place, and **3 updates** to see the folded events. The names, times and text are sample content.

## Messages

`ThreadMessage` has two shapes. `variant="own"` is what the reader wrote: a right-aligned muted bubble with its time and actions on a row under it. `variant="other"` is everyone else: flat prose under an identity row with the `avatar`, the `author`, a quiet `badge` such as **Agent**, and the `time`. Set `continuation` for a message by the same author minutes after the one before it with nothing between: it drops the identity row and closes up. `header={null}` hides the identity row altogether, as a chat does for its single assistant.

Pass `actions` as icon buttons, each with its own accessible name. They show on hover, on keyboard focus anywhere in the message, while one of their menus is open, and always on a touch screen. `clampHeight` puts a long body behind **Read more**; the content stays in the DOM, so find-in-page and screen readers keep the full text. On an `own` message, `trailing` takes a control that stays in view at the end of the row under the bubble while the time and actions beside it wait for hover or focus, such as a chat's ‹ 2/3 › branch navigator; give each of its buttons an accessible name too. An `other` message has no such row and ignores it. The root forwards `className`, `ref` and `data-*` attributes, so a list can hang its scroll anchors and `content-visibility` on the row.

## Events

`ThreadEvent` is one `text-xs` line in the avatar gutter: a glyph (`icon`, or `glyph` for a coloured mark such as a status), the sentence, the `time` and an optional `trailing` badge. Write each sentence whole in the reader's language and mark the actor with `ThreadEventActor`; never assemble it from lowercased fragments, which breaks German nouns. `ThreadEventGroup` folds a burst of events into one `summary` line that opens in place, with a thin rule tying the opened lines together.

## Days, times and avatars

`ThreadDayDivider` names the day of the entries that follow it and stays pinned near the top while that day scrolls by; put it first in the element holding the day's entries, and `groupByDay` splits a list into days. Under a divider, `ThreadTime` shows the clock time with the full date on hover; use `format="relative"` where nothing names the day.

`Avatar` draws a person's initials on a tint chosen from the name, or a glyph for an agent, an automation or the system, in four sizes. Give it `label` when it stands for someone on its own; beside a visible name it is decorative.
