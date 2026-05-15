---
title: Prompt-Bibliothek
description: Wiederverwendbare Prompt-Vorlagen speichern, durchsuchen und in deiner Organisation teilen.
---

Die Prompt-Bibliothek ist eine gemeinsame Sammlung wiederverwendbarer Prompt-Vorlagen. Speichere Prompts, die du oft brauchst, organisiere sie nach Kategorien und Tags und teile sie mit deinem Team oder der gesamten Organisation. Jede Änderung wird im Versionsverlauf festgehalten, sodass du Versionen vergleichen und zurückrollen kannst, ohne Arbeit zu verlieren.

## Prompts durchstöbern

Öffne die Prompt-Bibliothek aus der Chat-Toolbar. Der Dialog zeigt alle Prompts, auf die du Zugriff hast.

- **Suche** filtert über Titel, Beschreibung, Inhalt, Kategorie und Tags.
- **Tabs** filtern nach Sichtbarkeit: Alle, Global, Team oder Persönlich.
- **Kategorie**- und **Tag**-Popover schränken die sichtbaren Zeilen anhand der Facetten der geladenen Seite ein. Filtert ein Filter die aktuelle Seite vollständig weg, aber es gibt noch weitere Seiten, bietet die Leeranzeige **Mehr laden** zum Weitersuchen sowie **Filter zurücksetzen**.
- Jede Zeile zeigt Titel, Inhalts-Vorschau, Sichtbarkeits-Badge, Kategorie, Tags und die aktuelle Version (z. B. `v3`, wenn Verlauf existiert).

Klicke auf **Verwenden** an einer Zeile, um den Inhalt in die Chat-Eingabe einzufügen.

## Einen Prompt anlegen

1. Öffne die Prompt-Bibliothek und klicke auf das **Plus**-Icon.
2. Fülle das Formular aus:

