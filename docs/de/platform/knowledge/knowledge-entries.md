---
title: Wissenseinträge
description: Halte eine kurze, gemeinsame Information fest, aktualisiere sie bei Änderungen und prüfe frühere Fassungen im Verlauf.
---

Ein Wissenseintrag eignet sich für kurze Informationen, die dein Team später wiederfinden soll: Supportzeiten, Rückgabefristen oder die Zuständigkeit für einen Prozess. Jeder Eintrag besteht aus Thema und Inhalt. Für eine vollständige Richtlinie oder einen Bericht wähle ein [Dokument](/de/platform/knowledge/documents); für benannte Felder und genaue Werte nutze [strukturierte Daten](/de/platform/knowledge/structured-data).

Mitglieder können Einträge lesen. Zum Erstellen, Bearbeiten und Löschen brauchst du die Rolle Redakteur oder höher. Einträge gehören zum gemeinsamen Wissen der Organisation. Persönliche Notizen und Informationen, die nur für ein bestimmtes Projekt gedacht sind, gehören deshalb an einen anderen Ort.

## Eine Information hinzufügen

<Steps>

<Step title="Das Formular öffnen">

Gehe zu **Wissen > Wissenseinträge** und klicke auf **Eintrag hinzufügen**. Fehlt die Aktion, lass einen Administrator deine Rolle prüfen.

</Step>

<Step title="Ein dauerhaftes Thema wählen">

Trage unter **Thema** zum Beispiel `Reaktionszeit des Supports` ein. Wähle einen Namen, der auch nach einer inhaltlichen Änderung passt. Das Thema darf bis zu 120 Zeichen lang sein und muss eindeutig sein. Meldet Tale ein Duplikat, bearbeite den vorhandenen Eintrag.

</Step>

<Step title="Den nötigen Zusammenhang festhalten">

Schreibe unter **Inhalt** die Information, ihren Geltungsbereich und mögliche Bedingungen. Markdown wird unterstützt; bis zu 8.000 Zeichen sind möglich. Zum Beispiel:

```markdown
Der Support strebt eine erste Antwort innerhalb von 45 Minuten während
der Geschäftszeiten an: Montag–Freitag, 09:00–17:00 Uhr MEZ. Das ist ein
Antwortziel, keine Frist zur Problemlösung. Zuständig: Support Operations.
```

Vermeide relative Zeitangaben wie „nächsten Freitag“ und Verweise wie „die Richtlinie oben“. Der Eintrag muss auch für sich allein verständlich sein.

</Step>

<Step title="Speichern und die Indexierung prüfen">

Klicke auf **Speichern**. Der Eintrag erscheint mit Thema, Inhalt, Quelle (**Manuell** für das Formular, **Chat** für eine Information, die der Assistent festgehalten hat, **API** für eine, die eine Integration über REST geschrieben hat, **Agent** für eine, die ein Agent gespeichert hat), Indexierungsstatus und Änderungszeit in der Tabelle. Öffne ihn, um den gesamten Inhalt zu lesen. Die Indexierung läuft im Hintergrund: Ein gespeicherter Eintrag ist nicht sofort für die Suche bereit.

</Step>

</Steps>

<Frame caption="Prüfe Information und Indexierungsstatus in der Tabelle, bevor du dich in einer Antwort darauf verlässt.">

![Die Tabelle der Wissenseinträge zeigt manuelle Informationen mit Thema, Inhalt, Quelle, Indexierungsstatus und Änderungszeit.](/images/platform/knowledge-entries-list.webp)

</Frame>

## Eine vorhandene Information korrigieren

Öffne das Zeilenmenü, wähle **Bearbeiten**, ändere den Inhalt und klicke auf **Speichern**. Damit entsteht eine neue aktuelle Fassung; ihr Text wird erneut zur Indexierung vorgemerkt. Pro Thema gibt es einen aktuellen Eintrag. Eine Korrektur am bestehenden Eintrag vermeidet widersprüchliche Antworten.

Öffne nach einer Korrektur die Details und den **Versionsverlauf**. Frühere Fassungen zeigen, was geändert wurde und wann sie ersetzt wurden; sie sind keine zusätzlichen aktuellen Informationen. Bei einem Eintrag, der nie bearbeitet wurde, steht dort, dass es noch keine früheren Versionen gibt. Die **Versions-ID** in den Details gehört zur aktuellen Fassung und ändert sich bei jeder Bearbeitung; das Thema kennzeichnet den Eintrag über alle Versionen hinweg. Anwendungen können Einträge auch über die [REST-API](/de/develop/api-reference) erstellen und ändern.

