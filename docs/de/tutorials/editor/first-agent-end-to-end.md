---
title: Deinen ersten Agent bauen
description: Bring ein frisches Projekt von „ich will einen Agent“ zu einem geprüften Aufgaben-Ergebnis — leg einen Projekt-Agenten mit Agent-Laufzeit, Modell und einem Absatz Anweisungen an, gib ihm eine echte Aufgabe und prüfe, was zurückkommt.
---

Ein erster Agent ist das kleinste nützliche Ding in Tale: ein Name, eine Agent-Laufzeit, ein Modell und ein Absatz Anweisungen im Tab **Agenten** eines Projekts. Dieser Durchlauf legt einen an, gibt ihm eine echte Aufgabe und prüft das Ergebnis dort, wo die Arbeit jedes Agenten wartet — in der Spalte **In Prüfung**. Die Form verallgemeinert sich: Jeder Agent, den du später baust, sind dieselben vier Züge mit anderen Entscheidungen, und die Schleife am Ende ist die, in der du die meiste Zeit verbringst.

Du brauchst Bearbeitungsrechte an einem Projekt und mindestens einen Provider unter **Einstellungen > KI-Anbieter** mit einem Modell darauf. Die konzeptionelle Seite steht in [Agent-Konzepte](/de/platform/agents/concepts), die Referenz Feld für Feld in [Projekt-Agenten](/de/platform/projects/project-agents); dieser Durchlauf ist die Mechanik von Anfang bis Ende.

## Bevor du beginnst

Prüf drei Dinge. Du darfst das Projekt bearbeiten — wer das darf, legt seine Agenten an, ändert und löscht sie, bis zu 50 pro Projekt. Die Organisation hat einen Provider mit mindestens einem Modell konfiguriert; ohne den gibt es unter **Modell** nichts zu wählen, und der Lauf am Ende hat nichts, was er aufrufen könnte. Und du hast eine Aufgabe im Kopf, die eng genug ist, dass ein Absatz Anweisungen sie rahmt — dieser Durchlauf nimmt „fass eine eingehende Kontaktnachricht in einem Satz zusammen und empfiehl den nächsten Schritt“.

## Schritt 1 — Den Agenten benennen und seinen Antrieb wählen

Öffne den Tab **Agenten** des Projekts. Er listet die Crew des Projekts, eine Zeile pro Agent, und hier landet der Agent, den du gleich anlegst.

<Frame caption="Der Tab Agenten — jede Zeile nennt Agent-Laufzeit, Provider und Modell des Agenten.">

![Der Tab Agenten des Projekts Website relaunch mit zwei benannten Agenten — Content editor auf Claude Code und Redirect auditor auf Codex — jede Zeile mit Provider und Modell-ID, neben dem Knopf Neuer Agent.](/images/platform/project-agents-models.webp)

</Frame>

Klick auf **Neuer Agent**. Die ersten drei Felder entscheiden, was läuft:

- **Name** — `Triage assistant`. Dein Team sieht ihn auf Aufgabenkarten, also benenn ihn nach der Aufgabe.
- **Agent-Laufzeit** — das Coding-Harness, auf dem der Agent läuft. [Harnesses](/de/platform/agents/harnesses) vergleicht sie und sagt, welche Zugänge jedes akzeptiert.
- **Modell** — die Liste ist durchsuchbar, und ein Modell, das mehrere Provider anbieten, erscheint einmal pro Provider. Die Wahl ist exakt: Die Läufe rufen dieses Modell über diesen Provider auf, und die Kosten landen auf dessen Zugang.

## Schritt 2 — Die Ausrüstung leer lassen

**Skills, Connectors & Tools** bestimmen, was der Agent jenseits seiner Sandbox erreicht: Skills stellen Referenz-Bundles bereit, Connectors vermitteln einen verbundenen Dienst, und Plattform-Tools lassen ihn die Aufgaben, Dokumente und das Wissen des Projekts lesen — oder, wenn du ein Schreib-Tool gibst, ändern. Für die Triage gib nichts: Der Agent liest Eingabe und schreibt Ausgabe, und jedes Tool, das du gewährst, weitet die Vertrauensgrenze. Lass auch **Secrets** leer — das ist der Ausweg für einen Dienst ohne Connector, und dieser Agent ruft keinen auf.

Soll der Agent die empfohlene Aktion später in ein CRM schreiben, rüstest du ihn dann mit dem passenden Connector aus — aber nicht, bevor die reine Text-Variante funktioniert.

## Schritt 3 — Die Anweisungen schreiben und den Agenten anlegen

**Anweisungen** reisen bei jedem Lauf als stehende Anweisung mit — was der Agent verantwortet, wie er arbeitet und wo er aufhört. Bei diesem Feld übertreiben die meisten; halt es unter einem Absatz:

```text
You read a contact message and produce two lines. Line one: a one-sentence summary in plain English. Line two: a recommended next action — reply, escalate, or close. If the message is blank or off-topic, refuse and say so.
```

Klick auf **Agent erstellen**. Die Zeile nennt Agent-Laufzeit, Provider, Modell und die Ausrüstungszahl — einen Veröffentlichen-Schritt gibt es nicht, und der Agent lässt sich ab diesem Moment zuweisen.

## Schritt 4 — Eine Aufgabe übergeben und das Ergebnis prüfen

Erstell eine Aufgabe auf dem Projekt-Board, füg eine echte Kontaktnachricht in ihre Beschreibung ein und wähl im Aufgabenblatt einen **Reviewer** — ohne ihn landet die Prüfanfrage bei dem, der die Aufgabe erstellt hat. Weis die Aufgabe dem `Triage assistant` zu und klick auf **Agent starten**. Die Karte wandert nach _In Bearbeitung_, während der Agent in seiner Sandbox arbeitet; ist er fertig, landet sein Bericht als Aufgaben-Kommentar, und die Karte parkt bei **In Prüfung** — auf _Erledigt_ setzt ein Agent nie.

Lies den Kommentar: Er sollte gemäß den Anweisungen zwei Zeilen enthalten, eine Ein-Satz-Zusammenfassung und eine empfohlene Aktion. Zieh die Karte nach _Erledigt_, um sie anzunehmen. Ist das Format abgedriftet, erwähn den Agenten mit @ in einem Aufgaben-Kommentar samt Korrektur — ein Nacharbeits-Lauf setzt dasselbe Gespräch fort und parkt das Ergebnis wieder bei _In Prüfung_ — und zieh die **Anweisungen** am Agenten fürs nächste Mal straffer; Änderungen greifen ab dem nächsten Lauf.

## Wo das hingehört

Vier Züge, ein Agent, ein geprüftes Ergebnis: dieselbe Form, der jeder später gebaute Agent folgt. [Aufgaben-Automatisierung](/de/platform/projects/task-automation) ist die Board-Schleife, die du gerade gefahren bist, von Anfang bis Ende — die Trennung von Driver und Reviewer, Erwähnungen, Wiederholungen und der Notausschalter. [Projekt-Agenten](/de/platform/projects/project-agents) ist die Referenz für jedes Feld, das du angefasst hast, und [Agent-Konzepte](/de/platform/agents/concepts) das Modell dahinter.

Die Stellschrauben, die früher in einem Agenten-Editor saßen, liegen in dieser Version woanders: Wissen gehört der ganzen Organisation unter [Wissen](/de/platform/knowledge/overview) und wird über Plattform-Tools erreicht ([Projekt-Agenten](/de/platform/projects/project-agents) erklärt, wie), und Arbeit, die ohne Menschen laufen soll, ist eine [Automatisierung](/de/platform/automations/concepts) und kein zweiter Agent.
