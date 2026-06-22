---
title: Cloud-Onboarding
description: Von der Anmeldung zu einer produktionsreifen Organisation in weniger als einer Stunde — Org erstellen, ersten Admin einladen, Modell-Provider hinzufügen, Agent veröffentlichen, Chat öffnen.
---

Dieses Tutorial führt von der Anmeldung zu einer produktionsreifen Cloud-Org mit einem funktionierenden Agent in weniger als einer Stunde. Das Ergebnis ist eine Org, in der dein Team sich anmelden, einen funktionierenden Agent wählen und etwas Nützliches fragen kann — nichts Aufregendes, nur das Fundament, auf dem alles weitere aufbaut.

Du brauchst eine funktionierende E-Mail-Adresse und die Fähigkeit, sie zu verifizieren. Das Tutorial setzt kein Vorwissen zu Tale voraus; wenn unten etwas ein Konzept referenziert, das du noch nicht kennst, führt die verlinkte Seite es ein. Etwa die Hälfte der Zeit steckt in Schritt 3 (Modell-Provider hinzufügen) — der Rest ist meistens Klicken.

## Bevor du beginnst

Klär drei Dinge:

- Eine E-Mail-Adresse für den ersten Owner der Org. Dieses Konto trägt die höchste Rolle; wähl jemanden, der nicht nächste Woche das Team verlässt.
- API-Credentials für mindestens einen Modell-Provider (OpenAI, Anthropic, Azure oder ein kompatibler lokaler). Das Portal des Providers zeigt, wo diese liegen.
- Die Region, in die du deine Daten heften willst. Cloud bietet Schweiz und EU; einmal wählen, später wechseln ist eine echte Migration.

## Schritt 1 — Deine Organisation erstellen

Besuch `tale.dev` und klick **Sign up**. Das Formular fragt nach Name, E-Mail und Passwort; verifiziere den E-Mail-Link, wenn er ankommt. Der nächste Bildschirm fragt nach dem **Organization name** — der Anzeigename, den dein Team in jeder Seitenecke sieht. Wähl einen, der ein Rebranding überlebt.

Der erste User wird automatisch **Owner** der Org. Du siehst deine Rolle später unter **Einstellungen > Personen**, falls du es vergisst.

## Schritt 2 — Den ersten Admin einladen

Öffne **Einstellungen > Personen** und klick **Mitglied einladen**. Gib die E-Mail des Admins ein und weise die Rolle **Admin** zu. Der Eingeladene erhält eine E-Mail mit einem Magic-Link; er meldet sich an und landet in der Org mit der zugewiesenen Rolle. Die „mindestens 2 Admins"-Sicherheitsregel sorgt dafür, dass sich eine Org nicht versehentlich aussperrt, indem sie ihren einzigen Admin entfernt — lad einen zweiten Admin ein, bevor du etwas tust, das das voraussetzt.

Für die Rollen-Matrix (wer was kann), siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

## Schritt 3 — Einen Modell-Provider hinzufügen

Öffne **Einstellungen > Provider** und klick **Provider hinzufügen**. Wähl den Provider, für den du Credentials hast, und füg den API-Key ein. Speichere. Tale validiert den Key im Hintergrund; ein Häkchen auf der Provider-Zeile bedeutet, dass der Key funktioniert. Schlägt die Validierung fehl, zeigt die Zeile den Fehler wörtlich — die häufigste Ursache ist Whitespace um den Key.

Dieser Schritt ist, wo die meisten Onboarding-Sitzungen stocken. Das Provider-Portal ist meist ein anderes Login, und das Team muss nach dem Key graben. Hängt die Validierung mehr als eine Minute, lade die Seite neu — der Key ist gespeichert, sobald **Save** bestätigt, die Zeile braucht nur manchmal ein Reload zum Aktualisieren.

## Schritt 4 — Deinen ersten Agent veröffentlichen

Öffne **Agents** und klick **Create agent**. Wähl das gerade hinzugefügte Modell. Schreib einen Absatz Instructions — die Stimme, in der der Agent antworten soll, die Domäne, die er kennt, die Fälle, die er ablehnt. Speichere. Leg **Visible in chat** an. Der Agent ist nun aus jedem Chat in der Org erreichbar.

Für einen tieferen Spaziergang dazu, was einen Agent gut macht, siehe [Einen Agent erstellen](/de/platform/agents/create).

## Schritt 5 — Chat öffnen

Klick in der Sidebar auf **Neuer Chat**. Wähl den Agent im Picker, tipp eine Frage, die die Domäne des Agents abdeckt, sende. Die Antwort streamt zurück; landet sie so, wie du die Instructions geschrieben hast, ist die Org mit dem Onboarding fertig.

Drei Folgeaufgaben, die sich jetzt lohnen, solange alles frisch ist:

- Öffne **Einstellungen > Branding** und lade das Org-Logo hoch.
- Setze die Default-Sprache der Org unter **Einstellungen > Organisation**.
- Überflieg [Trust und Compliance](/de/cloud/trust-and-compliance), damit du weisst, was du einem Auditor zeigst, bevor einer fragt.

## Fehlersuche

- **Einladungs-E-Mail kommt nie an.** Schau im Spam-Ordner des Eingeladenen nach. Tale sendet von `noreply@tale.dev`; manche Unternehmensfilter halten das fest.
- **Provider-Validierung scheitert mit „invalid key".** Kopier den Key erneut aus dem Provider-Portal — beim Kopieren landet oft ein führender oder folgender Space mit.
- **Agent erscheint nicht im Chat-Picker.** Bestätige, dass **Visible in chat** für den Agent an ist.

## Wo das eingesetzt wird

Du hast jetzt eine Org mit einem funktionierenden Agent und einem zweiten Admin neben dir. Der natürliche nächste Spaziergang ist [Ersten Agent von Anfang bis Ende bauen](/de/tutorials/editor/first-agent-end-to-end) — dieselbe Form, aber baut einen Agent, der echte Domänen-Arbeit mit Wissensbindungen macht. Bist du hier, um Cloud gegenüber Self-hosted zu evaluieren, ist [Auf Self-hosted migrieren](/de/cloud/migrate-to-self-hosted) der umgekehrte Spaziergang.
