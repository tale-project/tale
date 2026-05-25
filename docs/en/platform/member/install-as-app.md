---
title: Install Tale as an app
description: Install Tale on your phone or laptop as a Progressive Web App. The installed version runs in its own window, shows up in the home screen or Dock, and is the recommended way to use Tale on mobile.
---

Tale is a Progressive Web App, which means your browser can install it as a standalone application. The installed version opens in its own window without the address bar, lives on your home screen or in the Dock, and on mobile feels indistinguishable from a native app — the same bottom tab bar, the same safe-area-aware chrome, the same gestures. There is nothing to download from an app store; the install is a single tap or click inside the browser you already use to sign in to Tale.

This page walks you through installing Tale on iOS, Android, and desktop. The capabilities of the installed version are identical on every platform: you stay signed in, every feature works, and Tale tells you when a new version is ready with a small toast inside the app. Offline access is intentionally limited — the platform requires a live connection to the backend, so when you lose the network Tale shows a clear offline screen and recovers automatically once you are back online.

## Install on iPhone or iPad

Open `app.tale.dev` (or your self-hosted URL) in Safari — Apple does not let other iOS browsers install web apps. Tap the **Share** button in the toolbar, then scroll down and tap **Add to Home Screen**. Confirm the name and tap **Add**. The Tale icon appears on your home screen, and tapping it launches Tale in a standalone window without the Safari URL bar. The status bar respects your theme: light when the operating system is in light mode, dark otherwise.

You stay signed in across launches. To remove the app, long-press the icon and choose **Remove App**, the same way you would for any native app — your account is unaffected.

## Install on Android

In Chrome, Edge, or any Chromium-based browser, open Tale and look for the install prompt that appears in the URL bar or the address-bar overflow menu (the three-dot icon). Choose **Install app** or **Add to Home screen**. Tale installs as a separate app entry, available from the launcher and the recents list. Notifications are not used today; the app will work entirely as a foreground experience.

To uninstall, long-press the Tale icon and choose **Uninstall**, or remove the app from the system app settings.

## Install on desktop

In Chrome, Edge, Brave, or Arc, open Tale and click the install icon at the right edge of the URL bar (a small monitor with a downward arrow). The browser asks for confirmation; click **Install**. Tale opens in a dedicated window without browser chrome and appears in the Dock (macOS), taskbar (Windows), or activities (Linux).

Firefox does not currently install web apps as separate windows, but Tale runs fully in a normal Firefox tab. Safari on macOS supports installation from the **File** menu (**File → Add to Dock** in recent versions).

## What "installed" gives you

The installed app loads faster than a fresh tab because the offline shell and brand assets are cached locally by the service worker. Tale still calls the backend for every operation — there is no local data store — so a live connection is required for any meaningful interaction. The benefits are presentation, not offline capability:

- A dedicated window and icon, no browser chrome in the way.
- Mobile layouts with a bottom tab bar that matches platform conventions.
- Safe-area-aware padding so content does not slide under the iOS notch or Android gesture bar.
- A small toast when a new version of Tale is ready, with a single tap to refresh.

When the connection drops, Tale shows an in-app overlay explaining that the platform needs internet and reconnects automatically the moment you regain signal. If you launch the app with no connection at all, you see the standalone offline screen instead — still no functionality, but a clearer message than a broken page.

## Updates and uninstall

Updates roll out continuously. When Tale ships a new version, the running app picks it up in the background; the next interaction triggers a toast offering to apply the update. Tapping **Update now** reloads the app on the new version without a full reinstall. If you ignore the toast, the new version applies the next time you fully close and reopen Tale.

To uninstall on any platform, remove the icon or app entry the same way you would for any other application. Reinstalling later restores everything, because all your data lives server-side — nothing about the install is tied to a specific device.

Installing Tale is one of the lowest-effort changes you can make to your daily workflow. The mobile experience improves dramatically once the address bar is gone, the desktop experience is one fewer tab to lose, and the update path is built in. If you spend more than a few minutes a day in Tale, install it once and forget the URL.
