# Tale Dashboard — Design System Documentation

> Dev handoff reference for the Tale Dashboard design file (`tale-dashboard`).
> All component IDs reference nodes in the `.pen` design file.

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Theme & Variables](#theme--variables)
3. [Components](#components)
4. [Screens](#screens)
5. [Interaction Behaviors](#interaction-behaviors)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Dev Notes](#dev-notes)

---

## Project Structure

The design file is organized into three top-level container frames on the canvas, each grouping related nodes. Within each container, nodes use a path-style naming convention that maps directly to a React frontend export structure.

### Canvas Organization

| Container Frame | ID | Contents |
|----------------|-----|----------|
| `--- Components ---` | `LFO5t` | All reusable UI components (buttons, inputs, icons, toasts, tooltips, chat input, image/doc previews, rich text, etc.) |
| `--- Pages/Auth ---` | `IDh7b` | Authentication screens (SignUp, SignIn, UpdatePassword) — light on top row, dark on bottom row |
| `--- Pages/Chat ---` | `gz7c1` | All chat screens (48+ screens) — light on top row, dark on bottom row, arranged chronologically by feature |
| `--- Pages/Conversations ---` | `tnsiL` | Conversations/inbox screens — light on top row, dark on bottom row |

### Naming Convention

All nodes use a path-style prefix:
- **`Pages/[Section]/[ScreenName]`** — Full-page screens
- **`Components/[Category]/[Name]`** — Reusable UI components

Dark mode variants are suffixed with `-Dark`. State variants use descriptive suffixes (e.g., `-Hover`, `-Active`, `-Disabled`, `-Error`).

### Export Structure

```
src/
├── components/
│   ├── Button/
│   │   ├── Primary.tsx          (Components/Button/Primary)
│   │   └── Microsoft.tsx        (Components/Button/Microsoft)
│   ├── Input/
│   │   ├── Text.tsx             (Components/Input/Text)
│   │   ├── Password.tsx         (Components/Input/Password)
│   │   ├── TextArea.tsx         (Components/Input/TextArea)
│   │   └── Dropdown.tsx         (Components/Input/Dropdown)
│   ├── Icon/
│   │   └── [Eye, EyeOff, Check, Minus, CircleX, CircleCheck, Info, TriangleAlert].tsx
│   ├── Toast.tsx                (Components/Toast)
│   ├── Tooltip.tsx              (Components/Tooltip)
│   ├── ChatInput.tsx            (Components/ChatInput)
│   ├── ScrollButton.tsx         (Components/ScrollButton)
│   ├── InfoPopover.tsx          (Components/InfoPopover)
│   ├── Logo.tsx                 (Components/Logo)
│   ├── Tab.tsx                  (Components/Tab)
│   ├── Checkbox.tsx             (Components/Checkbox)
│   ├── ModalOverlay.tsx         (Components/ModalOverlay)
│   ├── ImagePreview/
│   │   └── [Loading, Default, Hover].tsx
│   ├── DocPreview/
│   │   └── [Loading, Default, Hover].tsx
│   └── RichText/
│       ├── Heading[1-4].tsx
│       ├── ItalicText.tsx
│       ├── OrderedList.tsx
│       ├── UnorderedList.tsx
│       ├── Blockquote.tsx
│       └── CodeBlock.tsx
├── pages/
│   ├── Auth/
│   │   ├── SignUp.tsx           (Pages/Auth/SignUp)
│   │   ├── SignIn.tsx           (Pages/Auth/SignIn)
│   │   └── UpdatePassword.tsx   (Pages/Auth/UpdatePassword)
│   ├── Chat/
│   │   ├── Default.tsx          (Pages/Chat/Default)
│   │   ├── Conversation.tsx     (Pages/Chat/Conversation)
│   │   └── ...                  (all Chat/* screen variants)
│   └── Conversations/
│       └── EmptyState.tsx       (Pages/Conversations/EmptyState)
└── tokens/
    └── design-tokens.ts         (see Theme & Variables section)
```

### Design Tokens File

Variables and themes from the `.pen` file should be exported as:
- **CSS custom properties** for runtime theming (light/dark switch)
- **TypeScript constants** for spacing, radii, typography scales

See [Theme & Variables](#theme--variables) for the full token reference.

---

## Theme & Variables

The design supports **light** and **dark** modes via a `mode` theme axis.

### Semantic Tokens (Themed)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `bg-color` | `#FFFFFF` | `#0C1017` | Page/app background |
| `surface-primary` | `#FFFFFF` | `#030712` | Cards, modals, panels |
| `surface-secondary` | `#FFFFFF` | `#1F2937` | Secondary surfaces |
| `surface-hover` | `#F9FAFB` | `#111827` | Hover state backgrounds |
| `surface-disabled` | `#F9FAFB` | `#1F2937` | Disabled surface fills |
| `border-primary` | `#E5E7EB` | `#4B5563` | Default borders |
| `border-hover` | `#D1D5DB` | `#4B5563` | Hover state borders |
| `border-focus` | `#056CFF` | `#5098FF` | Focus ring color |
| `border-error` | `#DC2626` | `#F87171` | Error state borders |
| `border-disabled` | `#D1D5DB` | `#374151` | Disabled borders |
| `text-primary` | `#030712` | `#FFFFFF` | Primary text |
| `text-secondary` | `#374151` | `#D1D5DB` | Secondary text |
| `text-tertiary` | `#6B7280` | `#9CA3AF` | Tertiary/muted text |
| `text-disabled` | `#9CA3AF` | `#4B5563` | Disabled text |
| `text-error` | `#DC2626` | `#F87171` | Error text |
| `button-primary-bg` | `#030712` | `#FFFFFF` | Primary button fill |
| `button-primary-text` | `#FFFFFF` | `#030712` | Primary button text |
| `icon-primary` | `#374151` | `#D1D5DB` | Default icon color |
| `icon-success` | `#057747` | `#12B76A` | Success icon color |
| `logo-color` | `#060809` | `#FFFFFF` | Logo fill |
| `tooltip-bg` | `#030712` | `#F9FAFB` | Tooltip background |
| `tooltip-text` | `#FFFFFF` | `#030712` | Tooltip text |
| `overlay-bg` | `#00000066` | `#030712CC` | Modal overlay background (40% light / 80% dark) |

### Color Scales (Static)

| Scale | Range | Example |
|-------|-------|---------|
| `gray-*` | 25, 50, 100–950 | `gray-100`: `#F3F4F6`, `gray-900`: `#111827` |
| `primary-*` | 25, 50, 100–950 | `primary-500`: `#056CFF` |
| `error-*` | 25, 50, 100–950 | `error-500`: `#EF4444` |
| `success-*` | 25, 50, 100–950 | `success-500`: `#12B76A` |
| `warning-*` | 25, 50, 100–950 | `warning-500`: `#F79009` |
| `info-*` | 25, 50, 100–950 | `info-500`: `#3B82F6` |

### Spacing

| Token | Value |
|-------|-------|
| `spacing-2xs` | 4px |
| `spacing-4xs` | 6px |
| `spacing-xs` | 8px |
| `spacing-sm` | 12px |
| `spacing-md` | 16px |
| `spacing-md-plus` | 20px |
| `spacing-lg` | 24px |
| `spacing-xl` | 32px |
| `spacing-2xl` | 40px |
| `spacing-3xl` | 48px |
| `spacing-4xl` | 64px |
| `spacing-5xl` | 80px |
| `spacing-6xl` | 96px |
| `spacing-7xl` | 120px |

### Border Radius

| Token | Value |
|-------|-------|
| `radii-none` | 0 |
| `radii-xs` | 2px |
| `radii-sm` | 4px |
| `radii-md` | 8px |
| `radii-lg` | 12px |
| `radii-xl` | 16px |
| `radii-2xl` | 24px |
| `radii-3xl` | 32px |
| `radii-full` | 9999px |

### Typography

| Token | Value |
|-------|-------|
| Font Family | Inter |
| `font-size-0` | 60px |
| `font-size-1` | 48px |
| `font-size-2` | 36px |
| `font-size-3` | 32px |
| `font-size-4` | 24px |
| `font-size-5` | 20px |
| `font-size-6` | 18px |
| `font-size-7` | 16px |
| `font-size-8` | 14px |
| `font-size-9` | 12px |
| `font-weight-regular` | 400 |
| `font-weight-medium` | 500 |
| `font-weight-semi-bold` | 600 |

### Icon Sizes

| Token | Value |
|-------|-------|
| `icon-xs` | 12px |
| `icon-sm` | 16px |
| `icon-md` | 20px |
| `icon-lg` | 24px |
| `icon-xl` | 32px |

---

## Components

All icons throughout the project use the **Lucide** icon font.

### Logo

| | |
|---|---|
| **ID** | `FN6Oy` |
| **Size** | 73.65 x 20 |
| **Fill** | `$logo-color` (themed) |

---

### Button / Primary

| | |
|---|---|
| **ID** | `vxV71` |
| **Size** | 352 x auto |
| **Corner Radius** | 8px |
| **Fill** | `$button-primary-bg` + white gradient overlay |
| **Text** | `$button-primary-text`, Inter 14px medium |
| **Shadow** | `$button-primary-bg` outer shadow (spread 1 + blur 2) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `vxV71` | Base component — themed (dark on light, white on dark) |
| Hover | `5p4JU` | Same themed fill + gradient overlay |
| Disabled | `sHzWt` | 50% opacity, no shadow |

---

### Button / Microsoft

| | |
|---|---|
| **ID** | `Hyrof` |
| **Size** | 352 x 40 |
| **Corner Radius** | 8px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px |
| **Content** | Microsoft 4-color icon + "Continue with Microsoft" label |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `Hyrof` | Base component |
| Hover | `BhJOW` | Fill: `$surface-hover`, border: `$border-hover` |

---

### Input / Text

| | |
|---|---|
| **ID** | `cmk07` |
| **Width** | 352px |
| **Structure** | Label (`KlwOn`) + Input container (`Us9w9`) with placeholder (`ieJix`) + Error message (`BDINh`, hidden) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `cmk07` | Placeholder text, `$border-primary` |
| Hover | `ftNNP` | Border: `$border-hover` |
| Active/Focus | `Ta6OY` | Border: `$border-focus` 1.5px outside, blue glow shadow, typed text |
| Disabled | `xZ0I9` | Fill: `$surface-disabled`, border: `$border-disabled`, text: `$text-disabled` |
| Error | `nwWno` | Border: `$border-error`, error message visible |

---

### Input / Password

| | |
|---|---|
| **ID** | `vq37Q` |
| **Width** | 352px |
| **Structure** | Label (`hFsyo`) + Input container (`OszHr`) with placeholder (`QEv8h`) + Eye toggle icon + Error message (`YOBL2`, hidden) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `vq37Q` | Same pattern as Text input |
| Hover | `cpI64` | Border: `$border-hover` |
| Active/Focus | `7cOnX` | Blue focus ring, masked dots |
| Disabled | `D2Pmf` | Disabled styling |
| Error | `UErQs` | Red border, error message visible |

---

### Input / TextArea

| | |
|---|---|
| **ID** | `MMD6s` |
| **Width** | 352px |
| **Structure** | Label (`dIoWi`) + TextArea container (`ecABj`) with placeholder (`RleZu`) + Error message (`FdV8J`, hidden) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `MMD6s` | Base component |
| Hover | `5G04n` | Border: `$border-hover` |
| Active/Focus | `t0lWz` | Blue focus ring, typed text |
| Disabled | `UF2Xa` | Disabled styling |
| Error | `p0kkq` | Red border, error message visible |

---

### Input / Dropdown

| | |
|---|---|
| **ID** | `CXIFf` |
| **Width** | 352px |
| **Structure** | Label (`gs6o2`) + Dropdown container (`G5R9i`) with placeholder (`1XQGz`) + chevron icon + Error message (`OXKYb`, hidden) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `CXIFf` | Base component |
| Hover | `WgUNB` | Border: `$border-hover` |
| Active/Focus | `UsTdD` | Blue focus ring, selected option shown |
| Disabled | `r3Tjh` | Disabled styling |
| Error | `hjANT` | Red border, error message visible |

---

### Icons

All icons use **Lucide** (`iconFontFamily: "lucide"`).

| Component | ID | Icon Name | Fill | Size |
|-----------|-----|-----------|------|------|
| Icon/Eye | `6E3og` | `eye` | `$icon-primary` | 16x16 |
| Icon/EyeOff | `BsNSc` | `eye-off` | `$icon-primary` | 16x16 |
| Icon/Check | `sdeEz` | `check` | `$icon-success` | 12x12 |
| Icon/Minus | `JwdkS` | `minus` | `$text-tertiary` | 12x12 |
| Icon/CircleX | `vyjdA` | `circle-x` | `$text-error` | 20x20 |
| Icon/CircleCheck | `znmwU` | `circle-check` | `$icon-success` | 20x20 |
| Icon/Info | `qjr3Z` | `info` | `$primary-500` | 20x20 |
| Icon/TriangleAlert | `u8St1` | `triangle-alert` | `$warning-500` | 20x20 |

---

### Toast

| | |
|---|---|
| **ID** | `ACtGC` |
| **Width** | 340px |
| **Corner Radius** | 12px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px |
| **Shadow** | Soft double shadow (`blur: 24, #0000000f` + `blur: 8, #0000000a`) |
| **Structure** | Icon (`ep12k`) + Title (`QL6Rt`) + Description (`OiTFB`, hidden by default) + Close button (`Ri021`) |

#### With Description

| Variant | ID | Icon | Title | Description |
|---------|-----|------|-------|-------------|
| Error | `JY8cD` | CircleX | "Something went wrong" | "Please try again later." |
| Success | `OzPwb` | CircleCheck | "Account created" | "Welcome aboard!" |
| Info | `FL3pC` | Info | "Syncing data" | "Data synchronization will begin shortly." |
| Warning | `R348Y` | TriangleAlert | "Session expiring" | "Your session will expire in 5 minutes." |

#### Title Only (no description)

| Variant | ID | Icon | Title |
|---------|-----|------|-------|
| Error | `WBB2a` | CircleX | "Something went wrong" |
| Success | `4WPRd` | CircleCheck | "Account created" |
| Info | `8TJzP` | Info | "Syncing data" |
| Warning | `1h6CW` | TriangleAlert | "Session expiring" |

**Behavior:**
- Default duration: **5 seconds** then auto-dismiss
- Error toasts: **persist until dismissed** by user (X button)
- Dismiss animation: fade out + slide up

---

### Tooltip

| | |
|---|---|
| **ID** | `bBmqY` |
| **Fill** | `$tooltip-bg` |
| **Text** | `$tooltip-text`, Inter 12px |
| **Corner Radius** | 6px |
| **Structure** | Body (`ItRsM`) containing content text (`GEm0Y`) + optional shortcut badge (`7TcCQ`, hidden) + Arrow (`Wfv0S`) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default (arrow down) | `bBmqY` | Arrow below body |
| No Arrow | `O5q8w` | Arrow disabled |
| Bottom (arrow up) | `ZLBoY` | Standalone frame, arrow on top |
| Left (arrow right) | `CH3Pi` | Horizontal layout, arrow 6x12 |
| Right (arrow left) | `eoGs2` | Horizontal layout, arrow 6x12 |
| With Shortcut | `tqnSb` | Shortcut badge enabled, shows keyboard shortcut |

**Shortcut badge:** `7TcCQ` — gray-700 fill, 4px radius, contains `kbd` text (`riNtS`) in gray-400. Hidden by default, enable via `descendants: {"7TcCQ": {"enabled": true}, "riNtS": {"content": "⌘K"}}`.

**Behavior:**
- Tooltips appear **on hover only**, not on click
- Hidden by default (`enabled: false`)
- **Arrow is disabled on the base component** — all tooltip instances render as no-arrow by default (single-line pill style)
- Reply and Forward action buttons in the detail header have tooltips (hidden by default, `enabled: false`)
- All "Attach files" and "Improve with AI" tooltips across Conversations screens now use `ref: "p6YFG"` component instances (previously inline frames)

---

### Modal Overlay

| | |
|---|---|
| **ID** | `TNz4n` |
| **Fill** | `$overlay-bg` (themed: `#00000066` light / `#030712CC` dark) |
| **Effect** | `background_blur`, radius 8 |
| **Layout** | `none` (absolute positioning for dialog) |
| **Size** | Typically 1232x720 (Conversations, covers main content) or 1280x720 (Chat, covers full screen) |
| **Structure** | DialogSlot (`CSZ5O`, slot frame, layout: vertical, gap: 16, padding: 24, cornerRadius: 12) containing: Header frame (`M4krg`, horizontal, space_between) with Title text (`gmZvb`, 16px semibold) + CloseButton frame (`KyIH9`, 28x28, cornerRadius: 6) with X icon, Description text (`pCn9D`, 14px, lineHeight 1.5, fixed-width), Actions frame (`IHpTr`) with Cancel button (`Vrufi` + `tQA8s`) and Confirm button (`04phX` + `RgYEP`) |

**Usage:** Used for all confirmation dialogs and view modals across Chat, Conversations, and Knowledge:
- **ConfirmClose**: overrides title to "Close conversation?", confirm button uses `$button-primary-bg`
- **ConfirmSpam**: overrides title to "Mark as spam?", confirm button uses `#DC2626` (red)
- **Chat DeleteConfirmation**: overrides title to "Delete conversation", confirm button uses `#DC2626`, dialog width 360px
- **Products-View**: overrides dialog content entirely (custom header with Edit button, product detail fields), hides default Actions (`IHpTr: {enabled: false}`)

**Instance override pattern (confirmation dialog):**
```
{type: "ref", ref: "TNz4n", width: 1232, height: 720, descendants: {
  "gmZvb": {content: "Dialog title"},
  "pCn9D": {content: "Description text"},
  "RgYEP": {content: "Confirm label"},
  "04phX": {fill: "#DC2626"},  // or $button-primary-bg
  "CSZ5O": {gap: 20, width: 400, x: 416, y: 250}
}}
```

**Instance override pattern (view modal with custom content):**
```
{type: "ref", ref: "TNz4n", width: 1280, height: 720, descendants: {
  "CSZ5O": {width: 420, x: 430, y: 140, cornerRadius: 16},
  "M4krg": {enabled: false},   // hide default header (replace with custom)
  "pCn9D": {enabled: false},   // hide default description
  "IHpTr": {enabled: false}    // hide default actions
}}
```

---

### Tab

| | |
|---|---|
| **Active ID** | `fXKVI` |
| **Inactive ID** | `DaNrX` |
| **Text** | Inter 14px medium, letterSpacing -0.084 |
| **Layout** | Vertical, `alignItems: center`, `justifyContent: center` |
| **Height** | `fill_container(48)` (fills tab bar height) |
| **Structure** | LabelWrap frame (Active: `Ej708`, Inactive: `BBqTN` — vertical, `fill_container` height, `justifyContent: center`, `alignItems: center`) containing label text (Active: `lImpW`, Inactive: `a8PwH`). Active tab also has underline rectangle (`d4UA2`, 2px height, `fill_container` width, `$text-primary` fill) below the labelWrap. |

| Variant | ID | Text Fill | Underline | Label ID | LabelWrap ID |
|---------|-----|-----------|-----------|----------|--------------|
| Active | `fXKVI` | `$text-primary` | 2px rectangle (`d4UA2`), `$text-primary` | `lImpW` | `Ej708` |
| Inactive | `DaNrX` | `$text-tertiary` | None | `a8PwH` | `BBqTN` |
| Disabled | `vaAu8` | `$text-disabled` | None | `ZZLyh` | `O20YJ` |

**Label override:** Use `descendants: {"lImpW": {content: "Open"}}` for Active, `descendants: {"a8PwH": {content: "Closed"}}` for Inactive, `descendants: {"ZZLyh": {content: "Drafts"}}` for Disabled.

**Usage:** Tab bar navigation in pages like Conversations. Tabs are placed in a horizontal frame with `alignItems: "stretch"`, gap 16px, padding `[0, 16]`, height 48px, and a `$border-primary` 1px bottom border on the container. Each tab fills the container height; the label is vertically centered via the labelWrap frame, and the active underline sits flush on the bottom divider.

---

### Checkbox

| | |
|---|---|
| **Size** | 16x16 |
| **Corner Radius** | 4px (outer), 2.6px (inner) |
| **Structure** | Outer rectangle (`bg`, `$border-primary`) + inner rectangle (`fg`) + optional icon (check/minus path) |

| Variant | ID | Inner Fill | Icon | Notes |
|---------|-----|-----------|------|-------|
| Default | `aMXW9` | `$surface-primary` | None | Unchecked state |
| Checked | `9juMr` | `#0561E6` | White check path (2px stroke) | Selected state |
| Indeterminate | `CyoBq` | `#0561E6` | White minus path (1.5px stroke) | Partial selection (e.g., select-all with mixed state) |
| Disabled | `YE9Pp` | `$surface-disabled` | None | 50% opacity, non-interactive |

**Shadow:** All variants have an outer shadow on the inner rectangle (`blur: 1.75`, `#1b1c1d1f`, offset y: 2).

**Usage:** Used in the Conversations list search bar as part of the **Select Dropdown** — a horizontal frame (gap 2) containing a checkbox ref + Lucide `chevron-down` icon (14x14, `$text-tertiary`). The select dropdown replaces a standalone checkbox because it doubles as a **bulk-action filter** — users can quickly filter by All, Read, or Unread without needing a separate filter button (the tabs already handle Open/Closed/Spam/Archived categorization, so the dropdown covers the remaining read-status filtering).

**Select Dropdown IDs:** `XdHWn` (Default light), `mkXD2` (Default dark), `LNYKC` (EmptyState light), `aNPkt` (EmptyState dark).

**Checkbox state mapping:**
- **Default** (unchecked): No filter active — showing "All" conversations
- **Checked**: A specific filter is active (e.g., Read or Unread selected)
- **Indeterminate**: Mixed selection state (e.g., some conversations manually selected)

---

### Header

| | |
|---|---|
| **ID** | `d9xqA` |
| **Location** | Inside Main Content of chat screens (absolute positioned at y=0) |
| **Fill** | `$surface-primary` (with background blur) |
| **Border** | None (no bottom border on standard screens) |
| **Layout** | `justifyContent: space_between`, `alignItems: center`, padding `[8, 16]` |
| **Structure** | Clock icon button (left) + Conversation title (center) + New chat (square-pen) icon button (right) |

**Conversation title** (center):
- `fill_container` width, `textAlign: center`, Inter 14px medium, `$text-primary`
- Only shown on conversation screens; on new chat screens, the title is absent and the header uses `gap: 0` between the two icon buttons

**Icon buttons** (clock + square-pen):
- 32x32, corner radius 8px
- Icon: Lucide, 20x20, fill `#4B5563`
- Hover: `#F3F4F6` background fill (disabled by default)
- Tooltip appears below on hover (see [Keyboard Shortcuts](#keyboard-shortcuts))

**History sidebar variant:** When the history sidebar is open, the header is promoted to the **screen level** (outside Main Content), spanning above the history sidebar and main content:
- Position: x=48, y=0 (right of nav sidebar)
- Width: 1232px (full width minus nav sidebar)
- Fill: `$surface-primary` (solid, no semi-transparent tint)
- Bottom border: `$border-primary` 1px (provides demarcation between header and sidebar + content below)
- The history sidebar and main content start at y=48 below the header
- Nav sidebar remains full height (720px) — unaffected by the header

---

### Headings (H1–H4)

Used in AI chat responses for section hierarchy within rich text output.

| Level | ID | Font Size | Font Weight | Letter Spacing | Line Height |
|-------|-----|-----------|-------------|----------------|-------------|
| H1 | `LQsXk` | 24px | 600 (semibold) | -0.48 | 1.3 |
| H2 | `3ewA4` | 20px | 600 (semibold) | -0.4 | 1.35 |
| H3 | `YYYwz` | 16px | 600 (semibold) | -0.16 | 1.4 |
| H4 | `vkOOm` | 14px | 600 (semibold) | -0.084 | 1.45 |

- Font: Inter
- Fill: `#111827` (light) / `$text-primary` in instances for theming
- All are reusable text nodes — override `content` and `fill` via ref instances

---

### Italic Text

| | |
|---|---|
| **ID** | `HhC3a` |
| **Font** | Inter 14px, `fontStyle: italic`, `fontWeight: normal` |
| **Fill** | `#111827` (light) / `$text-primary` in instances |
| **Letter Spacing** | -0.084 |
| **Line Height** | 1.6 |

**Usage:** Inline emphasis, notes, or disclaimers within AI chat responses.

---

### Table

| | |
|---|---|
| **ID** | `9Smp4` |
| **Width** | 720px |
| **Corner Radius** | 8px |
| **Border** | `#E5E7EB` 1px |
| **Layout** | Vertical |
| **Structure** | Scrollable body (`ZzG2r`, height 216px, clipped) containing header row + data rows |

**Header row** (`18plP`):
- Horizontal layout, `#F3F4F6` cell fill
- Text: Inter 14px, `fontWeight: 500`, `#6B7280`
- Cell padding: `[10, 12]`
- Bottom border: 1px stroke on each cell

**Data rows** (e.g. `MB9it`, `O7yZf`, `Gluiv`):
- Horizontal layout, alternating `#FFFFFF` / `#F9FAFB` fill
- Text: Inter 14px, `fontWeight: normal`, `#4B5563`
- Cell padding: 12px
- Bottom border: `#E5E7EB` 1px on each cell
- Long text cells use `textGrowth: "fixed-width"` with `width: "fill_container"`

**Column sizing:**
- First column: fixed width (140px)
- Remaining columns: `fill_container`

**Usage:** Displayed in AI chat responses when information is best represented as tabular data.

---

### Ordered List

| | |
|---|---|
| **ID** | `s01gw` |
| **Width** | 720px |
| **Layout** | Vertical, gap 4px |
| **Structure** | List items (horizontal frames), each containing a number text + content text |

**List item row:**
- Horizontal layout, `gap: 8`, `alignItems: start`
- Number (`number`): Inter 14px, `#4B5563`, `width: 20`, `textAlign: right`, `textGrowth: fixed-width`
- Text (`text`): Inter 14px, `#111827`, `lineHeight: 1.6`, `letterSpacing: -0.084`, `textGrowth: fixed-width`, `width: fill_container`

**Usage:** Displayed in AI chat responses for numbered/sequential information.

---

### Unordered List

| | |
|---|---|
| **ID** | `LkC8o` |
| **Width** | 720px |
| **Layout** | Vertical, gap 4px |
| **Structure** | List items (horizontal frames), each containing a bullet text + content text |

**List item row:**
- Horizontal layout, `gap: 8`, `alignItems: start`
- Bullet (`bullet`): Inter 14px, `#4B5563`, content `•`, `width: 20`, `textAlign: right`, `textGrowth: fixed-width`
- Text (`text`): Inter 14px, `#111827`, `lineHeight: 1.6`, `letterSpacing: -0.084`, `textGrowth: fixed-width`, `width: fill_container`

**Usage:** Displayed in AI chat responses for bulleted/unordered information.

---

### Blockquote

| | |
|---|---|
| **ID** | `yJpgm` |
| **Width** | 720px |
| **Layout** | Horizontal |
| **Structure** | Left bar (rectangle) + content frame with quote text |

**Left bar** (`A4LFg`):
- Rectangle, 3px wide, `fill_container` height, `#D1D5DB`, pill-shaped (`cornerRadius: 9999`)

**Content** (`1BNCX`):
- Vertical layout, `padding: [0, 0, 0, 12]` (12px left gap from bar)
- Quote text (`Co1Dc`): Inter 14px italic, `#4B5563`, `lineHeight: 1.6`, `textGrowth: fixed-width`, `width: fill_container`

**Usage:** Displayed in AI chat responses for quoted or highlighted passages.

---

### Code Block

| | |
|---|---|
| **ID** | `3sRcg` |
| **Width** | 720px |
| **Corner Radius** | 8px |
| **Fill** | `#FFFFFF` (white) |
| **Border** | `#E5E7EB` 1px |
| **Layout** | Vertical |
| **Structure** | Header bar + code body |

**Header** (`ThqoJ`):
- Horizontal layout, `padding: [10, 16]`, `justifyContent: space_between`, `alignItems: center`
- Bottom border: `#E5E7EB` 1px
- Language label (`a6GjR`): Inter 12px, `#6B7280`
- Copy button (`4VnzR`): Lucide `copy` icon (14x14) + "Copy" label, both `#6B7280`, `cornerRadius: 6`, `padding: [4, 8]`

**Code body** (`ny4z0`):
- Vertical layout, `padding: 16`, `gap: 2`, fill `#F9FAFB`
- Code lines: JetBrains Mono 13px, `#111827`, `lineHeight: 1.6`

**Dark mode overrides:**
- Root fill: `#1F2937`, border: `#374151`
- Header bottom border: `#374151`
- Language label + copy button: `#9CA3AF`
- Code body fill: `#111827`
- Code lines: `#E5E7EB`

**Behavior:**
- Copy button click: copies code content to clipboard
- On click, icon swaps from `copy` → `check` and label changes from "Copy" → "Copied!", same color
- Reverts back to default state after **~2 seconds**

**Usage:** Displayed in AI chat responses when showing code snippets.

---

### Image Preview

Thumbnail preview shown inside the chat input when a user attaches/uploads an image before sending.

| Variant | ID | Description |
|---------|-----|-------------|
| Loading | `7IOPs` | Gray skeleton (`#F3F4F6`) with Lucide `loader` icon (16x16, `#9CA3AF`). Shown while image is uploading. |
| Default | `LgmQW` | Image fill (mode: fill), `#E5E7EB` 1px border. Shown when image is loaded. |
| Hover | `QAFKA` | Image + dark overlay (`#00000066`) + dark X remove button (16x16 circle `#030712`, white `x` icon 12x12, top-right at x:26 y:2). Shown on hover. |

**Common properties (all variants):**
- Size: 44x44
- Corner radius: 8px
- Border: `#E5E7EB` 1px (light) / `#374151` (dark)
- Clip: true

**Dark mode overrides:**
- Loading: fill `#1F2937`, border `#374151`, spinner fill `#6B7280`
- Default: border `#374151`
- Hover: same overlay + X button (works on both themes)

**Behavior:**
- Previews appear in a horizontal row (gap 8px) above the text area inside the chat input
- Multiple images can be attached (row wraps or scrolls)
- Hover reveals X button to remove/delete the attached image
- Clicking X removes the image from the attachment list
- Loading spinner animates (CSS rotation)

---

### Document Preview

Chip preview shown inside the chat input when a user attaches/uploads a document (PDF, DOCX, etc.) before sending.

| Variant | ID | Description |
|---------|-----|-------------|
| Loading | `x5BU4` | Muted file type badge (gray `#9CA3AF`, 60% opacity label), "Uploading..." text, file size — all muted. |
| Default | `AjBnX` | Colored file type badge + filename (Inter 12px medium, `#111827`) + file size (Inter 11px, `#6B7280`). |
| Hover | `6kiwc` | Same as default with darker fill (`#E5E7EB`) + dark X remove button (16x16 circle `#030712`, white `x` icon 12x12) inline. |

**Common properties (all variants):**
- Layout: horizontal, gap 8px, alignItems center
- Padding: `[6, 10, 6, 8]`
- Corner radius: 8px
- Fill: `#F3F4F6` (default/loading), `#E5E7EB` (hover)
- Border: `#E5E7EB` 1px (default/loading), `#D1D5DB` 1px (hover)

**File type badge:**
- Small rounded rectangle (cornerRadius 3, padding `[4, 3]`)
- Inter 9px bold, white text, 0.36 letter spacing
- Color by file type: PDF `#DC2626` (red), XLS `#16A34A` (green), DOC `#2563EB` (blue), PPT `#EA580C` (orange), CSV `#059669` (emerald), TXT `#6B7280` (gray)
- Badge color stays the same in both light and dark modes
- Loading state: badge uses muted `#9CA3AF` fill with 60% opacity label

**Dark mode overrides:**
- Chip fill: `#1F2937`, border: `#374151`
- Filename: `#FFFFFF`, file size: `#9CA3AF`
- Badge color: unchanged (keeps brand color)

**Behavior:**
- Previews appear in a horizontal row (gap 8px) above the text area inside the chat input
- Hover reveals inline X button to remove/delete the attached document
- Clicking X removes the document from the attachment list

---

### Scroll Button

| | |
|---|---|
| **ID** | `kAJHZ` |
| **Size** | 32x32 (auto from 8px padding + 16x16 icon) |
| **Corner Radius** | 100 (pill/circle) |
| **Fill** | `#F9FAFB` (gray-50) |
| **Border** | `#E5E7EB` 1px |
| **Shadow** | Outer shadow (`blur: 1.75`, `#0000000D`, offset y: 1) |
| **Icon** | Lucide `chevron-down`, 16x16, stroke `#4B5563` 1.5px |

**Dark mode overrides:**
- Fill: `#1F2937` (gray-800)
- Border: `#374151` (gray-700)
- Shadow: `#0000001A`, blur 3
- Icon stroke: `#D1D5DB` (gray-300)

**Behavior:**
- Appears when user scrolls up in a long chat conversation
- Positioned **centered horizontally** in the chat area, **16px above** the chat input
- On click: smooth-scrolls to the most recent / last message in the conversation
- Hidden when user is already at the bottom of the conversation

---

### History Sidebar

| | |
|---|---|
| **ID** | `ZLG2w` (light screen instance), `4J8fz` (dark screen instance) |
| **Width** | 280px |
| **Height** | 672px (below header, which sits at screen level) |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px right side only |
| **Layout** | Vertical |
| **Clip** | true |

**Structure:**

1. **Header** (`l0SKi`): Horizontal layout, `justifyContent: space_between`, `padding: [12, 16]`
   - Title: "History", Inter 14px semibold, `$text-primary`
   - Close button: 24x24 frame, cornerRadius 6, Lucide `panel-left-close` icon 16x16, `#6B7280` (light) / `#9CA3AF` (dark). Hover fill: `#F3F4F6` (light) / `#374151` (dark), disabled by default.

2. **Search row** (`kj77d`): Padding `[4, 12, 12, 12]`
   - Search input: 32px height, cornerRadius 8, `$surface-primary` fill, `$border-primary` 1px border
   - Lucide `search` icon 14x14, `$text-tertiary`
   - Placeholder: "Search conversations...", Inter 13px, `$text-disabled`

3. **History list** (`2BUBG`): Vertical layout, gap 4, padding `[0, 8]`, `fill_container` height, clipped
   - **Section labels**: Inter 11px semibold, `$text-tertiary`, letterSpacing 0.44 (e.g., "Today", "Yesterday", "Previous 7 Days")
   - **Conversation rows**: Horizontal frame, `fill_container` width, padding 8, cornerRadius 8
     - Text: Inter 13px normal, `$text-primary`, `textGrowth: fixed-width`, `fill_container` width
     - Active row: `#F3F4F6` fill (light) / `#1F2937` fill (dark)
     - Default rows: fill disabled (hover fill `#F3F4F6` light / `#1F2937` dark)

**Dark mode overrides:**
- Close icon: `#9CA3AF` instead of `#6B7280`
- Close button hover fill: `#374151` instead of `#F3F4F6`
- Active row fill: `#1F2937` instead of `#F3F4F6`
- Row hover fill: `#1F2937` instead of `#F3F4F6`

**Behavior:**
- Opens when clock icon in header is clicked (`⌘H` shortcut)
- Clock icon shows active state (`#F3F4F6` light / `#374151` dark fill) while sidebar is open
- **Header is promoted to screen level** (above history sidebar and main content), spanning 1232px (x=48, right of nav sidebar) with a bottom border. Nav sidebar remains full height (720px). History sidebar and main content start at y=48 below the header.
- Main content area resizes from **1232px → 952px** and shifts right to `x: 328` (from `x: 48`), height becomes **672px** (720 - 48 header). Chat content column narrows from **768px → 680px** and re-centers: x = (952 - 680) / 2 = **136px**. User message text width reduces from 400px → 360px to fit.
- Nav sidebar retains its right stroke (`$border-primary`) when history sidebar is open
- Active conversation row highlighted; others highlight on hover
- Close button (`panel-left-close`) closes sidebar, restoring main content to full width
- Search input filters conversation history list
- Clicking a conversation row navigates to that conversation

---

### ChatInput

| | |
|---|---|
| **ID** | `s5iOG` |
| **Width** | 558px |
| **Corner Radius** | 16px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-hover` 1px |
| **Shadow** | Soft shadow |
| **Structure** | Text area (`C0bv7`, height: 72px) with placeholder (`7XBIC`) + Bottom bar (`wDrqv`) with add button (`qtBfo`) and agent selector (`jG25L`) |

| Variant | ID | Notes |
|---------|-----|-------|
| Default | `s5iOG` | Placeholder text, no send button |
| Filled | `oqJBt` | Typed text, send button appears next to agent selector |
| Max Height | `yaI9t` | Text area clipped at **200px max height**, content scrollable internally, send button visible |

**Behavior:**
- Text area auto-grows as user types
- **Max height: 200px** (~8 lines) — after this, content scrolls internally
- Send button (dark circle, `send-horizontal` Lucide icon) appears when text is entered
- Add button (+) shows "Add files" tooltip on hover
- Agent selector shows dropdown on click

---

### AgentSelector

| | |
|---|---|
| **ID** | `wvpKh` |
| **Width** | 260px |
| **Corner Radius** | 12px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px |
| **Structure** | Search bar (`thz2A`) with search icon + input + Agent rows (`M1nIR` Assistant, `DjS3g` Assistant - Opus-4-6, `Dvws7` fast rag test, `dRKDe` QA Tester Agent) + Separator line (`BCuBJ`) + Add agent row (`tuX6D`) with plus icon and "Add agent" text |

**Behavior:**
- Opens when agent selector button in ChatInput is clicked
- Agent selector button shows `#F3F4F6` hover/active fill when dropdown is open
- Search bar filters available agents
- Active agent has a **check mark** on the right side
- A separator line separates the agent list from the "Add agent" action
- "Add agent" row at bottom with plus icon + "Add agent" label in `$text-secondary`
- Rows show `#F3F4F6` hover fill
- Active agent row only has hover fill when actually hovered (no persistent highlight)

---

### Customer Info Modal

A popover modal that displays customer/contact details for the person who sent the current email. Triggered via the "Customer info" option in the ellipsis context menu in the conversation detail header.

| | |
|---|---|
| **Width** | 320px |
| **Corner Radius** | 12px |
| **Fill** | `#FFFFFF` (light) / `#1F2937` (dark) |
| **Border** | `#E5E7EB` 1px (light) / `#374151` 1px (dark) |
| **Shadow** | Double shadow (`blur: 24, spread: -4, #0000001A` + `blur: 8, #0000000D`) light; (`blur: 24, spread: -4, #0000004D` + `blur: 8, #00000033`) dark |
| **Position** | Absolutely positioned in Main Content at x:420, y:192 (below sender row in detail header) |
| **Clip** | true |

**Structure (top to bottom):**

1. **Modal Header** — horizontal, padding `[16, 20]`, gap 12, `justifyContent: space_between`, `alignItems: start`, bottom border
   - **Name Block** (vertical, gap 2):
     - Name Row (horizontal, gap 8, `alignItems: center`): name (Inter 14px semibold, `$text-primary`) + Status Badge (pill, cornerRadius 9999)
     - Email (Inter 12px, `$text-tertiary`)
   - **Close button**: 28x28 frame, cornerRadius 6, Lucide `x` icon 16x16, `#6B7280` (light) / `#9CA3AF` (dark). Top-right aligned.

2. **Info Section** — vertical, padding `[16, 20]`, gap 14. Key-value rows:
   - **Subscription**: label `$text-tertiary` + "Pro Plan" badge (pill, `#EFF6FF` fill + `#1D4ED8` text light / `#172554` fill + `#60A5FA` text dark)
   - **Date added**: label + value (Inter 13px, `$text-primary`)
   - **Locale**: label + value (e.g., "en-US")
   - **Source**: label + badge (pill, `#F3F4F6` fill + `#374151` text light / `#374151` fill + `#D1D5DB` text dark, e.g., "Manual Import")
   - All rows: horizontal, `fill_container` width, `justifyContent: space_between`, `alignItems: center`

3. **Stats Section** — horizontal, padding `[12, 20]`, gap 12. No top border (info section's bottom border provides separation). Two stat cards:
   - Each: `fill_container` width, cornerRadius 8, padding `[10, 12]`, `#F9FAFB` fill (light) / `#111827` (dark)
   - Value: Inter 16px semibold, `$text-primary`
   - Label: Inter 11px, `$text-tertiary`
   - Cards: "12 Total conversations" + "2h ago Last active"

**Status Badge variants:**
| Status | Light Fill | Light Text | Dark Fill | Dark Text |
|--------|-----------|------------|-----------|-----------|
| Active | `#ECFDF3` | `#057747` | `#052E16` | `#6FE6A7` |
| Churned | `#FEF2F2` | `#DC2626` | `#450A0A` | `#FCA5A5` |
| Trialing | `#FFFAEB` | `#B54808` | `#461602` | `#FDC94C` |

**Source badge values:** "Manual Import", "API", "Signup", "CSV Import"

**Screen IDs:**
- Light: `dXJoQ` (modal `ZmTjj`)
- Dark: `xlzs9` (modal `jKGoe`)

**Behavior:**
- Triggered via "Customer info" option in the ellipsis context menu
- Closes on click outside, close (X) button, or pressing Escape
- Close button hover: `#F3F4F6` (light) / `#1F2937` (dark) fill

---

### Info Popover

| | |
|---|---|
| **ID** | `QBa24` |
| **Width** | 300px |
| **Corner Radius** | 12px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px |
| **Shadow** | Double shadow (`blur: 5.25, spread: -1` + `blur: 3.5, spread: -2`) |
| **Structure** | Header (`6bMMR`) with "Sources used" title left-aligned + count number right-aligned (`$text-secondary`, Inter 14px regular) + Source pills list (`cJgfC`) |

**Source pills:**
- Full-width, pill-shaped (`cornerRadius: 100`), `clip: true`
- Each pill has: favicon (20x20 circle) + domain text (`$text-primary`, Inter 14px bold) + source title (`$text-secondary`, Inter 14px, truncated with "...")
- Favicon-to-domain gap: **8px**
- Multiple sources can come from the same domain (e.g., 2 results from wikipedia.org, 2 from britannica.com)
- Light default fill: `$gray-100`
- Light hover fill: `#E5E7EB` (gray-200) — **exception** to the normal gray-100 hover pattern
- Dark default fill: `#111827` (gray-900, subtle against dark bg)
- Dark hover fill: `#1F2937` (gray-800)

**Behavior:**
- Opens on info icon click, absolutely positioned below the icon
- Info icon shows active state (`#F3F4F6` light / `#1F2937` dark) while popover is open
- Closes on click outside or clicking info icon again

---

### User Profile Popup

| | |
|---|---|
| **ID** | `HWed7` (base component inside Default screens) |
| **Width** | 220px |
| **Corner Radius** | 12px |
| **Fill** | `$surface-primary` |
| **Border** | `$border-primary` 1px |
| **Shadow** | Double shadow |
| **Position** | Absolutely positioned above user avatar in sidebar, y: 435 |

**Structure (top to bottom):**

1. **User info row** — horizontal, padding `[12, 12]`, gap 10, `alignItems: center`
   - Avatar circle (32x32, initials) + Name/email vertical stack (name: Inter 13px semibold `$text-primary`, email: Inter 12px `$text-tertiary`)

2. **Settings row** — horizontal, padding `[8, 12]`, gap 10, `alignItems: center`
   - Lucide `settings` icon 16x16 `$text-secondary` + "Settings" label Inter 13px `$text-primary`
   - Hover fill: `#F3F4F6` (disabled by default, enabled on hover)

3. **Theme switcher** — horizontal, padding `[8, 12]`, gap 8
   - Three toggle buttons: **System** / **Light** / **Dark**
   - Each button: cornerRadius 6, padding `[4, 10]`, Inter 12px medium
   - Active button fill: `$surface-disabled` (light) / `$surface-secondary` (dark)
   - Inactive buttons: no fill, `$text-secondary` text
   - Active button text: `$text-primary`

4. **Help & feedback row** — same layout as Settings row
   - Lucide `circle-help` icon 16x16 + "Help & feedback" label
   - Hover fill: `#F3F4F6` (disabled by default)

5. **Log out row** — same layout as Settings/Help rows
   - Lucide `log-out` icon 16x16 + "Log out" label
   - Hover fill: `#F3F4F6` (disabled by default)

**Dark mode overrides:**
- Theme switcher active button: `$surface-secondary` instead of `$surface-disabled`
- All hover fills remain `#F3F4F6` (consistent pattern, works on dark `$surface-primary` backgrounds)

**Behavior:**
- Opens on user avatar click in sidebar bottom
- Avatar icon shows `$surface-hover` fill while popup is open
- Closes on click outside or clicking avatar again
- Theme switcher toggles between System/Light/Dark modes

**Screen IDs:**
- Light: `u4KP2` (popup `PnZGo`)
- Dark: `Lg00W` (popup `w4vMS`)

---

## Screens

### Authentication

| Screen | ID | Theme | Size |
|--------|-----|-------|------|
| Sign Up | `J56ve` | Light | 1280x720 |
| Sign Up - Dark | `xCokx` | Dark | 1280x720 |
| Sign In | `ZYtbF` | Light | 1280x720 |
| Sign In - Dark | `TWgGZ` | Dark | 1280x720 |
| Sign In - Error Toast | `bHrxy` | Light | 1280x720 |
| Sign In - Error Toast - Dark | `Pu152` | Dark | 1280x720 |
| Update Password | `77S9t` | Light | 1280x720 |
| Update Password - Dark | `ARZV1` | Dark | 1280x720 |

### Chat

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Chat (default) | `SPqR7` | Light | New chat state — "What are you working on?" + input (558px) + suggestions |
| Chat - Agent Selector Open | `EnpoM` | Light | Dropdown open, active typing state |
| Chat - Conversation | `ePl6z` | Light | Active conversation — user message (right), AI response with actions, wider input (768px) |
| Chat (default) - Dark | `uy1QI` | Dark | Dark mode variant of default chat |
| Chat - Agent Selector Open - Dark | `11byn` | Dark | Dark mode variant of agent selector open |
| Chat - Conversation - Dark | `Dy337` | Dark | Dark mode variant of conversation view |
| Chat - Conversation - Info Popover | `cx8SP` | Light | Info popover open, showing sources used |
| Chat - Conversation - Info Popover - Dark | `jHX8s` | Dark | Dark mode variant of info popover open |
| Chat - Conversation - Rich Text | `mvehf` | Light | AI response with rich text: headings (H2–H4), ordered list, code block, blockquote, unordered list, italic text, table (1280x1400) |
| Chat - Conversation - Rich Text - Dark | `RHfbi` | Dark | Dark mode variant of rich text conversation (1280x1400) |
| Chat - Conversation - Image Upload | `YEqg2` | Light | User uploads an image — preview above message bubble (1280x790) |
| Chat - Conversation - Image Upload - Dark | `uOWx9` | Dark | Dark mode variant of image upload conversation (1280x790) |
| Chat - Conversation - Scroll Button | `JNfyW` | Light | Long conversation scrolled up — scroll-to-bottom button visible centered 16px above input (1280x790) |
| Chat - Conversation - Scroll Button - Dark | `jyH52` | Dark | Dark mode variant of scroll button conversation (1280x790) |
| Chat - Conversation - Image Drag | `8U8oc` | Light | Drag-and-drop overlay when user drags an image into the chat (1280x790) |
| Chat - Conversation - Image Drag - Dark | `a1C8O` | Dark | Dark mode variant of image drag overlay (1280x790) |
| Chat - Conversation - Image Attached | `1kmjw` | Light | Image previews inside chat input before sending — shows default + loading state (1280x720) |
| Chat - Conversation - Image Attached - Dark | `v6z1s` | Dark | Dark mode variant of image attached state (1280x720) |
| Chat - Conversation - Doc Attached | `3cv10` | Light | Document preview chip inside chat input before sending (1280x720) |
| Chat - Conversation - Doc Attached - Dark | `5bsEl` | Dark | Dark mode variant of document attached state (1280x720) |
| Chat - Conversation - History Sidebar | `nF2hW` | Light | History sidebar open — clock icon active, sidebar with search + grouped conversation list, main content narrowed to 952px (1280x720) |
| Chat - Conversation - History Sidebar - Dark | `F0Jc0` | Dark | Dark mode variant of history sidebar open (1280x720) |
| Chat - History Sidebar - Empty State | `SS8bc` | Light | Empty history sidebar — no conversations, centered message-square-dashed icon + "No conversations yet" + "Start a new chat to begin" (1280x720) |
| Chat - History Sidebar - Empty State - Dark | `ek3XK` | Dark | Dark mode variant of empty history sidebar (1280x720) |
| Chat - History Sidebar - No Results | `9qxP3` | Light | Search active ("migration plans") with no matching results — centered search-x icon + "No results found" + "Try a different search term" (1280x720) |
| Chat - History Sidebar - No Results - Dark | `G5L4F` | Dark | Dark mode variant of no results search (1280x720) |
| Chat - Conversation - Failed Response | `RsCA5` | Light | AI response failed — red triangle-alert icon + "Something went wrong" + description + "Try again" button with rotate-ccw icon (1280x720) |
| Chat - Conversation - Failed Response - Dark | `XD45m` | Dark | Dark mode variant of failed response (1280x720) |
| Chat - Conversation - Message Hover Actions | `MxDIl` | Light | Hover states on messages — edit (pencil) action row below user message (right-aligned), regenerate (refresh-ccw) icon in AI response actions row (1280x720) |
| Chat - Conversation - Message Hover Actions - Dark | `c87GX` | Dark | Dark mode variant of message hover actions (1280x720) |
| Chat - Conversation - Edit Message | `sEHZ4` | Light | Edit-active state — user message becomes editable text area with blue focus border + Cancel / Save & Submit buttons (1280x720) |
| Chat - Conversation - Edit Message - Dark | `JXcE7` | Dark | Dark mode variant of edit message state (1280x720) |
| Chat - Conversation - Copy Feedback | `FDZpW` | Light | Copy icon swapped to check icon after user clicks copy on AI response — reverts after ~2s (1280x720) |
| Chat - Conversation - Copy Feedback - Dark | `TwKbn` | Dark | Dark mode variant of copy feedback (1280x720) |
| Chat - Conversation - Streaming Response | `pM5Q9` | Light | AI response mid-stream — partial text with blinking cursor, no action icons yet (1280x720) |
| Chat - Conversation - Streaming Response - Dark | `PNRzO` | Dark | Dark mode variant of streaming response (1280x720) |
| Chat - History Sidebar - Row Hover Actions | `M6ixb` | Light | History row hover — pencil (rename) and trash (delete) icons appear on hovered row (1280x720) |
| Chat - History Sidebar - Row Hover Actions - Dark | `Lw8yW` | Dark | Dark mode variant of row hover actions (1280x720) |
| Chat - History Sidebar - Delete Confirmation | `9c1Sr` | Light | Delete confirmation modal over history sidebar — "Delete conversation" dialog with Cancel / Delete buttons (1280x720) |
| Chat - History Sidebar - Delete Confirmation - Dark | `HaSAB` | Dark | Dark mode variant of delete confirmation (1280x720) |
| Chat - Conversation - Generated Document | `JoLPF` | Light | AI generates a document — full rich text content rendered inline (headings, lists, paragraphs) + download card at bottom (1280x1100) |
| Chat - Conversation - Generated Document - Dark | `6GAJ3` | Dark | Dark mode variant of generated document (1280x1100) |
| Chat - Default - Hover Suggestion Card | `Y6Ek9` | Light | Hover state on middle suggestion card — `$surface-hover` fill + `$border-hover` 1px stroke on hovered card. Other cards unchanged. (1280x720) |
| Chat - Default - Hover Suggestion Card - Dark | `EAxtY` | Dark | Dark mode variant of suggestion card hover (1280x720) |
| Chat - Default - Typing | `2RhuL` | Light | User typing state — placeholder replaced with typed text (`$text-primary`), chat input border becomes `$border-focus` 1.5px, send button appears in bottom-bar (arrow-up icon, `$button-primary-bg`, cornerRadius 8, padding 6). (1280x720) |
| Chat - Default - Typing - Dark | `vqMdj` | Dark | Dark mode variant of typing state (1280x720) |
| Chat - Default - Sidebar Tooltip Visible | `u71kk` | Light | Sidebar tooltip visible state — "Conversations" tooltip (`p6YFG` ref) enabled next to inbox icon, inbox menu item has `$surface-hover` background. Shows tooltip-on-hover pattern for sidebar navigation. (1280x720) |
| Chat - Default - Sidebar Tooltip Visible - Dark | `yyEXE` | Dark | Dark mode variant of sidebar tooltip visible (1280x720) |
| Chat - Default - User Profile Open | `u4KP2` | Light | User profile popup visible — popup appears above user avatar in sidebar bottom, showing Thelma Nader name/email, Settings, theme switcher (System/Light/Dark), Help & feedback, Log out. Avatar icon has `$surface-hover` background. (1280x720) |
| Chat - Default - User Profile Open - Dark | `Lg00W` | Dark | Dark mode variant of user profile open (1280x720) |

### Conversations

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Conversations - Setup | `xMyM9` | Light | Setup/onboarding state — full-page centered "Activate conversations" + "Connect your email..." + Connect email button. Shown before email integration is connected. (1280x720) |
| Conversations - Setup - Dark | `vsDCj` | Dark | Dark mode variant of setup state (1280x720) |
| Conversations - Empty State | `8Z7J9` | Light | Split-panel empty state — empty conversation list on left, "No conversations yet" on right. Shown after email is connected but no messages exist. (1280x720) |
| Conversations - Empty State - Dark | `NSnHr` | Dark | Dark mode variant of empty state (1280x720) |
| Conversations - Default | `z3sBN` | Light | Split-panel with conversation list (4 sample rows) on left, "No conversation selected" on right. Default state with conversations but none selected. (1280x720) |
| Conversations - Default - Dark | `shcl7` | Dark | Dark mode variant of default state (1280x720) |
| Conversations - Default - Active | `6feiI` | Light | Selected conversation (Sarah Johnson) — right panel shows email body (flat text), detail header, and reply bar. First row highlighted. (1280x720) |
| Conversations - Default - Active - Dark | `EMxqg` | Dark | Dark mode variant of active conversation state (1280x720) |
| Conversations - Default - Active - Context Menu | `d24C7` | Light | Ellipsis context menu open — Customer info, Close conversation, Mark as spam options. (1280x720) |
| Conversations - Default - Active - Context Menu - Dark | `kt8U3` | Dark | Dark mode variant of context menu state (1280x720) |
| Conversations - Default - Active - AI Rewrite | `MNOkS` | Light | AI rewrite active — shimmer gradient "Improving your reply..." text, faded draft preview, blue focus border, wand button highlighted with "Improving..." label, stop button visible. (1280x720) |
| Conversations - Default - Active - AI Rewrite - Dark | `ts8n9` | Dark | Dark mode variant of AI rewrite state (1280x720) |
| Conversations - Default - Active - Formatting | `YAOcU` | Light | Formatting toolbar active state — bold toggled on (blue highlight), typed reply with bold text, blue focus border, send button visible. Full conversation thread: Sarah's email (flat text) → user's outgoing reply (chat bubble) → Sarah's response with **bullet points + bold keywords** (flat text) → active compose. Shows Gmail-style formatting UX + rich text in email responses. (1280x720) |
| Conversations - Default - Active - Formatting - Dark | `LUkcM` | Dark | Dark mode variant of formatting toolbar active state (1280x720) |
| Conversations - Default - Active - Row Hover | `qKBq8` | Light | Row hover state — Michael Chen's row (second) shows hover fill (`#F3F4F6`), Sarah Johnson's row is selected (no unread dot — cleared on open). Shows hover feedback on non-selected rows. (1280x720) |
| Conversations - Default - Active - Row Hover - Dark | `2YfDl` | Dark | Dark mode variant of row hover state — Michael Chen's row shows `#1F2937` hover fill (1280x720) |
| Conversations - Default - Empty Search | `G8fbX` | Light | Empty search results — search input active with "budget allocation" query (blue focus border), conversation list shows search-x icon + "No results found" + "Try a different search term". Right panel shows "No conversation selected" empty state. (1280x720) |
| Conversations - Default - Empty Search - Dark | `V9EpW` | Dark | Dark mode variant of empty search results (1280x720) |
| Conversations - Default - MultiSelect | `ip3Mu` | Light | Multi-select / bulk action mode — 2 of 4 rows checked (Sarah Johnson + Emily Rodriguez), bulk action bar replaces search bar with indeterminate checkbox + "2 selected" count + Send, Close, Spam, Archive action buttons. Right panel shows "No conversation selected". (1280x720) |
| Conversations - Default - MultiSelect - Dark | `eMr3E` | Dark | Dark mode variant of multi-select bulk action mode (1280x720) |
| Conversations - Default - Active - Customer Info | `dXJoQ` | Light | Customer info popover open — name, status (Active), subscription (Pro Plan), date added, locale, source, conversation count, last active. (1280x720) |
| Conversations - Default - Active - Customer Info - Dark | `xlzs9` | Dark | Dark mode variant of customer info popover (1280x720) |
| Conversations - Default - Active - AI Rewrite Complete | `6sFk9` | Light | AI rewrite finished — improved text in reply box, green border flash, wand button shows check + "Done" in green, stop button removed. Transient state (~2s) before reverting to normal. (1280x720) |
| Conversations - Default - Active - AI Rewrite Complete - Dark | `jJDHi` | Dark | Dark mode variant of AI rewrite complete state (1280x720) |
| Conversations - Default - Active - AI Rewrite Toast | `ZLkjI` | Light | User navigated to a different conversation while AI rewrite was processing. Success toast appears top-right: "Reply improved" + conversation subject + "View" button to navigate back. (1280x720) |
| Conversations - Default - Active - AI Rewrite Toast - Dark | `F6JpM` | Dark | Dark mode variant of AI rewrite toast state (1280x720) |
| Conversations - Default - Select Dropdown Open | `U5E0N` | Light | Select dropdown menu open — shows All/Read/Unread filter options, "Read" row hovered, checkbox shows indeterminate state, chevron flipped. (1280x720) |
| Conversations - Default - Select Dropdown Open - Dark | `VyGiJ` | Dark | Dark mode variant of select dropdown open state (1280x720) |
| Conversations - Closed - Active | `UcGkT` | Light | Closed tab active — selected conversation shows "Conversation closed" banner at bottom with green circle-check icon + "Reopen" button (`$surface-primary` fill, `$border-hover` stroke). Banner: `$surface-disabled` fill, `$border-primary` top border, padding `[12, 12, 16, 12]`. No status badges in conversation rows (tab already indicates section). (1280x720) |
| Conversations - Closed - Active - Dark | `dejXt` | Dark | Dark mode variant of closed active state (1280x720) |
| Conversations - Spam - Active | `EmG8w` | Light | Spam tab active — selected conversation shows "Marked as spam" banner at bottom with red shield-alert icon + "Not spam" button (`$surface-primary` fill) + red "Delete" button. Banner: `$surface-disabled` fill, `$border-primary` top border (consistent with Closed/Archived). No status badges in conversation rows. (1280x720) |
| Conversations - Spam - Active - Dark | `13V6m` | Dark | Dark mode variant of spam active state (1280x720) |
| Conversations - Archived - Active | `5S95C` | Light | Archived tab active — selected conversation shows "Conversation archived" banner at bottom with gray archive icon + "Unarchive" button (`$surface-primary` fill, `$border-hover` stroke). Banner: `$surface-disabled` fill, `$border-primary` top border, padding `[12, 12, 16, 12]`. No status badges in conversation rows. (1280x720) |
| Conversations - Archived - Active - Dark | `RWjBM` | Dark | Dark mode variant of archived active state (1280x720) |
| Conversations - Default - Active - Replying | `YPnMX` | Light | Reply compose active — text area expanded with typed reply content, Send button visible in bottom bar. Blue focus border on reply box. (1280x720) |
| Conversations - Default - Active - Replying - Dark | `y2ctQ` | Dark | Dark mode variant of replying state (1280x720) |
| Conversations - Default - Active - Attachments | `OtdIK` | Light | Reply with attachments — image previews (Loading + Hover states) and doc preview chip shown in an attachment row above text area. (1280x720) |
| Conversations - Default - Active - Attachments - Dark | `EsHHZ` | Dark | Dark mode variant of attachments state (1280x720) |
| Conversations - Default - Active - SendingReply | `Nl56f` | Light | Reply sending — Send button shows loading spinner, reply text dimmed at 50% opacity. Non-interactive state during send. (1280x720) |
| Conversations - Default - Active - SendingReply - Dark | `CHkrh` | Dark | Dark mode variant of sending reply state (1280x720) |
| Conversations - Default - Active - ReplySent | `XxXum` | Light | Reply sent confirmation — success toast top-right with green circle-check icon, "Reply sent" title, conversation subject description. Auto-dismisses 5s. (1280x720) |
| Conversations - Default - Active - ReplySent - Dark | `Wk5Vz` | Dark | Dark mode variant of reply sent toast state (1280x720) |
| Conversations - Default - Active - SearchFocused | `JfCc2` | Light | Search input focused — blue focus ring, typed query "budget", conversation list filtered to matching results. (1280x720) |
| Conversations - Default - Active - SearchFocused - Dark | `5iRXs` | Dark | Dark mode variant of search focused state — search input uses `$border-focus` border (2px) for visibility on dark background. (1280x720) |
| Conversations - Closed - Empty | `7byDa` | Light | Closed tab with no conversations — centered check-circle icon + "No closed conversations" + description. (1280x720) |
| Conversations - Closed - Empty - Dark | `haxxj` | Dark | Dark mode variant of closed empty state (1280x720) |
| Conversations - Spam - Empty | `6I9vb` | Light | Spam tab with no conversations — centered shield-check icon + "No spam conversations" + description. (1280x720) |
| Conversations - Spam - Empty - Dark | `VKzxp` | Dark | Dark mode variant of spam empty state (1280x720) |
| Conversations - Archived - Empty | `Y256A` | Light | Archived tab with no conversations — centered archive icon + "No archived conversations" + description. (1280x720) |
| Conversations - Archived - Empty - Dark | `HU4Cv` | Dark | Dark mode variant of archived empty state (1280x720) |
| Conversations - Default - Active - ConfirmClose | `cgt5R` | Light | Confirm close dialog — uses `Components/ModalOverlay` ref (`TNz4n`) with `$overlay-bg` + background blur. Dialog: "Close conversation?" + Cancel/Close buttons (`$button-primary-bg`). (1280x720) |
| Conversations - Default - Active - ConfirmClose - Dark | `ReQgV` | Dark | Dark mode variant of confirm close dialog (1280x720) |
| Conversations - Default - Active - ConfirmSpam | `zrNh6` | Light | Confirm spam dialog — uses `Components/ModalOverlay` ref (`TNz4n`) with `$overlay-bg` + background blur. Dialog: "Mark as spam?" + Cancel/"Mark as spam" (`#DC2626` red) buttons. (1280x720) |
| Conversations - Default - Active - ConfirmSpam - Dark | `oEIFZ` | Dark | Dark mode variant of confirm spam dialog (1280x720) |
| Conversations - Default - MultiSelect - Actions | `oj3N1` | Light | Multi-select with tooltip — Close action button hovered, "Close conversation" tooltip visible. Shows tooltip behavior on bulk action buttons. (1280x720) |
| Conversations - Default - MultiSelect - Actions - Dark | `d8GQK` | Dark | Dark mode variant of multi-select actions tooltip (1280x720) |
| Conversations - Default - Active - LongThread | `gpELz` | Light | Long email thread — collapsed "Show 3 earlier messages" indicator + visible replies from Alex Johnson and Sarah Mitchell with avatars, timestamps, and indented body text. (1280x720) |
| Conversations - Default - Active - LongThread - Dark | `mNqYK` | Dark | Dark mode variant of long thread state — "Show 3 earlier messages" text uses `$text-tertiary` for dark mode visibility. (1280x720) |
| Conversations - Default - Active - ImagePreview | `zaxa7` | Light | Email with inline images — two image thumbnails (180x120, cornerRadius 8) between email paragraphs showing dashboard and mobile mockups. (1280x720) |
| Conversations - Default - Active - ImagePreview - Dark | `RF3tM` | Dark | Dark mode variant of image preview state (1280x720) |
| Conversations - Default - Active - DocPreview | `kBCTA` | Light | Email with document attachments — two DocPreview component refs (PDF red badge + DOCX blue badge) between email paragraphs. (1280x720) |
| Conversations - Default - Active - DocPreview - Dark | `xGbuQ` | Dark | Dark mode variant of doc preview state (1280x720) |
| Conversations - Default - Loading | `o0NVD` | Light | Full skeleton loading — conversation list shows 4 skeleton rows (avatar circles + text bars), detail panel shows skeleton header + body lines. All using `$surface-disabled` fill. (1280x720) |
| Conversations - Default - Loading - Dark | `ENzg0` | Dark | Dark mode variant of skeleton loading state (1280x720) |
| Conversations - Default - Active - DetailLoading | `y84IB` | Light | Detail panel loading — conversation list shows real data, detail panel shows centered loader-circle icon + "Loading conversation..." text. (1280x720) |
| Conversations - Default - Active - DetailLoading - Dark | `ECNNA` | Dark | Dark mode variant of detail loading state (1280x720) |
| Conversations - Default - Active - ErrorState | `9dMSy` | Light | Detail panel error — conversation list shows real data, detail panel shows triangle-alert icon in `$surface-disabled` container + "Failed to load conversation" title + "Something went wrong" description + "Try again" button (`$button-primary-bg` fill) with refresh-cw icon. (1280x720) |
| Conversations - Default - Active - ErrorState - Dark | `8h9Ux` | Dark | Dark mode variant of error state — icon container uses `$surface-disabled`, retry button uses `$button-primary-bg`/`$button-primary-text` for proper theme switching. (1280x720) |
| Conversations - Default - Active - Forward | `Qra4b` | Light | Forward compose — reply area replaced with forward box: "To:" recipient field + forwarded message metadata + paperclip attach button + "Forward" button (`$button-primary-bg`/`$button-primary-text`) with forward icon. Box styled to match Default-Active reply box: `$border-hover` 1px border, cornerRadius 12, `$surface-primary` fill. (1280x720) |
| Conversations - Default - Active - Forward - Dark | `WYKMt` | Dark | Dark mode variant of forward compose state — Forward button uses `$button-primary-bg` (white in dark) for proper theme switching. (1280x720) |

**Conversations layout notes:**
- Same 48px sidebar as Chat screens, with `inbox` icon active instead of `message-circle`
- Header: "Conversations" title, `$text-primary`, Inter 16px semibold (600), **no bottom border** (tab bar divider serves as the separator)
- Tab bar: Open | Closed | Spam | Archived — uses `Components/Tab/Active` and `Components/Tab/Inactive` refs, horizontal layout, gap 16px, `alignItems: "stretch"`, `$border-primary` 1px bottom border. Active tab's 2px underline rectangle sits flush on the divider line.
- **Setup state**: full-page centered — bare inbox icon (24x24, `$text-tertiary`, no container) + "Activate conversations" title (16px semibold) + description (14px, `$text-tertiary`) + "Connect email" button (`Components/Button/Primary` ref). Clicking button navigates to settings.
- **Split-panel layout** (EmptyState + Default): left panel (396px) = conversation list with search bar (checkbox + search input) + scrollable conversation rows; right panel (836px) = conversation detail or empty state message. Panels separated by `$border-primary` 1px right border on left panel.
- **Conversation list row**: horizontal layout, `fill_container` width, padding `[10, 16]`, gap 10, no corner radius, `alignItems: "start"`, `$border-primary` 1px bottom border as divider. Contains: checkbox (`Components/Checkbox/Default` ref) + Content frame (vertical, `fill_container` width, gap 6) with header row (name group + time), subject line (13px medium), preview text (12px, `$text-tertiary`, `textGrowth: "fixed-width-height"`, height 34px — **max 2 lines**, overflow hidden). Active/selected row: `#F3F4F6` (light) / `#1F2937` (dark) fill. Hover: same fill pattern. Conversation Rows container: gap 0, padding 0.
- **Search bar select dropdown**: horizontal frame (gap 2) with checkbox ref + Lucide `chevron-down` icon (14x14, `$text-tertiary`). Replaces a standalone checkbox because the tabs already handle Open/Closed/Spam/Archived categorization — the dropdown covers the remaining **read-status filtering** (All/Read/Unread) without needing a separate filter button.
  - **Hover**: `#F3F4F6` (light) / `#1F2937` (dark) background fill on the select dropdown frame, cornerRadius 4, padding `[2, 4]`
  - **Open/clicked**: same hover fill stays active, chevron rotates 180° (points up), checkbox changes to indeterminate state (showing filter is active). Dropdown menu appears below (absolutely positioned in Main Content at x:16, y:160).
  - **Dropdown menu**: 140px wide, `$surface-primary` fill, `$border-primary` 1px border, cornerRadius 8, padding `[4, 0]`, double shadow. Contains 3 options (All, Read, Unread) — each is a horizontal frame with `fill_container` width, padding `[6, 12]`, Inter 13px `$text-primary`. Hovered option: `#F3F4F6` (light) / `#1F2937` (dark) fill.
  - **Dropdown menu IDs**: `p0hGy` (light), `6xZRV` (dark)
- **Unread indicator**: New/unread conversations show a 6x6 `#056CFF` (primary blue) ellipse dot next to the sender name. The name + dot are wrapped in a "Name Group" horizontal frame (gap 6, `alignItems: center`). Read conversations have no dot. **The dot clears when the conversation is opened/selected** — all active conversation screens show Sarah Johnson's row without the dot since her conversation is being viewed.
- **Empty search state**: When the user searches and no results match, the conversation list shows a centered empty state: Lucide `search-x` icon (24x24, `$text-tertiary`) + "No results found" (14px semibold, `$text-primary`) + "Try a different search term" (13px, `$text-tertiary`), gap 8px. The search input shows the query text in `$text-primary` with `$border-focus` 1.5px border. The right panel shows the default "No conversation selected" empty state.
- **Multi-select / Bulk action mode**: When multiple conversation checkboxes are checked, the search bar transforms into a **bulk action bar**. The search input is removed and replaced with:
  - **Left group** (horizontal, gap 8, `alignItems: center`): select dropdown (indeterminate checkbox + chevron) + "2 selected" count (13px semibold, `$text-primary`)
  - **Right group** (horizontal, gap 4, `alignItems: center`): 4 **icon-only** action buttons — icon-only keeps the 396px panel uncluttered; tooltips on hover provide labels.
    - **Send** — Lucide `send-horizontal` 16x16, `#056CFF` (light) / `#5098FF` (dark). **Primary CTA** — button has `#EFF6FF` fill (light) / `#1E3A5F` fill (dark) to visually distinguish it from the secondary actions.
    - **Close** — Lucide `mail-x` 16x16, `$text-secondary`
    - **Spam** — Lucide `shield-x` 16x16, `$text-secondary`
    - **Archive** — Lucide `archive` 16x16, `$text-secondary`
  - Each button: 28x28 frame (16px icon + 6px padding), cornerRadius 6, `justifyContent: center`, `alignItems: center`
  - Hover fill: `#F3F4F6` (light) / `#1F2937` (dark) on each button
  - **Tooltips** (bottom variant `ZLBoY`, arrow up, hidden by default): "Send reply", "Close conversation", "Mark as spam", "Archive". Positioned absolutely in Main Content frame at y:138 to avoid clipping.
  - Layout: `justifyContent: "space_between"` between left and right groups
  - Bar container: padding `[10, 16]`, `$border-primary` 1px bottom border
  - Selected rows get highlight fill (`#F3F4F6` light / `#1F2937` dark) + checked checkbox (`Components/Checkbox/Checked` ref)
  - Clicking "Send" opens a bulk reply compose (future state)
  - Clicking indeterminate checkbox deselects all and returns to normal search bar
- **Empty state (right panel)**: centered — message-square-dashed icon (24x24, `$text-tertiary`) + "No conversations yet" / "No conversation selected" title (16px semibold) + description (14px, `$text-tertiary`).
- **Conversation detail (right panel)**: vertical layout, `fill_container` width/height, 3 sections:
  1. **Detail Header**: padding `[16, 24]`, gap 12, `$border-primary` 1px bottom border. Contains:
     - Subject row: `justifyContent: "space_between"` — subject text (16px semibold, `$text-primary`) + action buttons (reply, forward, ellipsis icons — 16x16, `$text-tertiary`, in 6px padded frames with cornerRadius 6, hover fill: `#F3F4F6` light / `#1F2937` dark). Ellipsis opens **context menu** (see below).
     - Sender row: avatar (32x32 circle, `#E5E7EB` light / `#374151` dark, initial letter `#6B7280` light / `#9CA3AF` dark) + sender info (name 13px semibold `$text-primary`, email + timestamp 12px `$text-tertiary`)
  2. **Email Body**: padding `[16, 20]`, gap 16 (gap 12 on formatting screens), `fill_container` height, clipped. Incoming email content is displayed as **flat paragraph text** (not chat bubbles) — this preserves the original email reading experience and keeps the focus on the content. Only the user's **sent reply** uses a chat bubble, creating a clear visual distinction between received email and composed response.
     - **Incoming email text**: flat paragraph `text` nodes, `$text-primary`, Inter 14px, lineHeight 1.6, letterSpacing -0.084, `textGrowth: "fixed-width"`, `fill_container` width. Paragraphs are separate text nodes (e.g., "Hi team,", body paragraph, "Best,\nSarah"). No avatar or bubble wrapper — the detail header already shows sender info.
     - **Rich text in emails** (shown on formatting screens): incoming emails can contain inline bold text and bullet points. Bold keywords use `fontWeight: 700` while the rest of the sentence is `fontWeight: normal` — achieved by placing both text nodes side-by-side in a horizontal frame (gap 0). Bullet items follow the same pattern as the RichText/UnorderedList component: horizontal frame (gap 8, `alignItems: start`), bullet text (`•`, 12px width, `$text-secondary`, `textAlign: right`) + content frame. The response frame (`incoming-response`) uses vertical layout, gap 12, and includes a sender row ("Sarah Johnson · Just now") at the top.
     - **Outgoing reply** (shown on formatting screens only): right-aligned chat bubble for the user's sent response. Vertical frame (`fill_container` width, gap 4, `alignItems: end`). Contains:
       - Sender row: "You" (12px semibold, `$text-primary`) + timestamp (12px, `$text-tertiary`)
       - Bubble: 600px width, cornerRadius `[12, 4, 12, 12]` (top-right sharp = "tail" pointing to sender), `#F3F4F6` light / `#374151` dark, padding `[10, 14]`. Text: 14px, `$text-primary`, lineHeight 1.5, `textGrowth: "fixed-width"`, `fill_container` width. No avatar — "You" label + detail header avatar is sufficient.
  3. **Reply Area**: padding `[12, 16]`, no top border (the Reply Box's own border/shadow provides sufficient visual separation from the email body). Contains a **Reply Box** — mini ChatInput-style compose area:
     - **Reply Box**: cornerRadius 12, `$surface-primary` fill, `$border-hover` 1px border, soft shadow, padding `[10, 14]`, gap 8, vertical layout.
       - **Text area** (top): 40px height, placeholder "Reply to [name]..." in `$text-disabled` 14px, lineHeight 1.5, `textGrowth: "fixed-width"`. Auto-grows as user types.
       - **Formatting toolbar** (middle): horizontal row, gap 0, `alignItems: center`, `fill_container` width, padding `[4, 0, 0, 0]`. Follows **Gmail's compose toolbar pattern** — users are already trained to expect formatting options between the compose area and the send/action bar; placing them here matches existing muscle memory and avoids a learning curve. Contains 5 icon buttons (28x28 each, cornerRadius 6, centered):
         - **Bold** — Lucide `bold` 15x15, `$text-secondary`
         - **Italic** — Lucide `italic` 15x15, `$text-secondary`
         - **Link** — Lucide `link` 15x15, `$text-secondary`
         - **Ordered list** — Lucide `list-ordered` 15x15, `$text-secondary`
         - **Unordered list** — Lucide `list` 15x15, `$text-secondary`
         - Hover fill: `#F3F4F6` light / `#1F2937` dark on each button. Active (toggled on): `#EFF6FF` fill + `#056CFF` icon (light) / `#1E3A5F` fill + `#5098FF` icon (dark).
       - **Bottom bar**: horizontal, `justifyContent: "space_between"`, padding `[4, 0]`.
         - Left: **attach button** (Lucide `plus` 18x18, `$text-secondary`, padding 6, cornerRadius 100) + **AI Rewrite button** (Lucide `wand-sparkles` 16x16, `$text-secondary`, padding 6, cornerRadius 100). Hover fill: `#F3F4F6` light / `#1F2937` dark. **Tooltips** (bottom variant `ZLBoY`, arrow up, hidden by default): "Attach files" on attach button, "Improve with AI" on AI rewrite button.
         - Right: **send button** appears when text is entered (same as ChatInput pattern).
- **Context menu (ellipsis)**: triggered by ellipsis button in detail header. 200px wide, cornerRadius 10, `$surface-primary` fill, `$border-primary` 1px border, double shadow, padding `[4, 0]`. Right-aligned below the ellipsis button. Contains 3 options:
  - **Customer info** — Lucide `user` icon (16x16, `$text-secondary`) + label (13px, `$text-primary`)
  - **Close conversation** — Lucide `mail-x` icon + label
  - **Mark as spam** — Lucide `shield-x` icon + label
  - Each option: horizontal layout, padding `[8, 12]`, gap 10, `alignItems: center`. Hover fill: `#F3F4F6` light / `#1F2937` dark.
  - Context menu IDs: `ArncK` (light), `mwib5` (dark)
- **AI Rewrite active state**: triggered by clicking the wand-sparkles button after typing a draft reply. The reply box transforms to show the AI is improving the user's text in their brand voice:
  - Reply box border changes to focus color: `#056CFF` 1.5px (light) / `#5098FF` 1.5px (dark)
  - Text area expands (height 60, gap 6) and shows:
    - **Shimmer text**: "Improving your reply..." — gradient text (`#9CA3AF` → `#6B7280` → `#9CA3AF` light / `#6B7280` → `#D1D5DB` → `#6B7280` dark), Inter 13px medium, animated sweep
    - **Draft preview**: user's original text shown below at 50% opacity, `$text-tertiary` 13px — so the user can see what's being improved
  - **Wand button** transforms to active pill: `#EFF6FF` fill (light) / `#1E3A5F` (dark), padding `[4, 8]`, shows `#056CFF` / `#5098FF` wand icon + "Improving..." label in matching blue
  - **Stop button** appears on the right side of bottom bar: 28x28 circle, `$button-primary-bg`, Lucide `square` icon 12x12, `$button-primary-text` — same pattern as chat streaming stop button
  - **On completion (in-view)**: Transient success state (~2s):
    - Reply box border reverts to `$border-hover` 1px (normal state)
    - Improved text replaces the shimmer + draft preview in the text area (Inter 14px, `$text-primary`, lineHeight 1.5)
    - Wand button transitions to "Done" pill: `#ECFDF3` fill (light) / `#052E16` (dark), Lucide `check` icon 14x14 + "Done" label in `#057747` (light) / `#12B76A` (dark)
    - Stop button removed
    - After ~2s: wand button returns to default icon-only state
  - **On completion (navigated away)**: If the user switched to a different conversation while the rewrite was processing, a **success toast** appears top-right:
    - Uses existing toast pattern (340px, 12px radius, `$surface-primary`, `$border-primary` 1px, double shadow)
    - Icon: `circle-check` 20x20, `#057747` (light) / `#12B76A` (dark)
    - Title: "Reply improved" (Inter 14px medium, `$text-primary`)
    - Description: "[Sender name] — [Subject line]" (Inter 13px, `$text-secondary`)
    - **View button**: outlined button (cornerRadius 6, `$border-primary` 1px, padding `[4, 10]`), "View" label (Inter 12px medium, `$text-primary`). Clicking navigates to the conversation with the improved reply.
    - Close icon: Lucide `x` 20x20, `$text-tertiary`
    - Auto-dismisses after 5s (success toast behavior)
    - Toast IDs: `jxc4X` (light), `B27pA` (dark)
  - On stop: cancels the rewrite, restores the original draft text

**Chat layout notes:**
- **New chat** (default): Chat input is **558px** wide, centered, with heading + suggestions
- **Conversation view**: Chat input expands to **768px** wide, centered at bottom. Messages constrained to same 768px column.
- User messages: right-aligned, `$gray-100` bubble, 20px corner radius, line-height 1.5
- **User image uploads**: Image preview appears **above** the message bubble (not inside it). 240x160px frame, 12px corner radius, `#E5E7EB` 1px border (light) / `#374151` (dark). Right-aligned to match bubble. 8px gap between image and bubble below.
- **Image drag-and-drop**: When a user drags an image over the chat area, a full overlay covers the main content area. Light: `#FFFFFFEE` overlay. Dark: `#030712EE` overlay. Centered drop zone (400x240, 16px radius) with dashed border (`primary-500`, 2px, dash `[8,6]`), upload icon in a circle, "Drop your image here" title, and file type/size hint. Light drop zone: `#EFF6FF` fill, `#DBEAFE` icon circle, `#056CFF` icon. Dark: `#111827` fill, `#1E3A5F` icon circle, `#5098FF` icon/border.
- AI thinking state: left-aligned, gradient shimmer text, animated with `ShimmeringText` component cycling phrases every 3s
- AI response: left-aligned plain text (line-height 1.6), followed by action icons (copy, info) with `#4B5563` fill
- Action icons: 16x16 Lucide icons (`#4B5563`) in 28x28 containers, 6px corner radius. Hover: `#F3F4F6` bg. Tooltips: "Copy" and "Shows info" (no arrow, hidden by default)
- Copy click: icon swaps from `copy` → `check` (same `#4B5563` color, no hover fill), reverts after ~2s
- Header has **no bottom border** across all screens
- New chat button (square-pen in header) returns to the "What are you working on?" default state
- Suggestion chip text should be varied and realistic (e.g., "Draft a project proposal for Q4", "Analyze last month's revenue trends", "Write a follow-up email to the client") -- avoid generic/identical text across all chips

**Dark mode overrides:**
- Header fill: `$surface-primary` (not `#ffffff66` semi-transparent)
- Header icon fills: `$icon-primary` (not hardcoded `#4B5563`)
- Icon button hover fill: `#1F2937` (gray-800) instead of `#F3F4F6` (gray-100)
- User message bubble: `#1F2937` instead of `$gray-100`
- Action icon fills: `$icon-primary` instead of `#4B5563`
- Action icon hover bg: `#1F2937` instead of `#F3F4F6`
- Shimmer gradient: `#6B7280` → `#D1D5DB` → `#6B7280` (lighter for dark backgrounds)
- Sidebar logo: `#FFFFFF` (matches `$logo-color` dark)
- Sidebar active icon (message-circle): `#FFFFFF`
- Sidebar inactive icons: `#9CA3AF` (gray-400) instead of `#6B7280` (gray-500) for better contrast (~5.5:1 on `#0C1017`)
- Agent selector button fill (active state): `#374151` (gray-700) instead of `$gray-100`

---

## Interaction Behaviors

### Hover Patterns

| Element | Hover Effect |
|---------|-------------|
| Header icon buttons | `#F3F4F6` background fill + tooltip with shortcut |
| Sidebar nav items | Tooltip (no arrow) appears to the right |
| User profile popup rows | `#F3F4F6` background (except name section) |
| Agent selector rows | `#F3F4F6` background |
| Agent selector button | `#F3F4F6` background (also active state when dropdown open) |
| Search modal result rows | `#F3F4F6` background, 8px corner radius |
| Info popover source pills | `#E5E7EB` (gray-200) background — **exception**: default is `$gray-100`, hover is gray-200 |
| Microsoft button | `$surface-hover` fill, `$border-hover` border |
| Primary button | Fill changes from `#030712` to `#111827` |
| User message bubble | Edit (pencil) action row appears below (right-aligned), same pattern as AI response actions |
| AI response actions row | Regenerate (refresh-ccw) icon appears alongside copy/info |
| History sidebar conversation row | Rename (pencil) and delete (trash-2) icons appear right-aligned, row gets hover fill |
| Document card download button | `#F3F4F6` background fill |
| Conversation detail action buttons (reply/forward/more) | `#F3F4F6` background fill, cornerRadius 6 |
| Conversation reply bar buttons (attach/AI rewrite) | `#F3F4F6` background fill, cornerRadius 100 (pill) |
| Context menu rows (conversations) | `#F3F4F6` background on hovered option |
| Select dropdown (conversations) | `#F3F4F6` background fill, cornerRadius 4, padding `[2, 4]` |
| Select dropdown menu rows | `#F3F4F6` background on hovered option |
| Conversation list rows | `#F3F4F6` background fill on hovered row (same as selected row fill). Selected row: persistent `#F3F4F6` fill. Hover + selected: same fill, no additional effect. |
| Bulk action bar buttons (Close/Spam/Archive) | `#F3F4F6` background fill, cornerRadius 6. Icon-only 28x28 buttons; tooltip on hover |
| Bulk action Send button | Already has `#EFF6FF` primary tint (light) / `#1E3A5F` (dark) as primary CTA. Hover: slightly darker tint. Tooltip: "Send reply" |
| Formatting toolbar buttons (reply bar) | `#F3F4F6` background fill, cornerRadius 6. Active/toggled: `#EFF6FF` fill + `#056CFF` icon (light) / `#1E3A5F` fill + `#5098FF` icon (dark) |

**Dark mode hover fill:** Use `#1F2937` (gray-800) instead of `#F3F4F6` (gray-100) for all interactive element hover backgrounds.

### Click/Toggle Interactions

| Trigger | Action |
|---------|--------|
| User profile icon click | Toggle user profile popup |
| Agent selector button click | Opens agent dropdown |
| New chat icon / square-pen (header) | Creates new chat |
| Plus icon (chat input) | Opens file attachment |
| Sidebar nav icons | Navigate to respective section |
| Scroll-to-bottom button | Smooth-scrolls to the latest message in the conversation |
| Clock icon (header) | Opens/closes history sidebar; main content resizes accordingly |
| History sidebar close button | Closes sidebar, restores main content to full width |
| History conversation row click | Navigates to that conversation |
| Select dropdown click (conversations) | Opens dropdown menu with All/Read/Unread options; chevron rotates 180°; checkbox changes to indeterminate. Selecting an option filters the conversation list and closes the dropdown. |
| Ellipsis click (conversation detail) | Opens context menu with Customer info, Close conversation, Mark as spam. Ellipsis button shows active fill. Closes on click outside or selecting an option. |
| "Customer info" context menu option | Opens Customer Info Modal — shows customer status, subscription, date added, locale, source, stats. Closes on X, click outside, or Escape. |
| AI Rewrite button click (reply bar) | Triggers AI rewrite — reply box gets blue focus border, shimmer "Improving your reply..." text + faded draft preview, wand button shows active blue pill with "Improving..." label, stop button appears. On completion: green border flash + "Done" pill (~2s), then reverts to normal. If user navigated away, a success toast with "View" button appears instead. |
| AI Rewrite toast "View" button click | Navigates to the conversation where the AI rewrite completed, showing the improved reply in the reply box. |
| Conversation row checkbox click | Toggles row selection. When 1+ rows are checked, the search bar transforms into the bulk action bar with "N selected" count + Send/Close/Spam/Archive buttons. Indeterminate checkbox in the action bar deselects all and returns to search bar. |
| Bulk action Send button click | Opens a bulk reply compose — sends the same reply to all selected conversations |
| Bulk action Close/Spam/Archive click | Performs the action on all selected conversations. Rows are removed from the list and a success toast confirms (e.g., "2 conversations archived"). |
| Edit icon (user message hover) | Message bubble transforms into editable text area with blue focus border (`$border-focus`), Cancel and "Save & Submit" buttons appear below. Cancel reverts; Save & Submit re-sends the edited message. |
| Regenerate icon (AI response hover) | Re-generates the AI response for this message |
| Try again button (failed response) | Retries the failed AI response generation |
| Copy icon (AI response actions) | Icon swaps from `copy` → `check`, same `#4B5563` color; reverts after ~2s |
| Rename icon (history row hover) | Opens inline rename — conversation title becomes editable |
| Delete icon (history row hover) | Opens delete confirmation modal with Cancel / Delete (red) buttons |

### Popups & Modals (hidden by default)

| Element | ID | Trigger |
|---------|-----|---------|
| User profile popup | `HWed7` | Click on user avatar in sidebar |
| Agent selector dropdown | `wvpKh` | Click on agent selector in chat input |
| Delete confirmation modal | `FHstM` (light overlay) / `5v7ER` (dark overlay), frosted glass blur | Click delete icon on history row hover |
| Customer Info Modal | `ZmTjj` (light), `jKGoe` (dark) | Click sender name/avatar or "Customer info" context menu option |
| All tooltips | Various | Hover on respective element |

---

## Keyboard Shortcuts

| Action | Shortcut | Tooltip Location |
|--------|----------|-----------------|
| History | `⌘H` | Below clock icon in header |
| New Chat | `⌥⌘N` | Below square-pen icon in header |

---

## Dev Notes

### General
- **Font**: Inter throughout the entire app
- **Icons**: Lucide icon font exclusively — no custom SVGs
- **Theming**: All semantic tokens support light/dark via `mode` theme axis. Use CSS variables mapped to the token names.
- **Hover fill pattern**: Consistently `#F3F4F6` (gray-100) across all interactive list items, icon buttons, and selectors. Applied as a disabled fill in design — enable on `:hover` in CSS.

### Chat Input
- Text area starts at **72px** height
- Auto-grows with content up to **200px max height**
- Beyond 200px, the text area becomes **scrollable** (overflow-y: auto)
- Send button appears only when input has content
- Agent selector dropdown is absolutely positioned above the input
- **New chat**: input width **558px** | **Conversation**: input width **768px**

### AI Thinking Shimmer
- Use `ShimmeringText` component with `AnimatePresence` from `motion/react`
- Gradient text: linear gradient `#9CA3AF` → `#6B7280` → `#9CA3AF`, animated sweep
- Phrases cycle every **3 seconds**: "Agent is thinking...", "Processing your request...", "Analyzing the data...", "Generating response...", "Almost there..."
- Transition: fade + slide (opacity 0→1, y 10→0 on enter; opacity 1→0, y 0→-10 on exit), 300ms duration

### Toast Notifications
- Position: **top-right** of the viewport
- Default auto-dismiss: **5 seconds**
- Error toasts: **no auto-dismiss**, require user action (X button)
- Enter animation: fade in + slide down
- Exit animation: fade out + slide up
- Stack toasts vertically with 8px gap if multiple are shown

### Failed Response State

When an AI response generation fails, the following error pattern is displayed in the chat area (left-aligned, same position as a normal AI response):

- **Error icon:** Lucide `triangle-alert`, 16x16, `#EF4444` (red)
- **Error title:** "Something went wrong" -- `#EF4444`, Inter 14px medium
- **Error description:** "There was an error generating a response. Please try again." -- `$text-tertiary`, Inter 13px
- **Try again button:**
  - Content: Lucide `rotate-ccw` icon (14x14) + "Try again" text (Inter 13px medium)
  - Text/icon color: `$text-primary`
  - Border: `$border-primary` 1px
  - Corner radius: 8px
  - Hover fill: `#F3F4F6` (light) / `#374151` (dark)
  - On click: retries the failed AI response generation

### Edit Message State

When the user clicks the edit (pencil) icon on a user message:

- **User message bubble** transforms into an editable text area:
  - Width: 536px, positioned right-aligned in the content area (x: 464 from content edge)
  - Corner radius: 12px
  - Border: `$border-focus` 1.5px (`#056CFF` light / `#5098FF` dark)
  - Fill: `$surface-primary`
  - Text: same content as original message, Inter 14px, `$text-primary`, `textGrowth: fixed-width`
- **Action buttons** below the text area (right-aligned, 8px gap):
  - **Cancel**: `$border-primary` 1px border, `$text-secondary` text, Inter 13px medium, 8px radius, padding `[6, 12]`
  - **Save & Submit**: `$button-primary-bg` fill (`#18181B` light / `#FFFFFF` dark), `$button-primary-text` icon + text, Lucide `corner-down-left` icon (14x14) + "Save & Submit" label, Inter 13px medium, 8px radius, padding `[6, 12]`, gap 6px
- The edit action row (pencil icon) is hidden while editing
- AI response remains visible below with standard action icons (no regenerate icon during edit)
- Cancel: reverts to original message bubble
- Save & Submit: sends the edited message, which replaces the original and triggers a new AI response

### History Sidebar Row Actions

On hover, each conversation row in the history sidebar reveals two action icons (right-aligned):

- **Rename** (Lucide `pencil`, 14x14): `#6B7280` (light) / `#9CA3AF` (dark)
- **Delete** (Lucide `trash-2`, 14x14): `#6B7280` (light) / `#9CA3AF` (dark)
- Icon container: 4px padding, 4px corner radius
- Icon container hover fill: `#E5E7EB` (light) / `#374151` (dark), disabled by default
- Row layout changes to `justifyContent: space_between` to push actions right
- Row gets hover fill: `#F3F4F6` (light) / `#1F2937` (dark)

### Delete Confirmation Modal

- **Overlay**: `#00000066` (light) / `#030712CC` (dark), full screen 1280x720, **backdrop blur** (`background_blur`, radius 8px)
- **Modal**: 360px wide, `$surface-primary` fill, `$border-primary` 1px border, 12px corner radius
  - Shadow: outer, `#0000001A` (light) / `#00000066` (dark), offset y:8, blur 24
  - Padding: 24px, gap 16px
- **Title**: "Delete conversation", Inter 16px semibold, `$text-primary`
- **Description**: "Are you sure you want to delete \"[conversation name]\"? This action cannot be undone.", Inter 14px, `$text-secondary`, line-height 1.5
- **Buttons** (right-aligned, 8px gap):
  - **Cancel**: `$border-primary` 1px border, `$text-secondary` text, Inter 14px medium, 8px radius, padding `[8, 16]`
  - **Delete**: `#DC2626` fill, white text, Inter 14px medium, 8px radius, padding `[8, 16]`

### Streaming Response

When the AI is actively generating a response (after the thinking/shimmer phase):

- Partial text streams in progressively, using the same styling as the completed response (`$text-primary`, Inter 14px, line-height 1.6)
- A **blinking cursor** (2x18px rectangle, `$text-primary`, 1px corner radius) appears at the end of the streamed text
- Action icons (copy, info) are **hidden** during streaming — they appear only after the response is complete
- The cursor blinks with a CSS animation: `opacity 0 → 1` at 530ms interval
- Chat input remains interactive during streaming (user can type next message)
- **Stop button**: During streaming, the send button in the chat input is replaced with a stop button:
  - 32x32 circle (`cornerRadius: 9999`), `$button-primary-bg` fill (`#030712` light / `#FFFFFF` dark)
  - Lucide `square` icon, 14x14, `$button-primary-text` fill (`#FFFFFF` light / `#030712` dark)
  - Positioned right-aligned in the chat input bottom bar (next to agent selector)
  - On click: stops the streaming response, leaving partial text visible with action icons appearing

### Generated Document Response

When the AI generates a document, it renders the **full document content as rich text** directly in the chat (headings, paragraphs, lists — same styling as any other rich text response). This lets users read, review, and give feedback without leaving the conversation. A compact **download card** sits at the bottom for exporting.

**Response structure** (top to bottom):
1. Short intro line (e.g., "Here's the project proposal for the Q4 product launch:")
2. Document content as rich text (H2 title, paragraphs, H3 sections, ordered lists — using standard rich text components)
3. Action icons (copy, info)
4. Download card

**Download card:**
- Horizontal layout, `fill_container` width, 12px corner radius, gap 12, padding `[12, 16]`, `alignItems: center`
  - Fill: `$surface-primary`, border: `$border-primary` 1px
  - Shadow: outer, `#0000000A` (light) / `#0000001A` (dark), offset y:2, blur 4
- **File icon**: 36x36 frame, 8px corner radius, centered layout
  - Light: `#EFF6FF` fill, Lucide `file-text` 18x18, `#2563EB` fill
  - Dark: `#1E3A5F` fill, Lucide `file-text` 18x18, `#5098FF` fill
- **File info** (vertical, gap 1, `fill_container` width):
  - Filename: Inter 13px medium, `$text-primary` (e.g., "Q4 Product Launch Proposal.pdf")
  - Metadata: Inter 11px, `$text-tertiary` (e.g., "PDF · 4 pages · 128 KB")
- **Download button**: 8px padding, 8px corner radius, `$border-primary` 1px border
  - Lucide `download` icon 16x16, `#4B5563` (light) / `$icon-primary` (dark)
  - Hover fill: `#F3F4F6` (light) / `#1F2937` (dark), disabled by default

**Screen size:** 1280x1100 (taller than standard 720 to accommodate document content)

**Behavior:**
- Users can read the full document inline and give iterative feedback ("change the budget section", "add a risk assessment")
- Download button exports the document as a file
- Card supports various file types (PDF, DOCX, etc.) — icon and metadata adapt accordingly

---

### Tooltips
- Show on hover with **~200ms delay**
- Hide on mouse leave with **~100ms delay**
- Never show on click — hover only
- Position varies: sidebar items use no-arrow to the right; header items show below with shortcuts
- **Reply bar tooltips**: bottom variant (`ZLBoY`, arrow up) — "Attach files" on attach button, "Improve with AI" on AI rewrite button. Positioned absolutely in the Main Content frame (not inside the reply box) to avoid clipping. Hidden by default (`enabled: false`).
- **Bulk action bar tooltips**: bottom variant (`ZLBoY`, arrow up) — "Send reply", "Close conversation", "Mark as spam", "Archive". Positioned absolutely in Main Content at y:138. Hidden by default (`enabled: false`).

---

## Knowledge

The Knowledge section manages a user's uploaded documents and crawled websites that feed the AI assistant's knowledge base. Accessed via sidebar icon, it uses a tabbed layout: Documents, Websites, Products, Customers, Vendors.

### Canvas Organization

| Container Frame | ID | Contents |
|----------------|-----|----------|
| `--- Pages/Knowledge ---` | `DCNid` | All Knowledge screens — light on top row, dark on bottom row (y+820) |

### Components

#### FilterDropdown

Reusable filter panel that appears below the toolbar when the "Filter" button is clicked. Three state variants:

| Variant | ID | Description |
|---------|-----|-------------|
| Collapsed | `su0rz` | Default open state — "Filters" title, collapsible "Status" and "Interval" rows with chevron-right |
| Expanded | `42fFR` | One section open — section header shows neutral "N selected" badge + chevron-down, checkbox options visible. "Clear all" action in header. |
| Selected | `VKlSB` | All sections collapsed with neutral "N selected" badges on each row. "Clear all" action in header. |
| Products/Collapsed | `kkBNZ` | Ref instance of Collapsed with single "Status" row, explicit height 91px (Interval row + divider hidden) |
| Products/Expanded | `Vxo2d` | Ref instance of Expanded with Status options: Active, Inactive, Draft, Archived (Active + Inactive checked). Height 247px, Interval row hidden. |
| Products/Selected | `ku1XK` | Ref instance of Selected with Status "2 selected" badge. Height 93px, Interval row hidden. |

**Structure:**
- Width: 260px, cornerRadius: 10, `$surface-primary` fill, `$border-primary` 1px border
- Shadow: double outer (`#0000001A` blur 12 + `#0000000D` blur 4). Dark mode: `#00000066` blur 12 + `#00000033` blur 4
- Header: padding `[16, 16]`, `justifyContent: space_between`
  - Title: "Filters", Inter 14px semibold, `$text-primary`
  - "Clear all": Inter 13px medium, `$badge-text` (blue) — only visible when selections exist
- Section rows: padding `[12, 16]`, `justifyContent: space_between`
  - Label: Inter 13px medium, `$text-secondary` (e.g., "Status", "Interval")
  - Right side: neutral badge (`$surface-active` fill, `$text-secondary` text, cornerRadius 6) + chevron icon (`$text-tertiary`)
- Dividers: 1px `$border-primary` between all sections
- Checkbox options: padding `[8, 10]`, gap 10, cornerRadius 6
  - Checked rows: `$surface-active` background fill
  - Unchecked rows: no fill
  - Checkbox refs: `mxvM9` (checked), `7hnOB` (unchecked)
  - Label: Inter 13px normal, `$text-primary`

**Filter button (in toolbar):**
- Default: `$surface-primary` fill, `$border-hover` 1px stroke, cornerRadius 8, shadow, Lucide `list-filter` 16x16 `$text-tertiary` + "Filter" Inter 14px `$text-secondary`
- Active (dropdown open): `$surface-active` fill, `$border-primary` stroke
- Filters applied: blue dot indicator (8x8 `$badge-text` ellipse) at top-right corner

**Design decisions:**
- Badges use neutral style (`$surface-active` / `$text-secondary`) not blue — the count is metadata, not an action. Blue is reserved for "Clear all" interactive text.
- Labels use sentence case ("Status", "Interval") not uppercase — softer, more readable in a compact dropdown.
- Badge + chevron are always right-aligned together as a unit; label is always left-aligned. Consistent across collapsed and expanded states.

### Documents Screens

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Documents (empty) | `emGIH` | Light | Empty state — centered file icon + "No documents yet" + "Upload documents to train your AI assistant" + "Upload documents" CTA button |
| Documents (empty) - Dark | `EW3no` | Dark | Dark variant |
| Documents-Default | `uot1F` | Light | Table with 4 sample docs — columns: Document, Size, Source, RAG status, Teams, Uploaded by, Modified. Search bar + "Upload document" button in toolbar |
| Documents-Default - Dark | `UjeeZ` | Dark | Dark variant |
| Documents-ContextMenu | `6dGyl` | Light | Right-click context menu on row — View (eye), Reindex, Manage teams, Delete (red) |
| Documents-ContextMenu - Dark | `9iJuS` | Dark | Dark variant |
| Documents-View | `bvyHE` | Light | Document preview modal — split layout: left pane shows rendered document page (white page on `#F8F8F8` bg) with page navigation (prev/next + "Page 1 of 12"), right sidebar shows metadata (Document, Size, Source, RAG status badge, Teams, Uploaded by, Modified) with divider separations. Header: "Document preview" + Download button + Close X. No Edit button — documents are uploaded files, not editable. Dialog 780x640, cornerRadius 16 |
| Documents-View - Dark | `SylgH` | Dark | Dark variant |
| Documents-Delete | `ENebl` | Light | Delete confirmation modal — "Delete document" / "Are you sure you want to delete this document? This action cannot be undone." / Cancel + red Delete button |
| Documents-Delete - Dark | `8PifU` | Dark | Dark variant |
| Documents-ManageTeams | `vlJKT` | Light | Manage teams modal — "Manage teams" / subtitle showing doc name / team list with checkboxes / "Save changes" button |
| Documents-ManageTeams - Dark | `lVKif` | Dark | Dark variant |
| Documents-ManageTeams-Empty | `FsFRg` | Light | Manage teams modal with no teams — empty state with people icon + "No teams yet" + "Create teams in Settings..." + "Go to Settings" link |
| Documents-ManageTeams-Empty - Dark | `nKFcU` | Dark | Dark variant |
| Documents-Loading | `X5jBQ` | Light | Skeleton loading state — table header visible, row content replaced with rounded skeleton bars (`$surface-disabled` fill, cornerRadius 4, height 12, varying widths per column) |
| Documents-Loading - Dark | `jGvTZ` | Dark | Dark variant |
| Documents-EmptySearch | `e4KAC` | Light | Empty search results — search input shows "xyz123", table has header + centered empty state: search-x icon (32x32, `$text-disabled`) + "No results found" (14px medium, `$text-secondary`) + "Try adjusting your search or filters" (13px, `$text-tertiary`) |
| Documents-EmptySearch - Dark | `tnRkv` | Dark | Dark variant |
| Documents-FilterCollapsed | `TyTAZ` | Light | Filter dropdown open — collapsed state. Uses `FilterDropdown/Documents/Collapsed` component ref |
| Documents-FilterCollapsed - Dark | `XzV5V` | Dark | Dark variant |
| Documents-FilterExpanded | `CoQnq` | Light | Filter dropdown — RAG status section expanded with checkboxes (Indexed + Failed checked). Uses `FilterDropdown/Documents/Expanded` component ref |
| Documents-FilterExpanded - Dark | `kt3jE` | Dark | Dark variant |
| Documents-FilterSelected | `n5PzR` | Light | Filter dropdown — all sections collapsed with selection count badges. Blue dot on filter button. Uses `FilterDropdown/Documents/Selected` component ref |
| Documents-FilterSelected - Dark | `JCf7T` | Dark | Dark variant |

**Table columns:** Document (file-text icon + name), Size, Source (Upload/API), RAG status (badge: Indexed/Processing/Reindexing/Failed), Teams, Uploaded by, Modified (chevron-down sort indicator)

**Context menu:** 4 options — View (eye icon), Reindex (refresh-cw icon), Manage teams (users icon), Delete (trash-2 icon, red `#DC2626`). No divider — red text is sufficient. Width 180px, cornerRadius 10, padding `[4, 0]`.

### Websites Screens

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Websites (empty) | `Dg9Li` | Light | Empty state — centered globe icon + "Add websites" + "Add website URLs to crawl and index for your AI assistant" + "Add website" CTA button |
| Websites (empty) - Dark | `QFoXH` | Dark | Dark variant |
| Websites-Default | `veby2` | Light | Table with 4 sample websites — columns: Website, Status, Title, Description, Indexed, Scanned, Interval. Search + Filter button + "Add website" in toolbar |
| Websites-Default - Dark | `wb7RD` | Dark | Dark variant |
| Websites-ContextMenu | `N3ibn` | Light | Right-click context menu on row 1 — View (eye), Edit (pencil), Delete (trash-2, red). Row 1 highlighted with `$surface-active` |
| Websites-ContextMenu - Dark | `Li1Um` | Dark | Dark variant |
| Websites-View | `5nLLK` | Light | View modal — "Website details" / read-only fields: URL, Status (badge), Title, Indexed pages, Last scanned, Scan interval, Description (full-width paragraph at bottom) |
| Websites-View - Dark | `A57JR` | Dark | Dark variant |
| Websites-Delete | `wGncz` | Light | Delete confirmation — "Delete website" / mentions URL + "All indexed pages will be removed" / Cancel + red Delete |
| Websites-Delete - Dark | `G0D1Y` | Dark | Dark variant |
| Websites-Edit | `wNpvl` | Light | Edit modal — "Edit website" / Domain input (pre-filled) + Scan interval dropdown (expanded, showing 7 options from "Every 1 hour" to "Every 30 days") / Cancel + "Save changes" |
| Websites-Edit - Dark | `AQ5in` | Dark | Dark variant |
| Websites-Add | `hgRGt` | Light | Add modal — "Add website" / Domain input (placeholder "Enter domain") + Scan interval dropdown (placeholder "Select interval") / Cancel + "Add website" button |
| Websites-Add - Dark | `PcFyb` | Dark | Dark variant |
| Websites-FilterCollapsed | `daywW` | Light | Filter dropdown open — collapsed state, no selections. Uses `FilterDropdown/Collapsed` component ref |
| Websites-FilterCollapsed - Dark | `KGSax` | Dark | Dark variant |
| Websites-FilterExpanded | `1NZua` | Light | Filter dropdown — Status section expanded with checkboxes (Active + Scanning checked). Uses `FilterDropdown/Expanded` component ref |
| Websites-FilterExpanded - Dark | `wtuJg` | Dark | Dark variant |
| Websites-FilterSelected | `HVdrz` | Light | Filter dropdown — all sections collapsed with selection count badges. Uses `FilterDropdown/Selected` component ref |
| Websites-FilterSelected - Dark | `QLS9V` | Dark | Dark variant |
| Websites-Loading | `E5btD` | Light | Skeleton loading state — table header visible, row content replaced with skeleton bars |
| Websites-Loading - Dark | `jFSZS` | Dark | Dark variant |
| Websites-EmptySearch | `38L6s` | Light | Empty search results — same pattern as Documents-EmptySearch |
| Websites-EmptySearch - Dark | `sQ81P` | Dark | Dark variant |

**Table columns:** Website (globe icon + URL), Status (badge: Active/Scanning/Paused/Error), Title, Description, Indexed (count), Scanned (date, chevron-down sort indicator), Interval (short: 7d, 1d, 30d)

**Context menu:** 3 options — View (eye icon), Edit (pencil icon), Delete (trash-2 icon, red `#DC2626`). Width 180px, cornerRadius 10, padding `[4, 0]`.

**Modals:** All 384px width, padding 24, gap 20. Dark mode modal shadows use `#00000066` instead of `#0000001A`.

**Scan interval options (long format, used in dropdowns/modals):** Every 1 hour, Every 6 hours, Every 12 hours, Every 1 day, Every 5 days, Every 7 days, Every 30 days

**Scan interval (short format, used in table):** 1h, 6h, 12h, 1d, 5d, 7d, 30d

### Design Tokens (Knowledge-specific)

| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `$badge-bg` | `#EFF6FF` | `#0C2D5E` | Blue badge background (send-action style) |
| `$badge-text` | `#056CFF` | `#5098FF` | Blue badge/action text |
| `$surface-disabled` | `#F9FAFB` | `#111827` | Table header background (3-tier: rows < header < hover) |

**Dark mode table contrast tiers:**
- Table rows: `$surface-primary` (`#030712`)
- Table header: `$surface-disabled` (`#111827`)
- Hover/active row: `$surface-active` (`#1F2937`)

### Products Screens

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Products (empty) | `LZYs5` | Light | Empty state — centered package icon + "Add products" + "Import your product catalog to help your AI assistant" + "Import products" CTA button |
| Products (empty) - Dark | `d1KlZ` | Dark | Dark variant |
| Products-Default | `WnswJ` | Light | Table with 4 sample products — columns: Product, Description, Stock, Updated. Search + Filter + "Import products" in toolbar |
| Products-Default - Dark | `xaxrn` | Dark | Dark variant |
| Products-ContextMenu | `iiWD6` | Light | Ellipsis context menu on row — View (eye), Edit (pencil), Delete (trash-2, red). No divider — red text is sufficient to distinguish destructive action |
| Products-ContextMenu - Dark | `iUWmQ` | Dark | Dark variant |
| Products-View | `iJGZ2` | Light | View modal — "Product details" with Edit button + close X. Fields: Image (64x64 thumbnail), Product, Product ID, Status (Active/Inactive badge), Category, Price, Stock, Updated. Description shown as full-width paragraph section (label on top, text below) for better readability of long text |
| Products-View - Dark | `Z3ttz` | Dark | Dark variant |
| Products-Edit | `1oENo` | Light | Edit modal — "Edit product" with Cancel + "Save changes" buttons. Form fields: Product name (text input), Description (textarea), Image URL (text input), Price + Currency side by side (text input + dropdown), Stock (text input), Category (dropdown) |
| Products-Edit - Dark | `UuTs9` | Dark | Dark variant |
| Products-Delete | `ucIzM` | Light | Delete confirmation — "Delete product" / "Are you sure you want to delete this product? This action cannot be undone." / Cancel + red Delete |
| Products-Delete - Dark | `mUt1G` | Dark | Dark variant |
| Products-FilterCollapsed | `swZSu` | Light | Filter dropdown open — collapsed state with single "Status" row. Uses `FilterDropdown/Products/Collapsed` component ref |
| Products-FilterCollapsed - Dark | `TMK98` | Dark | Dark variant |
| Products-FilterExpanded | `1q3ZD` | Light | Filter dropdown — Status section expanded with checkboxes (Active + Inactive checked, Draft + Archived unchecked). Uses `FilterDropdown/Products/Expanded` component ref |
| Products-FilterExpanded - Dark | `vCcHQ` | Dark | Dark variant |
| Products-FilterSelected | `SbkJ1` | Light | Filter dropdown — Status row collapsed with "2 selected" badge. Uses `FilterDropdown/Products/Selected` component ref |
| Products-FilterSelected - Dark | `0xG4o` | Dark | Dark variant |

**Table columns:** Product (product image thumbnail 36x36 cornerRadius 6 + name), Description (300px, wrapping text), Stock (80px, right-aligned numbers), Updated (120px, chevron-down sort indicator), Actions (ellipsis)

**Product column:** Uses product image thumbnails instead of icons — products are visual items, so showing the actual image helps users identify them quickly.

**Stock column:** Numbers are right-aligned — standard convention for numeric data in tables, makes values easier to compare at a glance.

**Context menu:** 3 options — View (eye icon), Edit (pencil icon), Delete (trash-2 icon, red `#DC2626`). Width 160px, cornerRadius 10, padding `[4, 0]`. No divider line before Delete — the red color already distinguishes the destructive action.

**View modal:** 420px width, padding 24, gap 20, cornerRadius 16. Includes a Status field (Active/Inactive) using the Success badge component after Product ID. Description is rendered as a full-width block (label on top, paragraph text below spanning full width) rather than a label-value row — descriptions can be long and right-aligned wrapping text creates awkward layouts.

**Edit modal:** 440px width (wider than standard 384px to fit side-by-side Price + Currency fields), padding 24, gap 20, cornerRadius 16. Form fields pre-populated with current product data. Price (fill_container) and Currency (140px dropdown) sit side-by-side in a horizontal row with gap 12. Cancel + "Save changes" primary button in footer. Product name field has a red `#DC2626` asterisk indicating it's required.

**Row click behavior:** Clicking a product row opens the View modal directly (no row highlight needed — the overlay dims the background, making it clear which context you're in).

**Filter section:** Status (Active, Inactive, Draft, Archived). Single section only — products don't have multi-axis filtering like Documents (RAG status + Source + Teams) or Websites (Status + Interval). Filter dropdown positioned at x:304, y:164 inside Main Content (directly below the Filter button in the toolbar). Uses `FilterDropdown/Products/*` component refs which hide the Interval row from the base FilterDropdown.

### Customers Screens

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Customers (empty) | `M26Cl` | Light | Empty state — centered users icon + "No customers yet" + "Import your customer data to help your AI assistant" + "Import customers" CTA button |
| Customers (empty) - Dark | `tNSPr` | Dark | Dark variant |
| Customers-Default | `WkpvN` | Light | Table with 4 sample customers — columns: Name (200px), Status (100px), Source (fill_container), Created (220px), Actions (44px). Search + "Import customers" in toolbar. Built from Websites template with 3 blank spacer columns |
| Customers-Default - Dark | `5yAjf` | Dark | Dark variant |
| Customers-ContextMenu | `Rfrbj` | Light | Ellipsis context menu on row — View (eye), Edit (pencil), Delete (trash-2, red). Context menu positioned at x:1026, y:260 |
| Customers-ContextMenu - Dark | `WYnJL` | Dark | Dark variant |
| Customers-View | `OzjZP` | Light | View modal — "Customer details" with Edit button + close X. Fields: Avatar (48x48 circle, #E0E7FF fill, #4F46E5 initials "SJ"), Name, Email, Status (Active badge), Source, Created, Phone, Last active, Notes (full-width paragraph section) |
| Customers-View - Dark | `8HltV` | Dark | Dark variant |
| Customers-Edit | `yqNdt` | Light | Edit modal — "Edit customer" with Cancel + "Save changes" buttons. Form fields: Name (text input, required *), Notes (textarea), Email (text input), Phone (text input), Source (text input), Status (dropdown with "Active") |
| Customers-Edit - Dark | `IjSHy` | Dark | Dark variant |
| Customers-Delete | `ujXWt` | Light | Delete confirmation — "Delete customer" / "Are you sure you want to delete this customer? This action cannot be undone and all associated data will be permanently removed." / Cancel + red Delete |
| Customers-Delete - Dark | `zkm0u` | Dark | Dark variant |

**Table columns:** Name (200px, user icon + name), Status (100px, Active/Inactive badge), Source (fill_container, Import/API/Manual), Created (220px), + 3 blank spacer columns (100px, 120px, 100px inherited from Websites template), Actions (44px, ellipsis)

**Status badges:** Active uses green (`#DCFCE7` fill, `#15803D` text), Inactive uses gray (`#F3F4F6` fill, `#6B7280` text). Badges override the fill color on existing badge component instances rather than changing the ref type.

**Context menu:** 3 options — View (eye icon), Edit (pencil icon), Delete (trash-2 icon, red `#DC2626`). Same pattern as Products context menu (160px width).

**View modal:** 420px width, padding 20, gap 20, cornerRadius 16. Avatar circle (48x48, `#E0E7FF` fill, `#4F46E5` initials text). Rows: Avatar, Name, Email, Status, Source, Created, Phone, Last active, Notes (full-width paragraph section). Includes Edit button + Close X in header.

**Edit modal:** 440px width (matches Products-Edit), padding 20, gap 20, cornerRadius 16. Name field has red `#DC2626` asterisk indicating required. Fields: Name (text input), Notes (textarea), Email (text input), Phone (text input), Source (text input), Status (dropdown). Cancel + "Save changes" primary button in footer.

**Row click behavior:** Same as Products — clicking a customer row opens the View modal directly.

### Vendors Screens

| Screen | ID | Theme | Description |
|--------|-----|-------|-------------|
| Vendors | `LB0UF` | Light | Vendors tab content |
| Vendors - Dark | `JjfJN` | Dark | Dark variant |

### Interaction Behaviors (Knowledge)

**Filter workflow:**
1. User clicks "Filter" button in toolbar → dropdown opens (Collapsed state)
2. User clicks a section row → section expands showing checkbox options (Expanded state)
3. User checks/unchecks options → badge count updates, "Clear all" appears in header
4. User clicks section header again → section collapses, badge remains (Selected state)
5. User clicks outside dropdown → dropdown closes
6. Active filter indicator (blue dot) appears on toolbar filter button when any filters are applied

**Context menu trigger:** Right-click on any table row, or click the `...` (ellipsis) icon in the Actions column. Row highlights with `$surface-active` on hover/right-click.

**Row click behavior:** Clicking any table row in Documents, Websites, Products, or Customers opens the View modal directly. No row highlight is applied — the modal overlay already provides sufficient visual context. The ellipsis menu still exists for accessing context-specific actions (Edit, Delete, Reindex, Manage teams, etc.).

**Sort indicators:** Active sort column shows a chevron-down icon (Lucide `chevron-down`, 14x14, `$text-tertiary`) next to the column header text. Chevron-down is the standard convention used by modern table UIs (Shadcn, Notion, GitHub). Currently applied to: Documents "Modified", Websites "Scanned", Products "Updated".

**Modal patterns:**
- All modals use `$overlay-bg` backdrop with background blur
- Standard DialogSlot width: **384px** (centered at x:448). Exceptions: Products-View 420px, Products-Edit 440px (side-by-side fields), Documents-View 780px (split preview layout)
- Close: X button (top-right) — present on all modals via the `ModalOverlay` base component
- Cancel button for confirmation/form modals
- Destructive actions: red `#DC2626` button with white text
- Primary actions: `$button-primary-bg` button, text uses `$button-primary-text` for proper light/dark contrast
- View modals include an "Edit" button in the header (pencil icon + "Edit" text, `$border-hover` stroke, subtle shadow) — opens the Edit modal
- Edit modals use form inputs pre-populated with current data, Cancel + primary "Save changes" button
- No row highlight needed when modal is open — the overlay dims the background sufficiently

**Context menu design decisions:**
- No divider line before Delete option — the red text (`#DC2626`) already clearly distinguishes the destructive action. Adding a divider would be redundant.
- Products context menu: View, Edit, Delete (160px width)
- Documents context menu: View, Reindex, Manage teams, Delete (180px width)
- Websites context menu: View, Edit, Delete (180px width)
- Customers context menu: View, Edit, Delete (same pattern as Products)

**Long text in modals:** For fields that can contain long text (e.g., product descriptions, website descriptions), use a full-width section layout (label on top, text below spanning full width) rather than side-by-side label-value rows. This prevents awkward right-aligned text wrapping. Applied in Products-View and Websites-View modals.