<Tip>

Wenn ein Chat eine nützliche Information liefert, prüfe sie anhand der Quelle. Erstelle oder bearbeite den Eintrag anschließend selbst. Chat speichert Informationen nicht automatisch in der Wissensbasis der Organisation.

</Tip>

## Einen Agenten Informationen aktuell halten lassen

Auch ein Projektagent oder der Agentenschritt einer Automatisierung kann Informationen speichern. Gib ihm dazu unter **Skills, Connectors & Tools** in der [Ausstattung des Agenten](/de/platform/projects/project-agents) das Tool **Wissenseinträge hinzufügen und bearbeiten**. Der Agent speichert eine Information pro Thema; ein Thema ohne Eintrag erhält einen neuen, mit **Agent** als Quelle.

Um einen vorhandenen Eintrag zu ändern, muss der Agent die Version nennen, die er gelesen hat. Hat eine Person oder ein anderer Agent den Eintrag inzwischen geändert, wird nichts gespeichert: Der Agent erhält den aktuellen Text und führt seine Änderung darin zusammen. Der **Versionsverlauf** bewahrt jeden früheren Text auf, wie bei deinen eigenen Änderungen.

Einträge gehören der ganzen Organisation. Ein Lauf, den ein Mitglied gestartet hat, kann deshalb keine speichern, und kein Agent kann einen Eintrag löschen. Für Agenten gilt ein eigenes Limit, wie viele Einträge sie pro Minute speichern, sodass ein beschäftigter Agent niemanden beim Bearbeiten aufhält. Jede Speicherung durch einen Agenten wird im Audit-Log festgehalten.

Durchsuchen können Agenten das Wissen immer, ohne Freigabe: Das Ausstattungsmenü zeigt das als **Wissen durchsuchen**, immer aktiv.

## Einen veralteten Eintrag entfernen

Wähle **Löschen** im Zeilenmenü und lies die Bestätigung. Dadurch verschwinden der Eintrag und seine früheren Fassungen aus dieser Ansicht; das zugehörige Dokument steht der Wissenssuche nicht mehr zur Verfügung. Sichere den Text vorher, falls du ihn noch brauchst. Für eine Korrektur ist **Bearbeiten** der passende Weg.

## Wenn die Information in einer Antwort fehlt

Prüfe zuerst den aktuellen Eintrag: Ist er gespeichert und fertig indexiert? Benennt die Frage das Thema eindeutig? Ist die Indexierung fehlgeschlagen, behebe die angegebene Ursache und starte sie über die Wiederholungsaktion erneut. Bei anhaltenden Fehlern muss ein Administrator die Embedding-Konfiguration und die Indexierungsdienste prüfen.

Bitte den Assistenten um einen Quellenbeleg, öffne die Quelle und vergleiche sie mit dem Eintrag. Eine plausibel klingende Antwort beweist noch nicht, dass die aktuelle Information verwendet wurde. Die gemeinsamen Indexierungszustände erklärt [Dokumente](/de/platform/knowledge/documents).

## Wenn die Liste oder der Verlauf nicht lädt

Schlägt das Laden fehl, meldet Tale das dort, wo die Inhalte stehen würden. Ein Fehler erscheint nie als leere Bibliothek oder als Eintrag ohne Verlauf. **Erneut versuchen** wiederholt den Abruf, ohne dass du die Seite neu laden musst:

- Lässt sich kein Eintrag laden, zeigt die Tabelle statt des leeren Zustands den Fehler mit **Erneut versuchen**.
- Sind bereits Einträge zu sehen, bleiben sie stehen, und ein Hinweis über der Tabelle sagt, dass die Liste unvollständig oder veraltet sein kann. Deine Suche und die ausgewählten Zeilen bleiben beim erneuten Versuch erhalten. Konnten weitere Einträge nicht geladen werden, steht das unter der Tabelle, und eine Suche umfasst nur die geladenen Einträge.
- Lässt sich in den Details eines Eintrags der **Versionsverlauf** nicht laden, sagt der Abschnitt das und bietet **Erneut versuchen** an. Der aktuelle Inhalt bleibt lesbar.

Scheitert **Erneut versuchen** immer wieder, bitte einen Administrator zu prüfen, ob die Dienste von Tale laufen.
