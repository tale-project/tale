---
title: Administrieren
description: Einstellungen auf Organisationsebene — Mitglieder und Rollen, Anbieter, Branding, Richtlinien, Zwei-Faktor, Nutzungsanalyse, Anfragen betroffener Personen und der In-App-Changelog.
---

Administration ist der Teil von Tale, der unsichtbar bleibt, bis etwas damit nicht stimmt. Hier entscheidest du, wer sich anmelden darf und über welchen Identitätsanbieter, welche KI-Modelle der Rest der Organisation auf Kosten bringen darf, wie das Produkt für Außenstehende aussieht und wie lange Konversationen und Logs auf der Platte überleben. Keine dieser Entscheidungen ist täglich, aber jede zeigt sich im Alltag eines anderen sofort, sobald sie falsch steht — eine Entwicklerin, die Anthropic nicht erreicht, ein Redakteur, dessen Entwürfe verschwunden sind, ein Mitglied, das nach der SSO-Migration ausgesperrt ist.

Die Seiten in diesem Bereich sind für die Rollen **Admin** und **Inhaber**; jede andere Rolle wird serverseitig von der Admin-Oberfläche ausgesperrt. Die Reihenfolge ist Absicht. [Mitglieder und Rollen](/de/platform/admin/members-and-roles) liest du zuerst, weil nichts in der Administration eine sinnvolle Antwort hat, bevor du entschieden hast, wer was darf. [Authentifizierung](/de/self-hosted/admin/authentication) folgt, denn die Frage _wer sich überhaupt anmelden darf_ ist eine strengere Variante derselben Frage. Anbieter, Branding, Richtlinien und der Rest legen sich darüber.

Wenn du eine frische Organisation aufsetzt, lies die Seiten in der Reihenfolge der Seitenleiste. Wenn du eine bestehende prüfst, springe direkt zu der Seite, deren Bildschirm du bereits offen hast.

## Seiten in diesem Bereich

- **[Mitglieder und Rollen](/de/platform/admin/members-and-roles)** — Mitglieder einladen, bearbeiten und entfernen; die kanonische Sechs-Rollen-Matrix, auf die der Rest der Doku verweist.
- **[Teams](/de/platform/admin/teams)** — Mitglieder gruppieren, um Zugriff auf Dokumente, Konversationen und Agent-Wissen einzuschränken.
- **[Authentifizierung](/de/self-hosted/admin/authentication)** — Passwort, Microsoft Entra ID SSO und vertrauenswürdige Reverse-Proxy-Kopfzeilen; wie Tale entscheidet, ob eine Anmeldung durchgeht.
- **[KI-Anbieter](/de/platform/admin/providers)** — Tale mit OpenAI-kompatiblen Endpunkten verbinden und entscheiden, welche Modelle die Organisation aufrufen darf.
- **[Branding](/de/platform/admin/branding)** — App-Name, Logo, Favicon und die Marken- und Akzentfarben für die laufende App.
- **[Richtlinien](/de/platform/admin/governance)** — System-Prompt, Standard-Modelle, Budgets, Upload-Richtlinie, Aufbewahrung, Passwort- und Anmelde-Richtlinie, Funktionssteuerung und der dreistufige Guardrail-Stapel.
- **[Zwei-Faktor-Authentifizierung](/de/platform/admin/two-factor-authentication)** — TOTP einrichten, Backup-Codes verwalten, die organisationsweite Richtlinie erzwingen, das Mitglied zurücksetzen, das sein Gerät verloren hat.
- **[Nutzungsanalyse](/de/platform/admin/usage-analytics)** — Analyse von Tokens, Kosten und Läufen, gefiltert nach Team, Nutzer, Agent und Zeitraum.
- **[Anfragen betroffener Personen](/de/platform/admin/data-subject-requests)** — GDPR-Art.-17-Löschanträge mit SLA-Verfolgung und Audit-verkettetem Beleg einreichen.
- **[Was ist neu](/de/platform/admin/changelog)** — der In-App-Changelog-Viewer, der nach jedem Upgrade die Release-Notes hervorbringt.
