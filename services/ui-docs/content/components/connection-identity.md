---
title: Connection identity
description: Show who is asking to connect to what, as two marks joined by a dashed line, named for assistive technology by one sentence.
---

`ConnectionIdentity` is the picture at the top of a screen where an app asks to connect to Tale: the app's mark, a dashed line with a link glyph, and Tale's mark. It tells at a glance which two things are being joined. Use it on a sign-in or consent screen, and anywhere else a vendor and Tale are connected, such as a connector's authorization step.

```tsx
import { ConnectionIdentity } from '@tale/ui/connection-identity';
```

## Join two marks

<Demo name="connection-identity/basic" />

Pass the two marks as `from` and `to`, and a `label` that says the picture in words, such as "Claude Code connecting to Tale". A mark can be any node: a vendor icon, a letter, an avatar. Icons are drawn at 24 px inside a 40 px tile, so a lucide icon and a brand mark sit the same way. The whole picture is 128 px wide and centred in the space you give it; put it in your own layout and set `className` for the spacing around it.

| Prop    | Type        | Purpose                                                       |
| ------- | ----------- | ------------------------------------------------------------- |
| `from`  | `ReactNode` | The mark on the left: the app asking to connect.              |
| `to`    | `ReactNode` | The mark on the right: what it connects to.                   |
| `label` | `string`    | What the picture says, in words, as its accessible name.      |

## Show only what you can vouch for

A brand mark tells the reader who the app is, so show one only when your app has verified it, such as a client whose identity was proved by its own domain. For an app you cannot verify, show a neutral glyph like the bot in the last example. The picture is a claim, and a mark the app chose for itself is the easiest thing to fake. Never load an image from the app's own metadata.

## Motion

The dashed line draws from the first mark to the second once, when the picture appears, over the slow duration of the motion scale. Under `prefers-reduced-motion: reduce` it is already drawn. Nothing else moves.

## Accessibility

The picture is one image: `role="img"` named by `label`, so a screen reader says the sentence and skips the marks and the line. Because the marks are hidden from assistive technology, never rely on them alone to say who is connecting; the text around the picture, such as the page title and the app's name, must say it too. In forced-colours modes the tiles, the line and the glyph keep their borders and draw in system colours.
