---
title: Admin
description: Admin ist die Konfigurationsebene — Mitglieder, Teams, Anbieter, API-Schlüssel, Integrationen, Branding, Richtlinien. Die Seiten hier sind das, was ein Admin oder Inhaber durchklickt, um eine Organisation aufzusetzen und am Laufen zu halten.
---

Admin ist die Konfigurationsebene von Tale. Sie umfasst die Personen, die sich anmelden dürfen, die Teams, die sie gruppieren, die KI-Anbieter hinter jeder Antwort, die API-Schlüssel, mit denen externer Code mit der Organisation spricht, die Drittanbieter-Integrationen, durch die Agents nach aussen greifen, und das Branding, das der Rest der Organisation sieht. Nur Admins und Inhaber sehen das volle Admin-Menü; Entwickler sehen eine Teilmenge, andere Rollen sehen es gar nicht.

Diese Seiten beschreiben, was jede Einstellung tut und was sie am laufenden Produkt ändert. Die meisten liest du einmal beim Aufsetzen und besuchst sie wieder, wenn sich etwas ändert — eine neue Person, ein rotierter Schlüssel, ein neuer Anbieter, eine neue Integration. Die Rollen- und Berechtigungsgeschichte hinter dem Menü liegt in [Mitglieder und Rollen](/de/platform/admin/members-and-roles); die unten verlinkten Seiten setzen sie voraus und gehen pro Funktion weiter.

## Seiten in diesem Bereich

**[Mitglieder und Rollen](/de/platform/admin/members-and-roles)** — Admins und Inhaber lesen das, wenn sie Personen einladen oder Zugriff nach Rolle skopieren.

**[Agents](/de/platform/admin/agents)** — Admins und Inhaber lesen das, um jeden Agent der Organisation zu sehen und einzugreifen, wenn einer Steuerung braucht.

**[API-Schlüssel](/de/platform/admin/api-keys)** — Admins und Entwickler lesen das, wenn sie externen Code oder einen internen Dienst an Tales REST-API anschliessen.

**[Integrationen](/de/platform/admin/integrations)** — Admins lesen das, wenn sie die Anmeldedaten hinter Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily und MCP installieren oder rotieren.

**[Anbieter](/de/platform/admin/providers)** — Admins lesen das, wenn sie OpenAI, Anthropic, Azure oder ein lokales Ollama anbinden und festlegen, welche Modelle die Organisation nutzen darf.

**[Teams](/de/platform/admin/teams)** — Admins lesen das, um Mitglieder in Teams zu gruppieren, die sich Agents, Prompts und Integrationen teilen.

## Wo das hingehört

Admin ist die Oberfläche, die jeder andere Tab voraussetzt. Chat löst ein Modell über die hier konfigurierten Anbieter auf; Agents rufen Tools über die hier konfigurierten Integrationen auf; die Prompt-Bibliothek und der Inbox respektieren die hier konfigurierten Team-Grenzen. Die natürliche Erstlektüre ist [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — jede andere Admin-Seite verweist auf die Rollennamen, die dort definiert sind.
