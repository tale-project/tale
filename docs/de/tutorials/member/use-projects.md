---
title: Ein Projekt für gemeinsamen Kontext nutzen
description: Stelle eine Frage, die die Dateien eines Projekts beantworten, teile das Gespräch und übergib die Folgearbeit einem Projekt-Agenten.
---

Ein Projekt hält Dateien, Anweisungen, Gespräche und Aufgaben zu einer Arbeit zusammen. In dieser Anleitung stellst du eine Frage, die eine Referenzdatei des Projekts beantwortet, teilst das hilfreiche Gespräch und übergibst das daraus folgende Ergebnis einem Agenten des Projekts. Plane etwa fünfzehn Minuten ein, zuzüglich der Zeit für die Indexierung und den Lauf des Agenten.

## Bevor du beginnst

Als **Mitglied** arbeitest du in den Projekten, die mit dir geteilt sind: Du stellst Fragen in ihren Chats, teilst Gespräche und legst Aufgaben für die Agenten des Projekts an. Nimm ein Projekt, das du öffnen kannst, mit einer indexierten Referenzdatei und mindestens einem Agenten, und beginne bei [Eine Frage stellen und die Quelle prüfen](#eine-frage-stellen-und-die-quelle-pruefen). Um ein Projekt zu erstellen, Dateien hochzuladen, Anweisungen zu speichern und Agenten anzulegen, brauchst du die Rolle **Redakteur** oder höher; richtest du das Projekt ein, beginne bei [Das Projekt einrichten](#das-projekt-einrichten). Du brauchst ein kurzes Textdokument, eine PDF mit auswählbarem Text oder eine Datei in einem modernen Office-Format. Wähle eine Quelle, deren Angaben du nachprüfen kannst, etwa ein Projektbriefing mit einer verantwortlichen Person und einem Prüftermin. Ein Admin muss den Dateispeicher und ein Embedding-Modell für durchsuchbare Uploads eingerichtet haben.

Neue Projekte sind **Organisationsweit** sichtbar. Verwende für diese Anleitung keine vertraulichen Unterlagen. Soll das spätere Projekt nur bestimmten Teams zugänglich sein, lege das zuständige Team unter **Allgemein > Freigabe** fest, bevor du Dateien hochlädst. Projektchats bleiben persönlich, bis du sie teilst.

## Das Projekt einrichten

Redakteure und höhere Rollen erledigen das einmal pro Projekt. Mitglieder springen zu [Eine Frage stellen und die Quelle prüfen](#eine-frage-stellen-und-die-quelle-pruefen).

### Das Projekt erstellen

1. Klicke im Bereich **Start** auf **Neues Projekt**, das Ordnersymbol neben **Projekte**.
2. Gib unter **Projektname** einen eindeutigen Namen ein, etwa `Website-Relaunch`.
3. Prüfe das **Projektkürzel**. Es bildet den Anfang von Aufgabenkennungen wie `WEB-1` und lässt sich nach dem Erstellen nicht mehr ändern.
4. Ergänze bei Bedarf eine **Beschreibung** und klicke auf **Projekt erstellen**.

Das neue Projekt öffnet sich unter **Aufgaben** und erscheint im Bereich **Start** unter **Projekte**. Neben **Aufgaben** findest du im Projekt **Allgemein**, **Chats**, **Wissen** und **Agenten**. Für einen Projektchat musst du keinen Agenten anlegen.

### Eine Referenzdatei hochladen

Öffne **Wissen** im Projekt und klicke auf **Datei hinzufügen** oder ziehe die Datei auf die Upload-Fläche. Die Datei erscheint im Projektdateibaum. Warte auf **Indexiert**, bevor du dich auf die Suche verlässt. **In Warteschlange** und **Wird indexiert…** bedeuten, dass die Vorbereitung noch läuft.

<Frame caption="Unter Wissen liegen die Referenzdateien des Projekts. Der Status neben jeder Datei zeigt, ob sie durchsuchbar ist.">

![Im Bereich Wissen des Projekts Website relaunch stehen zwei indexierte Dateien sowie Schaltflächen zum Hinzufügen von Dateien und Ordnern.](/images/platform/project-knowledge-files.webp)

</Frame>

Eine hier hochgeladene Datei gehört zu diesem Projekt. Stelle Fragen dazu in einem Projektchat. Der allgemeine Chat der Organisation durchsucht keine Projektdateien.

### Anweisungen für alle Projektchats hinterlegen

Öffne **Allgemein** und beschreibe unter **Anweisungen** den Kontext oder die Regeln, die für jeden Chat gelten sollen. Zum Beispiel:

> Nutze bei Fragen zu diesem Launch die Projektdateien. Nenne die Quelle für Termine und Entscheidungen. Falls kein Launch-Termin genehmigt wurde, kennzeichne ihn als unbestätigt.

Klicke oben auf **Speichern**. Die Anweisungen gehören zum Kontext der Projektchats. Die zugrunde liegenden Dokumente musst du trotzdem hochladen; der Assistent muss sie für seine Antwort abrufen.

<Frame caption="Die Anweisungen stehen unter Allgemein neben Projektname und Beschreibung.">

![Die Registerkarte Allgemein enthält Projektname, Beschreibung, den Editor für Anweisungen und den Bereich Freigabe sowie Speichern und Verwerfen in der Kopfzeile.](/images/platform/project-general-tab.webp)

</Frame>

Für den letzten Teil dieser Anleitung braucht das Projekt außerdem einen Agenten. [Projekt-Agenten](/de/platform/projects/project-agents) erklärt, wie du einen anlegst.

## Eine Frage stellen und die Quelle prüfen

Öffne **Chats** und klicke auf **Neuer Chat**. Lass die Modellauswahl auf **Auto**, sofern verfügbar, und stelle eine Frage, die deine Datei beantwortet. Bei einem Launch-Briefing etwa:

> Lies das Launch-Briefing. Wer ist für die Prüfung zuständig, und welche Termine stehen fest? Nenne die Datei als Quelle und unterscheide bestätigte Termine von offenen Entscheidungen.

Prüfe die Such- und Leseschritte über der Antwort und vergleiche die Angaben mit der Datei. Eine flüssige Antwort ohne passende Quelle belegt nicht, dass Tale das Dokument verwendet hat. Öffne bei Bedarf das Original unter **Wissen**.

<Tip>

Nenne die Datei und eine konkrete Frage. „Welcher Prüftermin ist im Launch-Briefing bestätigt?“ gibt dem Assistenten ein klareres Suchziel als „Erzähl mir etwas über das Projekt“.

</Tip>

## Einen hilfreichen Chat teilen

Die Registerkarte **Chats** unterscheidet **Deine Chats** und **Mit Projekt geteilt**. Aktiviere **Mit Projekt teilen**, wenn die Personen mit Projektzugriff den Chat lesen sollen. Das Hochladen von Projektdateien gibt deine Chats nicht automatisch frei.

Für einen einzelnen Link zu einer Momentaufnahme für Organisationsmitglieder lies [Geteilte Chats](/de/platform/chat/shared-threads). Prüfe den Text vor der Freigabe: Er kann Angaben aus Quellen enthalten, die nur einem kleineren Personenkreis zugänglich sind.

## Die Folgearbeit einem Projekt-Agenten übergeben

Der Chat beantwortet Fragen, erstellt aber keine Dateien. Soll aus der Antwort ein Dokument werden, etwa eine einseitige Launch-Zusammenfassung, übergib die Arbeit mit einer Aufgabe einem Agenten des Projekts.

1. Öffne im Gespräch das Menü **⋯** und wähle **Aufgabe aus Chat erstellen**. Weil der Chat zu diesem Projekt gehört, öffnet sich **Aufgabe erstellen** dort, mit deiner letzten Frage als Beschreibung, einem Link zurück zum Chat und den Dateien, die du angehängt hast.
2. Formuliere die Beschreibung als gewünschtes Ergebnis, zum Beispiel: `Erstelle aus dem Briefing eine einseitige Launch-Zusammenfassung als Word-Dokument. Nenne für jeden Termin das Briefing als Quelle.`
3. Wähle unter **Zuständig** einen Agenten des Projekts und klicke auf **Aufgabe erstellen**.
4. Wähle in der Bestätigung **Aufgabe öffnen** und dann **Agent starten**.

Wenn der Lauf endet, steht der Bericht des Agenten in den Kommentaren der Aufgabe, die Datei unter **Ergebnisdateien**, und die Aufgabe wartet auf **In Prüfung**. Erwähne den Agenten mit `@` in einem Kommentar, um Änderungen zu erbitten, und setze die Aufgabe auf **Erledigt**, wenn das Ergebnis der Beschreibung entspricht.

Wer ein Projekt öffnen kann, legt darin Aufgaben an. Ein Lauf, den ein Mitglied startet, bleibt bei dieser Aufgabe und ihren Unteraufgaben und arbeitet ohne die Secrets des Agenten; [Agentenläufe, die ein Mitglied startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet) zählt die Grenzen auf.

## Wenn die Datei in der Antwort fehlt

| Beobachtung | Prüfung |
| --- | --- |
| Der Upload scheitert, bevor eine Zeile erscheint | Versuche es mit einer kleinen Datei in einem unterstützten Format. Scheitert auch das, bitte einen Admin, Dateispeicher und Upload-Regeln zu prüfen. |
| **In Warteschlange** oder **Wird indexiert…** | Warte auf das Ende der Verarbeitung und stelle die Frage erneut. |
| **Fehlgeschlagen** | Nutze **Indexierung erneut versuchen**. Wiederholt sich der Fehler, sollte ein Admin Embedding-Modell und Wissensdienst prüfen. |
| **Nicht indexiert** | Nutze **Jetzt indexieren**, sofern angeboten. Hat eine alte Office-Datei keinen unterstützten Textextraktor, speichere sie im modernen Format neu. |
| **Indexiert**, aber keine passende Quelle in der Antwort | Prüfe, ob der Chat zu diesem Projekt gehört. Nenne die Datei und frage nach einer einzelnen Angabe. Vergleiche die Antwort mit dem Original. |

Das Projekt hält jetzt Quellen, Gespräche und Aufgaben zusammen. [Aufgaben auf dem Projektboard verwalten](/de/platform/projects/tasks) beschreibt Board, Prüfung und wiederkehrende Arbeit.
