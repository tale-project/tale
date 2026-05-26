---
title: Entwicklung
description: Entwicklung deckt die API-Konsumenten-Oberfläche ab — REST API, Webhooks, Integrations-SDK, KI-gestützter Entwicklungs-Workflow, Status-Seite, Rate Limits.
---

Entwicklung ist der Abschnitt für Integratoren und Contributors — alle, die Tale an ein anderes System anbinden, auf der API aufsetzen oder eine Änderung am Quellcode liefern. Die Seiten hier beschreiben die externe Oberfläche (REST, Webhooks, OpenAI-kompatible Endpoints) und den Contributor-Workflow.

Wenn du innerhalb des Produkts als Entwickler-Rolle arbeitest (Agents, Automatisierungen, eigene Tools), deckt der Reiter Plattform deinen Alltag ab; Entwicklung ist dann gefragt, wenn du außerhalb des Produkts stehst und über die Leitung mit ihm sprichst.

## Seiten in diesem Abschnitt

**[API-Referenz](/de/develop/api-reference)** — Endpoints, Authentifizierung, OpenAI-kompatible Endpoints, Fehlermodell, Versionierung.

**[Webhooks](/de/develop/webhooks)** — ausgehend (Tale → du) und eingehend (du → Tale), Signieren, Idempotenz, Wiederholungen.

**[KI-gestützte Entwicklung](/de/develop/ai-assisted-development)** — Tale-Agents nutzen, um Tale-Workflows zu schreiben; die `.agents/`-Skill-Dateien.

**[Integrationen](/de/develop/integrations)** — Drittanbieter-Integrationen aus Entwicklersicht.

**[Status-Seite](/de/develop/status-page)** — Vorfallsmeldungen für Cloud, Metrik-Verweise für selbst gehostet.

**[Rate Limits](/de/develop/rate-limits)** — Limits pro Key, pro IP, pro Organisation und wie ein 429 zu lesen ist.

## Wo das hingehört

Entwicklung ist der kleinste Abschnitt, weil die meisten Nutzer ihn nie brauchen; das Publikum konzentriert sich auf zwei Rollen (Entwickler im Produkt, Contributor außerhalb), ist aber für beide tragend. Wenn du etwas Externes an Tale anbindest, ist [API-Referenz](/de/develop/api-reference) die erste Lektüre; wenn du am Quellcode beiträgst, ist [Mitwirken](/de/self-hosted/contributing-docker) — unter dem Reiter Selbst gehostet — die richtige.
