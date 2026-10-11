---
title: Branding
description: Change the organization logo, tab icons, and accent color, and understand when changes apply.
---

Give an organization its own logo, browser-tab icons, and accent color under **Settings > Branding**. Owners and Admins can edit these settings. They apply to the organization you have open, so check the organization name before changing shared branding.

<Frame caption="Settings > Branding — the logo, favicon, and colour controls beside a live preview of the sidebar.">

![The Branding settings page with logo and favicon uploads, an accent colour field, and a live preview pane on the right.](/images/platform/settings-branding.webp)

</Frame>

## Choose the assets

| Setting | What to prepare |
| --- | --- |
| **Logo** | A mark that stays readable at sidebar size and works on light and dark backgrounds. SVG is preferred; raster images should be at least 64 × 64 pixels. |
| **Favicon** | A small, recognizable tab icon. You can provide separate light and dark variants. |
| **Accent color** | Your brand's hex color, then a visual check in both themes. Tale derives the displayed palette for the current theme. |

The organization name supplies the text wordmark when there is no logo. Change that name under **Settings > Organization**; there is no separate application-name field on Branding.

## Upload a logo or favicon

Use the corresponding upload field and select the image. Uploading or removing an image takes effect immediately; it is not held until you select Save. The preview and organization branding refresh after the operation succeeds.

When no explicit favicon is configured, Tale can derive one from the uploaded logo. If someone chooses a favicon while Tale is still deriving one, on this page or in another window, that choice stays and the derived favicon is not saved. Provide an explicit icon when the full logo becomes hard to recognize at tab size. Check the tab icon and sidebar after uploading, including in the other theme.

<Note>

The header's Discard action applies to pending form edits. It does not undo an image that has already been uploaded or removed.

</Note>

## Change the accent color

Edit **Accent color** and inspect the preview. Select **Save** in the settings header to persist the change, or **Discard** to return to the saved value. The color field reflects the current theme, so a derived dark-theme color may differ from the stored light-theme value. The preview shows the color as it will look once saved, so in the dark theme it can differ from the value in the field. Saving a change, uploading an image or removing one each leave a row in the audit log under **Settings > Governance > Logs**.

If the branding changes after you opened the page, because someone saves it, uploads an image or resets it in another window, your **Save** is refused instead of overwriting that change, and your edit stays in the field. Select **Discard** to load the current branding, then make your change again.

Buttons keep your color as closely as legibility allows. Other marks drawn in the accent use your color only where it reads as text on the page. Where it does not, Tale uses a deeper shade of it, or a lighter one in the dark theme. These marks include a link, a mention, a source reference, the selected navigation item, an unread dot, the keyboard focus ring, a switch that is on, and a progress bar. A mid-tone color can therefore look slightly different on a link or a switch than on a button.

After saving, reload the page and check a selected navigation item, a button, and keyboard focus. A color that looks good as a large swatch may be hard to recognize in a small control.

## Check where branding appears

Organization branding applies inside that workspace. Switching organizations loads the destination organization's branding. Sign-in screens appear before an organization is selected and use the platform's default branding.

If you still see an old browser icon, reload the page and check the explicit favicon fields. An explicit favicon takes precedence over one derived from the logo. Use **Reset** only when you intend to remove the organization's configured branding, and read the confirmation first. Confirming takes effect immediately: the images are deleted and the cleared accent color is saved, so no further **Save** is needed and nothing is left unsaved. A **Save** you selected before the reset cannot bring the earlier values back once the reset is done.
