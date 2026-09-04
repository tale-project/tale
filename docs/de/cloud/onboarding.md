---
title: Cloud-Onboarding
description: Von der Demo-Anfrage zu einer produktionsreifen Organisation — eigene Instanz vom Tale-Team, Org erstellen, ersten Admin einladen, Modellanbieter verbinden, ersten Projekt-Agenten anlegen, Chat öffnen.
---

<!--
  Internal, for agents editing this page: Tale Cloud has no self-serve sign-up — tale.dev
  ships no sign-up route. A Cloud customer fills in the demo request form
  (https://tale.dev/request-demo — /de/ and /fr/ localized), and the Tale team sets up a
  dedicated demo instance for them. The journey below only starts once that instance exists;
  from there it deliberately mirrors normal first-run onboarding (sign-up on the customer's
  own instance, org wizard, providers). Keep the request-your-instance step first and do not
  change the entry point back to a tale.dev sign-up.
-->

Diese Strecke führt von der Demo-Anfrage zu einer produktionsreifen Cloud-Org mit einem funktionierenden Agent. Das Ergebnis ist eine Org, in der sich dein Team anmelden, den Chat-Assistenten etwas Nützliches fragen und einem Projekt-Agenten seine erste Aufgabe geben kann — noch nichts Aufregendes, nur das Fundament, auf dem alles Weitere aufbaut.

Du brauchst eine funktionierende E-Mail-Adresse und die Möglichkeit, sie zu verifizieren. Die Strecke setzt kein Tale-Vorwissen voraus; referenziert unten etwas ein Konzept, das du noch nicht kennst, führt die verlinkte Seite es ein. Sobald deine Instanz bereitsteht, dauert der praktische Teil unter einer Stunde — rund die Hälfte davon steckt im Anbieter-Schritt, der Rest ist überwiegend Klicken.

## Bevor du beginnst

Klär drei Dinge:

- Eine E-Mail-Adresse für den ersten Inhaber der Org. Dieses Konto trägt die höchste Rolle; wähl jemanden, der nicht nächste Woche das Team verlässt.
- API-Zugangsdaten für mindestens einen Modellanbieter (OpenAI, Anthropic, Azure oder ein kompatibler lokaler). Das Portal des Anbieters zeigt, wo sie liegen.
- Die Region, in der deine Daten liegen sollen. Cloud bietet die Schweiz und die EU; die Wahl gehört zum Instanz-Setup — ein späterer Wechsel ist eine echte Migration.

## Von der Demo-Anfrage zum funktionierenden Agent

<Steps>

<Step title="Fordere deine Instanz an">

Tale Cloud ist kein Self-Service — jede Cloud-Org läuft auf einer eigenen Instanz, die das Tale-Team für dich aufsetzt. Füll das Demo-Formular unter [tale.dev/de/request-demo](https://tale.dev/de/request-demo) aus; Name und E-Mail genügen, Firma und ein Satz dazu, was deine Agenten tun sollen, helfen dem Team, das Setup zuzuschneiden. Das Team setzt dann deine eigene Demo-Instanz auf — eine dedizierte Umgebung, keine geteilte Testumgebung — und meldet sich, sobald sie bereitsteht.

</Step>

<Step title="Erstelle deine Organisation">

Öffne deine Instanz und registriere dich. Das Formular fragt nach Name, E-Mail und Passwort; bestätige den E-Mail-Link, sobald er ankommt. Der nächste Bildschirm fragt eine Sache ab: **Organisationsname** — der Anzeigename, den dein Team in der Ecke jeder Seite sieht. Wähl einen, der ein Rebranding überlebt.

<Frame caption="Der Arbeitsbereichs-Schritt — der Name, den dein Team überall sieht.">

![Der Assistent zum Erstellen einer Organisation auf seinem Arbeitsbereichs-Schritt, mit Northlight Labs im Feld Organisationsname und aktivem Knopf Weiter.](/images/get-started/org-create-wizard.webp)

</Frame>

Der erste Benutzer wird automatisch **Inhaber** der Org. Falls du es vergisst: Deine Rolle siehst du später unter **Einstellungen > Mitglieder**.

</Step>

<Step title="Lade den ersten Admin ein">

Öffne **Einstellungen > Mitglieder** und klicke auf **Mitglied hinzufügen**. Gib Name und E-Mail des Admins ein, weise die Rolle **Admin** zu und setz ein Passwort — Tale legt das Konto direkt an und zeigt die Zugangsdaten genau einmal; speichere sie und gib sie dem neuen Admin auf einem anderen Weg weiter (eine Einladungs-E-Mail gibt es nicht). Die Person landet in der Org mit der zugewiesenen Rolle. Die Sicherheitsregel „mindestens 2 Admins" verhindert, dass sich eine Org versehentlich aussperrt, indem sie ihren einzigen Admin entfernt — leg einen zweiten Admin an, bevor du etwas tust, das sie voraussetzt.

Die Rollen-Matrix (wer was darf) steht in [Mitglieder und Rollen](/de/platform/admin/members-and-roles).

</Step>

<Step title="Verbinde einen Modellanbieter">

Öffne **Einstellungen > KI-Anbieter**, such den Connector, für den du einen Schlüssel hast, und klicke auf **Zugangsdaten hinzufügen**. Gib den Zugangsdaten einen Namen, an dem später erkennbar ist, welcher Schlüssel dahintersteckt, wähl als Authentifizierungsmethode **API-Schlüssel** und füg den Schlüssel ein. Er wird verschlüsselt gespeichert und ist als erster Eintrag automatisch der Standard des Connectors; ein zweiter Eintrag am selben Connector ist erlaubt, und du entscheidest, welcher der Standard ist. Wird ein Schlüssel abgelehnt, liegt es meistens an Whitespace darum herum.

<Frame caption="Der verbundene Anbieter — von hier kann jeder Agent antworten.">

![Die Einstellungsseite für KI-Anbieter listet einen verbundenen Anbieter, OpenRouter, mit seiner Basis-URL und 52 Modellen.](/images/get-started/settings-providers.webp)

</Frame>

<Note>

An diesem Schritt stocken die meisten Onboarding-Sitzungen — das Anbieter-Portal ist meist ein anderes Login, und das Team muss nach dem Schlüssel graben. Hängt die Validierung länger als eine Minute, lade die Seite neu; der Schlüssel ist gespeichert, sobald **Speichern** bestätigt — die Zeile braucht manchmal ein Neuladen, um ihn anzuzeigen.

</Note>

</Step>

<Step title="Leg deinen ersten Projekt-Agenten an">

Öffne den Tab **Agenten** eines Projekts und klicke auf **Neuer Agent**. Wähl die **Agent-Laufzeit** — die Coding-CLI, auf der der Agent läuft — und unter **Modell** das gerade verbundene Modell. Schreib einen Absatz Anweisungen — die Stimme, in der der Agent antworten soll, die Domäne, die er kennt, die Fälle, die er ablehnt — und klicke auf **Agent erstellen**. Weis ihm eine Board-Aufgabe zu und klicke auf **Agent starten**; das Ergebnis kommt unter **In Prüfung** zurück, wo ein Mensch es annimmt. Einen Veröffentlichungsschritt gibt es nicht und keine Agentenauswahl im Chat — Agenten erledigen in dieser Version Board-Aufgaben.

Den Dialog Feld für Feld zeigt [Projekt-Agenten](/de/platform/projects/project-agents); was einen Agent gut macht, die [Agent-Konzepte](/de/platform/agents/concepts).

</Step>

<Step title="Öffne den Chat">

Klicke in der Sidebar auf **Neuer Chat**. Die Modellauswahl im Composer startet auf **Auto** — Tale wählt ein Modell des Anbieters, den du verbunden hast —, tippe also eine Frage aus der Domäne deines Teams und sende.

<Check>

Die Antwort streamt zurück und hält fest, welches Modell geantwortet hat — die Org ist mit dem Onboarding fertig.

</Check>

Drei Anschlussaufgaben, die sich jetzt lohnen, solange alles frisch ist:

- Öffne **Einstellungen > Branding** und lade das Org-Logo hoch.
- Setz die Standardsprache der Org unter **Einstellungen > Organisation**.
- Überflieg [Trust und Compliance](/de/cloud/trust-and-compliance), damit du weißt, was du einem Auditor zeigst, bevor einer fragt.

</Step>

</Steps>

## Fehlersuche

- **Die Modellliste ist leer, wenn du den Agent anlegst.** Der Anbieter-Schritt ist noch nicht gelandet — unter **Einstellungen > KI-Anbieter** muss ein Modell existieren, bevor der Agent-Dialog eines wählen kann.
- **Die Anbieter-Validierung scheitert mit „invalid key".** Kopier den Schlüssel erneut aus dem Anbieter-Portal — beim Kopieren landet oft ein führendes oder folgendes Leerzeichen mit.
- **Agent starten scheitert mit einer Anbieter-Begründung.** Der gewählte Anbieter kann dieses Modell nicht mehr bedienen — behebe das unter **Einstellungen > KI-Anbieter** und starte den Agent erneut.

## Wo das eingesetzt wird

Du hast jetzt eine Org mit einem funktionierenden Agent und einem Admin neben dir. Die natürliche nächste Strecke ist [Deinen ersten Agent bauen](/de/tutorials/editor/first-agent-end-to-end) — dieselbe Form, aber sie schickt einen Projekt-Agenten an eine echte Aufgabe und prüft, was zurückkommt. Bist du hier, um Cloud gegen selbst gehostet abzuwägen, ist [Auf Self-hosted migrieren](/de/cloud/migrate-to-self-hosted) die Strecke in die Gegenrichtung.