| Feld             | Pflicht | Beschreibung                                                         |
| ---------------- | ------- | -------------------------------------------------------------------- |
| **Titel**        | Ja      | Ein kurzer Name für den Prompt.                                      |
| **Inhalt**       | Ja      | Der Prompt-Text. Monospace-Schrift.                                  |
| **Beschreibung** | Nein    | Kurzerklärung, was der Prompt tut.                                   |
| **Sichtbarkeit** | Ja      | Wer den Prompt sehen kann (siehe [Sichtbarkeiten](#sichtbarkeiten)). |
| **Team**         | Bedingt | Pflicht, wenn die Sichtbarkeit auf Team gesetzt ist.                 |
| **Kategorie**    | Nein    | Ein Label wie "writing", "analysis" oder "coding".                   |
| **Tags**         | Nein    | Komma-getrennte Stichworte für Suche und Organisation.               |

3. Klicke auf **Erstellen**.

### Tag-Eingabe

Das **Tags**-Feld ist eine Chip-Eingabe. Drücke **Eingabe** oder tippe ein **Komma**, um einen Tag zu übernehmen; **Backspace** bei leerer Eingabe entfernt den letzten Chip; das **×** an einem Chip entfernt ihn. Duplikate werden ohne Hinweis case-insensitiv zusammengefasst (`Foo` und `foo` ergeben einen Tag). Der Zähler unter der Eingabe wird destruktiv, sobald das Limit erreicht ist (siehe [Limits](#limits)).

## Eine Nachricht als Prompt speichern

Du kannst jede Chat-Nachricht direkt aus der Konversation als Prompt-Vorlage speichern:

1. Öffne das Nachrichten-Menü und wähle **Prompt speichern**.
2. Der Nachrichteninhalt ist vorausgefüllt. Gib einen Titel und eine optionale Beschreibung an.
3. Der Prompt wird als Vorlage mit **Persönlich**-Sichtbarkeit gespeichert und sofort veröffentlicht.

Das ist ein schneller Weg, wirkungsvolle Prompts festzuhalten, ohne den Chat zu verlassen.

## Sichtbarkeiten

Prompts haben drei Sichtbarkeitsstufen:

| Sichtbarkeit   | Wer sie sehen kann             | Badge-Farbe |
| -------------- | ------------------------------ | ----------- |
| **Persönlich** | Nur du                         | Blau        |
| **Team**       | Mitglieder des gewählten Teams | Orange      |
| **Global**     | Alle in der Organisation       | Grün        |

Unveröffentlichte Prompts sind unabhängig von der Sichtbarkeit nur für ihre Ersteller sichtbar.

## Bearbeiten und Löschen

Nur der Prompt-Ersteller oder ein Organisations-Admin kann einen Prompt bearbeiten oder löschen. Nutze das Kontextmenü auf einer Zeile, um diese Aktionen aufzurufen.

Löschen ist endgültig und kann nicht rückgängig gemacht werden.

## Versionsverlauf

Jedes Speichern legt eine neue Version an. Öffne das Kontextmenü auf einer Zeile und wähle **Versionsverlauf**, um alle früheren Versionen dieses Prompts zu sehen. Der Dialog listet jede Version mit Veröffentlichungsdatum und Autor. Prompts, die seit dem Versionierungs-Release noch nicht bearbeitet wurden, haben noch keinen History-Dialog — bei der ersten Bearbeitung entsteht v2, das Menü wird verfügbar und v1 bleibt als vorheriger Zustand erhalten.

### Versionen vergleichen

Drücke **Eingabe** auf einer Version (oder klicke auf **Mit aktueller vergleichen**), um das Side-by-Side-Diff zu öffnen. Das Diff ist zeilenbasiert und für Prosa optimiert:

- Mit `−` markierte Zeilen sind im aktuellen Inhalt, aber nicht im verglichenen Snapshot vorhanden.
- Mit `+` markierte Zeilen sind im Snapshot. Genau diese würde **Wiederherstellen** zurückbringen.
- Metadaten-Änderungen (Titel, Beschreibung, Kategorie, Tags, Sichtbarkeit) stehen über dem Inhalts-Diff mit Vorher/Nachher-Werten.

Screenreader-Nutzende hören jede hinzugefügte/entfernte Zeile mit explizitem Präfix angesagt.

### Eine Version wiederherstellen

Drücke **R** oder **Umschalt+Eingabe** auf einer Version (oder klicke in der Vergleichsansicht auf **Wiederherstellen**), um den Prompt auf diesen Snapshot zurückzurollen. Wiederherstellen ist **umkehrbar** — es erzeugt eine neue Version v(aktuell + 1) mit Inhalt und Metadaten des Snapshots; die bisher aktuelle Version bleibt im Verlauf und lässt sich später ebenfalls wiederherstellen.

Hat jemand anderes inzwischen eine neue Version gespeichert, schlägt das Wiederherstellen fehl mit **Versionsverlauf hat sich geändert — aktualisiere und versuche es erneut**. Schließe und öffne den Dialog neu, um den aktuellen Stand zu sehen, bevor du es nochmal versuchst.

### Tastenkürzel im Versionsverlauf-Dialog

| Taste                        | Aktion                                             |
| ---------------------------- | -------------------------------------------------- |
| **↑ / ↓**                    | Zwischen Versionen wechseln                        |
| **Pos1 / Ende**              | Zur neuesten / ältesten Version springen           |
| **Eingabe**                  | Vergleichsansicht für die fokussierte Zeile öffnen |
| **R** / **Umschalt+Eingabe** | Die fokussierte Version wiederherstellen           |
| **Esc**                      | Den Dialog (oder die Vergleichsansicht) schließen  |

## Gleichzeitige Bearbeitung

Öffnest du einen Prompt zum Bearbeiten, während jemand anderes eine neue Version veröffentlicht, zeigt das Formular ein Banner: **Neuere Version verfügbar**. Klicke auf **Neueste laden**, um das Formular auf den aktuellen Snapshot zu re-ankern, bevor du speicherst — deine ungespeicherten Änderungen gehen dabei verloren, deshalb wird die Warnung bei dirty-Form destruktiv.

## Limits

Pro-Prompt-Limits (server-seitig erzwungen, client-seitig gespiegelt):

| Feld            | Limit                                |
| --------------- | ------------------------------------ |
| Inhalt          | 16 KiB (UTF-8)                       |
| Titel           | 200 Zeichen                          |
| Beschreibung    | 2 000 Zeichen                        |
| Kategorie       | 100 Zeichen                          |
| Tag (pro Stück) | 50 Zeichen                           |
| Tags (Anzahl)   | 20 pro Prompt                        |
| Verlauf         | 12 Versionen (ältester fällt heraus) |

Erreicht der Verlauf das Limit, fällt die älteste Version heraus (FIFO) und es wird ein Audit-Eintrag **history truncated** geschrieben.

## Rate-Limits

Mutationen auf Prompts sind pro Nutzer rate-limitiert, damit Bulk-Operationen freundlich bleiben. Bei Limit-Treffer erscheint ein Toast **Zu schnelles Speichern — bitte warte einen Moment**, und die Aktion läuft sauber weiter, sobald das Fenster sich zurücksetzt.

## Nutzungs-Zähler

Jeder Prompt verfolgt, wie oft er benutzt wurde. Der Nutzungs-Zähler wird auf der Prompt-Karte angezeigt und aktualisiert sich, sobald jemand den Prompt in eine Konversation einfügt.

## Wo das einsetzt

Die Prompt-Bibliothek ist die Oberfläche für wiederverwendbaren Text im Chat-Composer. Sie existiert aus dem gleichen Grund wie Versionskontrolle: der Prompt, den du letzte Woche geschrieben hast — der endlich die richtige Antwort brachte — sollte einmal gespeichert und aus jeder Konversation erreichbar sein, nicht aus einer Chat-Verlauf-Suche herausgekramt. Persönliche Scopes sind für Entwürfe; Team-Scopes für gemeinsame Arbeitsabläufe; organisationsweite Scopes für kanonische Vorlagen, zu denen die ganze Firma greifen soll.

Für Prompts, die das KI-Verhalten dauerhaft ändern statt nur eine Nachricht rahmen, bearbeite die Anweisungen des Agents unter [Agent erstellen](/de/platform/agents/create) — die Anweisungen sind der Prompt, der vor _jeder_ Nachricht in einer Agent-Konversation läuft, während ein Bibliotheks-Prompt der Körper einer einzelnen Nachricht ist.
