---
title: Browse and install automations
description: How the Automations catalog works — Installed vs All automations, the side panel a card opens, the install wizard and its preflight, reinstalling and uninstalling, and updating every built-in automation at once.
---

The Automations catalog (**Automations** in the sidebar) is where Owners, Admins, and Developers browse every automation available to the organization and decide which ones are installed. This page covers the catalog itself — the side panel a card opens, the install wizard, and the reinstall, uninstall, and update actions that follow. What each shipped automation actually does lives on [Built-in automations](/platform/automations/builtin); the mental model for the pieces an automation bundles lives on [Automation concepts](/platform/automations/concepts).

<Frame caption="The Automations catalog — every card is one installable automation; the bundle installs all its members through one wizard.">

![The Automations catalog on the All automations tab, showing cards for the three email automations and the Resolve GitHub issues bundle, each with its icon and description.](/images/platform/automations-catalog.webp)

</Frame>

## Installed and All

The catalog opens on **Installed** — the tab strip's default, and the only tab where a bundle dissolves into its own member cards instead of showing once as the bundle. Each member carries a small marker on its icon naming its bundle — **Part of Resolve GitHub issues**, for one — so you can still tell which ones belong together even split apart, and each keeps its own **Reinstall**/**Uninstall** in its **⋯** menu: a bundle has no install of its own to manage as one unit (see [Automation concepts](/platform/automations/concepts) for why). Switch to **All automations** to browse the whole catalog instead — built-in and uploaded, installed or not: here the bundle IS the card, installed through one wizard, and its hidden members never appear on their own. Use **Installed** to manage what's running; use **All automations** to find something new to add.

## Installing one

Click a card and its side panel opens — the same click-to-preview pattern [Settings > Integrations](/platform/integrations/overview) uses for its own catalog. The panel lists what installing adds: its pages, workflows, agents, skills, and the integrations it requires, plus which project it targets if it's project-scoped. Click **Install** and the wizard opens.

The wizard walks only the steps this automation actually needs: a **Project** step if it's project-scoped and you didn't open it from inside one already; a **Review changes** step if installing would overwrite files already on disk; an **Install** step that confirms what's ready and names what still needs connecting; an **Agent mode** step for every agent that can run on your own credentials instead of the platform's, followed by a connect step for each provider key or required integration that choice still leaves unconnected; and a **Done** step. The project you pick on the **Project** step does double duty: it is also what any schedule the automation installs is bound to, so an automation whose document reads `{{ input.projectId }}` runs against the right project without that value being retyped anywhere.

**Done** doesn't say "ready" until the automation actually is. Every required integration connected reports exactly that; a required input the automation's own schema declares and no wizard step asks for is named instead, so you leave the wizard knowing what is still missing (a bundle's Done step does the same per member). Every setup step is finish-able later regardless, from the automation's own **Finish setup** checklist.

## The install preflight

Reinstalling or re-uploading over an automation that already changed some of its files triggers a **Review changes** step before anything is touched. For a single automation, the step lists every file the install would overwrite and asks you to confirm replacing them all with the automation's own versions in one step — there's no per-file pick-and-choose. Installing a **bundle** reviews per member automation instead: each member gets its own collapsible section and its own confirmation, so you can see exactly which of the bundle's several automations touch files you changed. Either way, an automation's own workflow document is exempt from this check — see the next section.

## Reinstalling, uninstalling, and updating

Every installed card carries a **⋯** menu with **Reinstall** and **Uninstall**; a not-yet-installed card's menu offers **Install** instead, plus **Delete** for a private upload you haven't installed yet. **Reinstall** re-runs the same preflight as a fresh install and keeps your environment variables and secrets. **Uninstall** removes the automation and everything it installed — its agents, workflows, pages, and their environment variables and secrets — while any integration it used stays connected for whatever else needs it.

Reinstalling never touches the automation's workflow document: it is update-exempt, so the versions you saved and the one you deployed survive every reinstall and every catalog update. To pick up the latest shipped document instead, uninstall the automation and install it again — Tale repeats this reminder on the reinstall confirmation.

**Update built-in automations**, in the same **Add automation** menu as **Upload package**, is a different action from either: it re-syncs every built-in automation in the organization against the shipped catalog in one pass — including ones you edited — rather than one card at a time. It carries the same workflow exemption and keeps secrets, and because a save only ever appends, whatever it changes leaves every earlier version of that automation exactly where it was.

## Uploading a private automation

**Upload package** in the same menu adds an automation the catalog doesn't ship — drop a `.zip`, or select a folder containing an `automation.json` at its root; the folder or file name becomes the automation's slug. Uploading only adds it to the organization's private catalog; install it afterwards like any other card. Re-uploading over a slug that already exists asks you to confirm the replacement before it overwrites the existing package.

## Where this fits

The catalog is the front door to every automation the organization can run: the side panel previews what installing adds, the wizard connects what it needs, and reinstall, uninstall, and update keep it current without touching a workflow you're mid-edit on. [Built-in automations](/platform/automations/builtin) is the next read for what each shipped automation and the Resolve GitHub issues bundle actually do; [Automation concepts](/platform/automations/concepts) is the mental model if you haven't read it yet.
