---
title: Deinen ersten Agenten erstellen
description: Richte einen Projektagenten für eine kleine Textaufgabe ein, starte ihn über die Aufgabenübersicht und prüfe sein Ergebnis.
---

Erstelle einen Agenten, der eine Kontaktnachricht zusammenfasst und einen nächsten Schritt empfiehlt. Diese Übung nutzt die Aufgabenbeschreibung als Eingabe. So kannst du den gesamten Ablauf prüfen, bevor Connectoren oder gemeinsames Wissen hinzukommen: Agent einrichten, eine Aufgabe starten und das Ergebnis prüfen.

## Bevor du beginnst

Du brauchst ein Projekt mit Bearbeitungszugriff, einen verfügbaren Coding-Agent-Harness mit passenden Modellzugangsdaten und eine funktionierende Sandbox-Zuteilung. Ein Administrator verwaltet [KI-Provider](/de/platform/admin/providers) und [Sandboxes](/de/platform/admin/sandboxes). Dass ein Modell im Chat funktioniert, genügt allein nicht: Der gewählte Harness muss seine Zugangsdaten verwenden können.

Fehlen die Agentenseite oder die Modellauswahl, kläre zuerst Zugriff und Einrichtung. Für diese Übung sind keine Skills, Connectoren, Plattform-Tools oder eingeblendeten Secrets nötig.

## Den Agenten erstellen

Öffne **Agenten** im Projekt und klicke auf **Neuer Agent**.

<Frame caption="Die Agententabelle zeigt Harness, Provider und Modell jedes Agenten.">

![Website relaunch listet Content editor mit Claude Code und Redirect auditor mit Codex samt Provider und Modell neben Neuer Agent.](/images/platform/project-agents-models.webp)

</Frame>

1. Gib unter **Name** `Triage-Assistent` ein.
2. Wähle einen **Agent-Laufzeit**, den dein Administrator eingerichtet hat.
3. Suche unter **Modell** nach Modellname oder API-ID und wähle den Eintrag des gewünschten Providers. Dasselbe Modell kann von mehreren Providern angeboten werden.
4. Lass **Skills, Connectors & Tools** und **Secrets** für diese Übung leer.
5. Füge die folgenden Anweisungen unter **Anweisungen** ein und klicke auf **Agent erstellen**.

```text
Lies die Kontaktnachricht in der Aufgabenbeschreibung. Antworte in zwei Zeilen:
Zusammenfassung: ein Satz darüber, was die Person benötigt.
Nächster Schritt: antworten, eskalieren oder schließen, mit kurzer Begründung.
Enthält die Nachricht kein verwertbares Anliegen, nenne die fehlende Information.
Kontaktiere niemanden und ändere keine Datensätze.
```

Der neue Agent kann sofort einer Aufgabe zugewiesen werden. Eine gesonderte Veröffentlichung gibt es nicht. Seine Anweisungen beschreiben die wiederkehrende Arbeit; die einzelne Nachricht gehört in die Aufgabe.

## Eine Aufgabe mit prüfbarer Antwort übergeben

Öffne **Aufgaben**, erstelle `Anfrage nach Rechnungskopie einordnen` und füge diese Beschreibung ein:

```text
Kontaktnachricht:
„Hallo, ich habe die Bestellbestätigung erhalten, finde aber die Rechnung
nicht. Könnt ihr mir eine Kopie schicken? Die Bestellnummer ist A-1042.“

Abnahmekriterien:
- Fasse das Anliegen in einem Satz zusammen.
- Empfiehl antworten, eskalieren oder schließen und begründe die Wahl.
- Behaupte nicht, dass die Rechnung bereits verschickt wurde.
```

Weise die Aufgabe `Triage-Assistent` zu. Lege in den Details einen **Reviewer** fest, wenn jemand anderes prüfen soll; andernfalls erhält der Ersteller der Aufgabe die Prüfanfrage. Klicke auf **Agent starten**. Die Zuweisung allein startet keine Arbeit.

Die Aufgabe wechselt zu **In Bearbeitung**. Ein erfolgreicher Lauf veröffentlicht seinen Bericht als Kommentar und verschiebt sie nach **In Prüfung**. Damit er abschließen kann, müssen Sandbox und Provider funktionieren.

## Das Ergebnis prüfen und verbessern

Vergleiche den Agentenkommentar mit den Abnahmekriterien. Eine passende Antwort erkennt die Bitte um eine Rechnungskopie und empfiehlt eine Antwort. Sie darf nicht behaupten, eine E-Mail sei verschickt worden. Die Formulierung kann je nach Modell abweichen.

Setze die Aufgabe auf **Erledigt**, wenn du das Ergebnis akzeptierst. Fehlt etwas, erwähne den zugewiesenen Agenten in einem Aufgabenkommentar und formuliere eine konkrete Korrektur: „Fasse das Anliegen in nur einem Satz zusammen und begründe, warum eine Antwort nötig ist.“ Die Nacharbeit setzt das Aufgabengespräch fort und liefert ein neues Ergebnis zur Prüfung.

<Tip>

Nutze einen Aufgabenkommentar für eine einmalige Korrektur. Ändere die Agentenanweisungen, wenn dieselbe Regel auch für künftige Aufgaben gelten soll. Ergänze Tools erst, wenn eine spätere Übung das Lesen oder Ändern von Informationen außerhalb der übergebenen Eingabe braucht.

</Tip>

## Wenn der Lauf nicht startet oder abschließt

Bei einem fehlenden Modell müssen Provider und Harness geprüft werden. Bei einem Sandbox-Fehler prüft ein Administrator Kapazität und Infrastruktur. Ein fehlgeschlagener Aufgabenlauf bleibt zur Untersuchung sichtbar. Behebe die Ursache, bevor du ihn wiederholst, und starte nicht erneut, solange bereits ein Lauf aktiv ist.

[Aufgaben automatisieren](/de/platform/projects/task-automation) erklärt Wiederholung, Abbruch, Übergabe zur Prüfung und Nacharbeit. [Projektagenten](/de/platform/projects/project-agents) beschreibt die Ausstattung, die du nach dieser ersten erfolgreichen Aufgabe ergänzen kannst.
