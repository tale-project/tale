---
title: Admin
description: Admin ist die Konfigurationsebene — Mitglieder, Teams, Anbieter, API-Schlüssel, Connectors, Branding, Richtlinien. Die Seiten hier sind das, was ein Admin oder Inhaber durchklickt, um eine Organisation aufzusetzen und am Laufen zu halten.
---

Admin ist die Konfigurationsebene von Tale. Sie umfasst die Personen, die sich anmelden dürfen, die Teams, die sie gruppieren, die KI-Anbieter hinter jeder Antwort, die API-Schlüssel, mit denen externer Code mit der Organisation spricht, die Drittanbieter-Connectors, durch die Agents nach außen greifen, und das Branding, das der Rest der Organisation sieht. Nur Admins und Inhaber sehen das volle Admin-Menü; Entwickler sehen eine Teilmenge, andere Rollen sehen es gar nicht.

Diese Seiten beschreiben, was jede Einstellung tut und was sie am laufenden Produkt ändert. Die meisten liest du einmal beim Aufsetzen und besuchst sie wieder, wenn sich etwas ändert — eine neue Person, ein rotierter Schlüssel, ein neuer Anbieter. Die Rollen- und Berechtigungsgeschichte hinter dem ganzen Menü liegt in [Mitglieder und Rollen](/de/platform/admin/members-and-roles); fang dort an, denn jede andere Admin-Seite verweist auf die Rollennamen, die sie definiert.

Lieber erst zusehen? Episode 9 durchquert den ganzen Kontrollraum — Anbieter, Leitplanken, Audit, Kosten — in gut drei Minuten, mit Untertiteln.

<Video src="/videos/de/tutorials/ep9-governance/ep9-governance.de.mp4" poster="/videos/de/tutorials/ep9-governance/ep9-governance.de.webp" captions="/videos/de/tutorials/ep9-governance/ep9-governance.de.vtt" lang="de" title="Episode 9 — Richtlinien, Kosten & Vertrauen" caption="Episode 9 — Richtlinien, Kosten & Vertrauen (3:31)">

</Video>

## Konfigurationsbereiche

<CardGroup cols="2">

<Card title="Mitglieder und Rollen" icon="users" href="/de/platform/admin/members-and-roles">

Die sechs Rollen und die ressourcengenaue Matrix, die sagt, wer lesen, schreiben, konfigurieren und regeln darf.

</Card>

<Card title="Teams" icon="users-round" href="/de/platform/admin/teams">

Gruppiere Mitglieder in Teams, die Dokumente, Projekte, Skills und Konversationen teilen.

</Card>

<Card title="Agents" icon="bot" href="/de/platform/admin/agents">

Jeder Agent, den die Organisation hat, und wo ein Admin eingreift, wenn einer Governance braucht.

</Card>

<Card title="KI-Anbieter" icon="cpu" href="/de/platform/admin/providers">

Hinterleg die Zugangsdaten hinter jeder Antwort und wähl, welche Modelle die Organisation aufrufen darf.

</Card>

<Card title="Connectors" icon="plug" href="/de/platform/admin/connectors">

Hinterleg und ersetz die Zugangsdaten hinter Slack, Gmail, Outlook, Google Drive, GitHub, Shopify und mehr.

</Card>

<Card title="Enterprise SSO" icon="shield-check" href="/de/platform/admin/enterprise-sso">

Verdrahte die Anmeldung mit deinem Identity-Provider über SAML oder OIDC.

</Card>

<Card title="API-Schlüssel" icon="key" href="/de/platform/admin/api-keys">

Erzeuge die Schlüssel, mit denen externer Code Tales REST-API erreicht.

</Card>

<Card title="Branding" icon="palette" href="/de/platform/admin/branding">

Das Logo, das Favicon und die Akzentfarbe, die der Rest der Organisation sieht.

</Card>

<Card title="Zwei-Faktor-Authentifizierung" icon="smartphone" href="/de/platform/admin/two-factor-authentication">

Verlange einen zweiten Faktor für die Anmeldung und verwalte die Einrichtung organisationsweit.

</Card>

<Card title="Changelog" icon="history" href="/de/platform/admin/changelog">

Der produktinterne Eintrag darüber, was wann ausgeliefert wurde.

</Card>

<Card title="Governance" icon="scale" href="/de/platform/admin/governance/audit-logs">

Audit-Logs, Richtlinien und Limits, Guardrails, Analysen, Aufbewahrung und Legal Hold.

</Card>

</CardGroup>

## Wo das hingehört

Admin ist die Oberfläche, die jeder andere Tab voraussetzt. Chat löst ein Modell über die hier konfigurierten Anbieter auf; Agents rufen Tools über die hier konfigurierten Connectors auf; die Skill-Bibliothek und die Inbox respektieren die hier konfigurierten Team-Grenzen. Die natürliche erste Lektüre ist [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — jede andere Admin-Seite verweist auf die Rollennamen, die sie definiert.
