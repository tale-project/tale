---
title: Cloud-Onboarding
description: Von der Registrierung zu einer produktionsreifen Organisation in unter einer Stunde — Org erstellen, ersten Admin einladen, Modellanbieter verbinden, Agent veröffentlichen, Chat öffnen.
---

Diese Strecke führt von der Registrierung zu einer produktionsreifen Cloud-Org mit einem funktionierenden Agent in unter einer Stunde. Das Ergebnis ist eine Org, in der sich dein Team anmelden, einen funktionierenden Agent wählen und ihn etwas Nützliches fragen kann — noch nichts Aufregendes, nur das Fundament, auf dem alles Weitere aufbaut.

Du brauchst eine funktionierende E-Mail-Adresse und die Möglichkeit, sie zu verifizieren. Die Strecke setzt kein Tale-Vorwissen voraus; referenziert unten etwas ein Konzept, das du noch nicht kennst, führt die verlinkte Seite es ein. Rund die Hälfte der Zeit steckt im Anbieter-Schritt — der Rest ist überwiegend Klicken.

## Bevor du beginnst

Klär drei Dinge:

- Eine E-Mail-Adresse für den ersten Inhaber der Org. Dieses Konto trägt die höchste Rolle; wähl jemanden, der nicht nächste Woche das Team verlässt.
- API-Zugangsdaten für mindestens einen Modellanbieter (OpenAI, Anthropic, Azure oder ein kompatibler lokaler). Das Portal des Anbieters zeigt, wo sie liegen.
- Die Region, in der deine Daten liegen sollen. Cloud bietet die Schweiz und die EU; einmal wählen — ein späterer Wechsel ist eine echte Migration.

## Von der Registrierung zum funktionierenden Agent

<Steps>

<Step title="Erstelle deine Organisation">

Besuche `tale.dev` und klicke auf **Loslegen**. Das Formular fragt nach Name, E-Mail und Passwort; bestätige den E-Mail-Link, sobald er ankommt. Der nächste Bildschirm fragt eine Sache ab: **Organisationsname** — der Anzeigename, den dein Team in der Ecke jeder Seite sieht. Wähl einen, der ein Rebranding überlebt.

<Frame caption="Der Arbeitsbereichs-Schritt — der Name, den dein Team überall sieht.">

![Der Assistent zum Erstellen einer Organisation mit dem Feld für den Organisationsnamen auf seinem Arbeitsbereichs-Schritt.](/images/get-started/org-create-wizard.webp)

</Frame>

Der erste Benutzer wird automatisch **Inhaber** der Org. Falls du es vergisst: Deine Rolle siehst du später im Abschnitt **Mitglieder** unter **Einstellungen > Organisation**.

</Step>

<Step title="Lade den ersten Admin ein">

Öffne **Einstellungen > Organisation**, scroll zum Abschnitt **Mitglieder** und klicke auf **Mitglied hinzufügen**. Gib die E-Mail des Admins ein und weise die Rolle **Admin** zu. Die eingeladene Person erhält eine E-Mail mit einem Magic-Link, registriert sich und landet in der Org mit der zugewiesenen Rolle. Die Sicherheitsregel „mindestens 2 Admins" verhindert, dass sich eine Org versehentlich aussperrt, indem sie ihren einzigen Admin entfernt — lad einen zweiten Admin ein, bevor du etwas tust, das sie voraussetzt.

Die Rollen-Matrix (wer was darf) steht in [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

</Step>

<Step title="Verbinde einen Modellanbieter">

Öffne **Einstellungen > KI-Anbieter** und klicke auf **Anbieter hinzufügen**. Wähl den Anbieter, für den du Zugangsdaten hast, und füg den API-Schlüssel ein. Speichere. Tale validiert den Schlüssel im Hintergrund; eine Bestätigung auf der Anbieterzeile heißt, dass er funktioniert. Schlägt die Validierung fehl, zeigt die Zeile den Fehler wörtlich — die häufigste Ursache ist Whitespace um den Schlüssel.

<Frame caption="Ein validierter Anbieter — von hier kann jeder Agent antworten.">

![Die Einstellungsseite für KI-Anbieter mit dem OpenRouter-Anbietereintrag.](/images/get-started/settings-providers.webp)

</Frame>

<Note>

An diesem Schritt stocken die meisten Onboarding-Sitzungen — das Anbieter-Portal ist meist ein anderes Login, und das Team muss nach dem Schlüssel graben. Hängt die Validierung länger als eine Minute, lade die Seite neu; der Schlüssel ist gespeichert, sobald **Speichern** bestätigt — die Zeile braucht manchmal ein Neuladen, um ihn anzuzeigen.

</Note>

</Step>

<Step title="Veröffentliche deinen ersten Agent">

Öffne **Agenten** und klicke auf **Agent erstellen**. Wähl das gerade verbundene Modell. Schreib einen Absatz Anweisungen — die Stimme, in der der Agent antworten soll, die Domäne, die er kennt, die Fälle, die er ablehnt. Speichere. Schalte **Im Chat sichtbar** ein. Der Agent ist jetzt aus jedem Chat in der Org erreichbar.

Was einen Agent gut macht, vertieft [Einen Agent erstellen](/de/platform/agents/create).

</Step>

<Step title="Öffne den Chat">

Klicke in der Sidebar auf **Neuer Chat**. Wähl den Agent in der Auswahl, tippe eine Frage aus seiner Domäne, sende.

<Check>

Die Antwort streamt zurück — landet sie so, wie du die Anweisungen geschrieben hast, ist die Org mit dem Onboarding fertig.

</Check>

Drei Anschlussaufgaben, die sich jetzt lohnen, solange alles frisch ist:

- Öffne **Einstellungen > Branding** und lade das Org-Logo hoch.
- Setz die Standardsprache der Org unter **Einstellungen > Organisation**.
- Überflieg [Trust und Compliance](/de/cloud/trust-and-compliance), damit du weißt, was du einem Auditor zeigst, bevor einer fragt.

</Step>

</Steps>

## Fehlersuche

- **Die Einladungs-E-Mail kommt nie an.** Schau im Spam-Ordner der eingeladenen Person nach. Tale sendet von `noreply@tale.dev`; manche Unternehmensfilter halten das zurück.
- **Die Anbieter-Validierung scheitert mit „invalid key".** Kopier den Schlüssel erneut aus dem Anbieter-Portal — beim Kopieren landet oft ein führendes oder folgendes Leerzeichen mit.
- **Der Agent taucht nicht in der Chat-Auswahl auf.** Prüfe, dass **Im Chat sichtbar** für den Agent eingeschaltet ist.

## Wo das eingesetzt wird

Du hast jetzt eine Org mit einem funktionierenden Agent und einem Admin neben dir. Die natürliche nächste Strecke ist [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) — dieselbe Form, aber mit einem Agent, der über Wissensanbindungen echte Domänenarbeit leistet. Bist du hier, um Cloud gegen selbst gehostet abzuwägen, ist [Auf Self-hosted migrieren](/de/cloud/migrate-to-self-hosted) die Strecke in die Gegenrichtung.
