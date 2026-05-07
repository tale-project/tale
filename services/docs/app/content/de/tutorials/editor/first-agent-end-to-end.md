---
title: Den ersten Agent end-to-end bauen
description: Einen gezielten Agent anlegen, Wissen anhängen, testen und eine Version veröffentlichen.
---

Generischer Chat beantwortet Fragen mit dem, worauf das Modell trainiert wurde. Ein gezielter Agent beantwortet sie mit dem Wissen deiner Organisation, in deinem Ton, auf eine Aufgabe zugeschnitten — „Produkt-Support“, „HR-Richtlinien“, „Sales-Enablement“. Dieses Tutorial führt dich von einer leeren Agent-Seite bis zu einem aktiven, versionierten Agent, den dein Team im Chat auswählen kann.

Du brauchst Editor-Zugriff oder höher. Die Funktionsreferenz steht unter [Agent-Konzepte](/de/platform/agents/concepts) und [Agent erstellen](/de/platform/agents/create); dieses Tutorial verbindet die Schritte zu einem konkreten Ergebnis.

## Schritt 1 — Festlegen, wofür der Agent da ist

Bevor du irgendwas klickst, schreib einen Satz: „Dieser Agent beantwortet X auf Basis von Y und macht kein Z.“ Beispiel: „Dieser Agent beantwortet Produkt-Support-Fragen aus dem Ordner Help Center und gibt keine rechtlichen oder Billing-Auskünfte.“ Dieser Satz wird das Rückgrat deiner Systemanweisungen — ohne ihn driftet der Agent.

## Schritt 2 — Agent anlegen

Navigiere in der Seitenleiste zu **Agents** und klicke **Agent erstellen**. Gib einen Anzeigenamen („Produkt-Support“) und einen Namen — einen URL-sicheren Slug für API-Aufrufe und die Chat-URL (`produkt-support`). Füge eine kurze Beschreibung hinzu und klicke **Erstellen**.

Du landest auf der Konfigurationsseite. Lass alle Tabs vorerst auf Standard.

## Schritt 3 — Anweisungen schreiben

Öffne den Tab **Anweisungen & Modell**. Füge einen System-Prompt ein, der aus dem Satz aus Schritt 1 gebaut ist. Ein wiederverwendbares Gerüst:

```text
Du bist <Rolle> für <Organisation>.

Deine Aufgabe: <Task> auf Basis von <Wissensumfang>.

Regeln:
- Antworte immer in der Sprache des Nutzers.
- Nenne das Quelldokument, wenn du aus der Wissensdatenbank antwortest.
- Wenn eine Frage außerhalb des Bereichs liegt, sag das und schlag eine passende Anlaufstelle vor.

Ton: <Ton>.
Format: <Format>.
```

Wähle eine **Modellvoreinstellung** (Schnell / Standard / Erweitert), die zur Aufgabe passt — Schnell reicht für kurze Lookups, Erweitert für mehrstufiges Denken. Siehe [Agent-Konzepte — Modell](/de/platform/agents/concepts#modell) für die Zuordnung.

Änderungen werden automatisch gespeichert; eine Anzeige oben rechts zeigt den Status.

## Schritt 4 — Wissen eingrenzen

Öffne den Tab **Wissen**. Deaktiviere alles, was der Agent nicht lesen soll, und behalte nur die Ordner, die zur Aufgabe passen. Ein enger Umfang ist fast immer besser als ein breiter — weniger irrelevante Treffer, kürzerer Kontext, schärfere Antworten. Siehe [Agent-Konzepte — Wissen](/de/platform/agents/concepts#wissen).

Wenn die Ordner noch nicht existieren, leg sie zuerst in der [Wissensdatenbank](/de/platform/workspace/knowledge-base) an und komm dann zurück.

## Schritt 5 — Tools abschalten, die nicht nötig sind

Öffne den Tab **Tools** und deaktiviere alles, was der Agent nicht nutzen soll. Ein Support-Agent braucht wahrscheinlich keine Web-Suche. Ein Research-Agent braucht wahrscheinlich nicht die Billing-Integration. Weniger Tools heißt weniger Überraschungen im Produktivbetrieb.

## Schritt 6 — Gesprächseinstieg hinzufügen

Öffne den Tab **Gesprächseinstiege** und füge zwei oder drei Beispiel-Prompts hinzu. Sie erscheinen auf dem Empty-State, wenn ein Nutzer eine neue Konversation mit dem Agent startet, und dienen gleichzeitig als eingebaute Smoke-Tests für Schritt 7.

## Schritt 7 — Aus dem Chat testen

Öffne **Chat**, wähle im Agent-Selector den neuen Agent und probiere jeden Gesprächseinstieg plus ein, zwei spontane Fragen. Achte darauf:

- Zitiert der Agent die richtigen Dokumente?
- Lehnt er Fragen außerhalb des Bereichs sauber ab?
- Passt der Ton zu dem, was du in den Anweisungen geschrieben hast?

Iteriere im Tab Anweisungen & Modell und teste erneut. Diese Schleife ist der Großteil des Agent-Baus.

## Schritt 8 — Version veröffentlichen

Jede Bearbeitung erzeugt einen **Entwurf**; die aktive Version bedient den Chat weiter, bis du veröffentlichst. Wenn du zufrieden bist, klicke **Veröffentlichen** im Versions-Header. Spätere Bearbeitungen starten einen neuen Entwurf — Nutzer treffen weiter die veröffentlichte Version, bis du erneut veröffentlichst. Siehe [Agent-Versionen](/de/platform/agents/versions) für Rollback.

## Weiter

- Nutzer auf den Agent per Skript zugreifen lassen: [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script).
- Den Agent in eine automatisierte Workflow-Kette einbinden: [Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook).
