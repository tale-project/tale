---
title: Install as app
description: How to install Tale as a Progressive Web App on desktop and mobile — the menu shortcut on Chromium browsers, the iOS Safari path, and what changes once the app is installed.
---

Tale ships as a Progressive Web App. Installing it puts an icon on your dock or home screen, runs Tale in its own window without browser chrome, and keeps the same session you had in the browser. There is no separate native build to download and no extension to install — the same URL you sign in with is the same app, in a standalone shell.

This page covers the three places you trigger the install: the **Get app** row in your profile menu on Chromium browsers, the share-sheet step on iOS Safari, and the install banner Android Chrome surfaces on its own. Once installed, Tale behaves identically; the install only changes the chrome around it.

## The profile-menu shortcut

On Chrome, Edge, Brave, Arc, and the other Chromium browsers, Tale's profile dropdown carries a **Get app** row when the browser is willing to install. Open the menu from your avatar in the top-right, scroll past the theme switcher and the language switcher, and click **Get app**. The browser opens its native install confirmation; accept it, and Tale lands in your dock (macOS), your taskbar (Windows), or your apps list (ChromeOS) within a second or two.

The row is only there when the browser fired its `beforeinstallprompt` event and the app is not already installed. Browsers that do not fire that event — Firefox, Safari, anything in a private window — do not show the row, so the menu stays one item shorter rather than asking for something it cannot deliver.

## iOS and iPadOS

iOS Safari does not fire `beforeinstallprompt`, so the **Get app** row does not appear in the menu. The install path lives in Safari's share sheet instead.

Open Tale in Safari, tap the share icon in the toolbar, scroll down to **Add to Home Screen**, and confirm. Tale appears on your home screen with the same icon as the browser favicon. Tap it, and Tale opens in its own window — no Safari address bar, no tab strip, no back button beyond what Tale itself surfaces. Notifications work the same way they do in the browser tab; the install is the only difference.

Other iOS browsers — Chrome, Edge, Firefox on iOS — are Safari under the hood. They do not have an Add-to-Home-Screen entry of their own. The Safari path is the only iOS install path that produces a real standalone app.

## Android

Android Chrome handles installation in two places. The first is the same **Get app** row in Tale's profile menu, identical to the desktop flow. The second is Chrome's own install banner — a one-line bar that slides up from the bottom of the page on sites it considers installable. Tap **Install** on the banner, confirm in the system sheet, and Tale lands on your home screen.

If you dismissed the banner once, it usually does not come back for a while. The profile-menu shortcut keeps working whether or not the banner has been shown. Other Android browsers — Firefox, Samsung Internet, Brave — each have their own install path under their browser menu, typically labelled **Install app** or **Add to Home Screen**.

## After installing

Tale running in a PWA window is the same Tale running in a browser tab. The session, the chats, the knowledge base, the agents — all of it is the same surface. The differences are cosmetic and small: no browser chrome around the app window, an icon in your launcher, and on most platforms the window remembers its size and position between launches.

Uninstalling follows the platform convention. On macOS, drag the icon out of the dock; on Windows, right-click and uninstall; on iOS and Android, long-press the icon and remove. Uninstalling clears the PWA shell but not the session — sign back in through the browser, and your data is where you left it.

## When to reach for it

The install is worth it once you find yourself opening Tale every day and want it to feel like one of your apps rather than one of your tabs. It is also the right move when you want the chat window pinned to a virtual desktop or a stage-manager slot that browser tabs would not respect. Skip the install if you sign in from many machines and prefer the browser tab — Tale works the same way either way. The neighbouring read is [Member overview](/platform/member/overview) — it is the map of what the rest of the Member surface covers once Tale is sitting in your dock.
