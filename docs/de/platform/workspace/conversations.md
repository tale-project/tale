---
title: Konversationen
description: Kundenkonversationen aus einem zentralen Posteingang verwalten.
---

**Konversationen** ist der Kunden-Posteingang. Wenn Kunden dein Team über einen angebundenen Kanal wie E-Mail kontaktieren, erscheinen ihre Nachrichten hier als Konversationen. Dein Team kann sie aus dieser einen Ansicht heraus lesen, beantworten, schließen und verwalten.

Kanal-Anbindungen werden einmalig von einem Entwickler unter [Integrationen – Überblick](/de/platform/integrations/overview) eingerichtet — die E-Mail-Integration liefert diesen Posteingang.

## Konversations-Status

| Status      | Bedeutung                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Offen       | Aktive Konversation, die eine Antwort braucht oder in Bearbeitung ist.                             |
| Geschlossen | Konversation, die gelöst und als erledigt markiert wurde.                                          |
| Spam        | Als unerwünscht oder irrelevant markierte Nachrichten.                                             |
| Archiviert  | Konversationen, die als Referenz erhalten bleiben, aber aus dem aktiven Posteingang entfernt sind. |

## Auf eine Konversation antworten

1. Klicke in der Liste auf eine Konversation, um sie im rechten Panel zu öffnen.
2. Der Nachrichten-Composer lädt unten. Es ist ein Rich-Text-Editor mit Unterstützung für Fett, Kursiv, Listen, Links und Code-Blöcke.
3. Schreibe deine Antwort. Mit dem Büroklammer-Icon in der Toolbar kannst du Dateien anhängen.
4. Nutze den Button **Mit KI verbessern** (falls aktiviert), damit die KI deine Nachricht vor dem Senden aufräumt.
5. Klicke auf **Senden**. Die Nachricht wird über den Kanal gesendet, den der Kunde genutzt hat.

## Sammelaktionen

Wähle mehrere Konversationen über das Kontrollkästchen oben in der Liste aus. Verfügbare Sammelaktionen:

- Status ändern: Schließen, Wieder öffnen, Archivieren oder als Spam markieren.
- Eine Nachricht an alle ausgewählten Konversations-Teilnehmer gleichzeitig senden.

## Filtern

Nutze das Filter-Dropdown in der Toolbar, um gelesene oder ungelesene Konversationen anzuzeigen. So sehen deine Teamkolleginnen und Teamkollegen auf einen Blick, was noch Aufmerksamkeit braucht, ohne durch den gesamten Posteingang zu scrollen.

## Wo das hingehört

Konversationen ist Tales gemeinsamer Posteingang für kundenseitige Kanäle — E-Mail, Chat und Sprache. Er existiert, weil Kundenantworten nicht in den AI-Chat passen: Antworten brauchen einen Menschen im Loop, einen einzelnen Thread pro Kunde über Kanäle hinweg und einen Auditrekord, den Prüfer einsehen können. Der Agent, der die KI-Seite bedient, ist derselbe Agent, den der Rest des Arbeitsbereichs nutzt; was sich ändert, ist die Oberfläche.

Für die agent-seitige Konfiguration, die entscheidet, welche Konversationen automatisch entworfene Antworten bekommen, siehe [Agent-Konzepte](/de/platform/agents/concepts) und [Agent erstellen](/de/platform/agents/create). Für Genehmigungen, die aus Kunden-Threads herausfallen (ein Antwort-Entwurf, der auf Prüfung wartet, ein Integration-Aufruf, der auf Freigabe wartet), ist [Genehmigungen](/de/platform/workspace/approvals) die Oberfläche.
