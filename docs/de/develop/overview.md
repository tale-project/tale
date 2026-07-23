---
title: Entwicklung
description: Entwicklung deckt die API-Konsumenten-Oberfläche ab — REST API, Webhooks, Integrations-SDK, KI-gestützter Entwicklungs-Workflow, Status-Seite, Rate Limits.
---

Entwicklung ist der Abschnitt für Integratoren und Contributors — alle, die Tale an ein anderes System anbinden, auf der API aufsetzen oder eine Änderung am Quellcode liefern. Die Seiten hier beschreiben die externe Oberfläche (REST, Webhooks, OpenAI-kompatible Endpoints) und den Contributor-Workflow.

Wenn du innerhalb des Produkts als Entwickler-Rolle arbeitest (Agents, Workflows, eigene Tools), deckt der Reiter Plattform deinen Alltag ab; Entwicklung ist dann gefragt, wenn du außerhalb des Produkts stehst und über die Leitung mit ihm sprichst.

Lieber erst zusehen? Die Bonus-Episode geht die Entwickler-Oberfläche ab — Schlüssel, APIs, Webhooks, Sandbox-Agents — in gut zwei Minuten.

<Video src="/videos/de/tutorials/ep10-developers/ep10-developers.de.mp4" poster="/videos/de/tutorials/ep10-developers/ep10-developers.de.webp" captions="/videos/de/tutorials/ep10-developers/ep10-developers.de.vtt" lang="de" title="Bonus — Tale für Entwickler" caption="Bonus — Tale für Entwickler (2:38)">

</Video>

## Seiten in diesem Abschnitt

<CardGroup cols="2">

<Card title="API-Referenz" icon="code" href="/de/develop/api-reference">

Endpoints, Authentifizierung, OpenAI-kompatible Endpoints, Fehlermodell, Versionierung.

</Card>

<Card title="Webhooks" icon="webhook" href="/de/develop/webhooks">

Ausgehend (Tale → du) und eingehend (du → Tale), Signieren, Idempotenz, Wiederholungen.

</Card>

<Card title="KI-gestützte Entwicklung" icon="sparkles" href="/de/develop/ai-assisted-development">

Tale-Agents nutzen, um Tale-Workflows zu schreiben; die `.agents/`-Skill-Dateien.

</Card>

<Card title="Integrationen" icon="plug" href="/de/develop/integrations">

Drittanbieter-Integrationen aus Entwicklersicht.

</Card>

<Card title="Status-Seite" icon="activity" href="/de/develop/status-page">

Vorfallsmeldungen für Cloud, Metrik-Verweise für selbst gehostet.

</Card>

<Card title="Rate Limits" icon="gauge" href="/de/develop/rate-limits">

Limits pro Key, pro IP, pro Organisation und wie ein 429 zu lesen ist.

</Card>

</CardGroup>

## Wo das hingehört

Entwicklung ist der kleinste Abschnitt, weil die meisten Nutzer ihn nie brauchen; das Publikum konzentriert sich auf zwei Rollen (Entwickler im Produkt, Contributor außerhalb), ist aber für beide tragend. Wenn du etwas Externes an Tale anbindest, ist [API-Referenz](/de/develop/api-reference) die erste Lektüre; wenn du am Quellcode beiträgst, ist [Mitwirken](/de/self-hosted/contributing-docker) — unter dem Reiter Selbst gehostet — die richtige.
