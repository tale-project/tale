---
title: Aufgaben-Automatisierung
description: Wie die Zuweisung einer Board-Aufgabe an einen Agenten ihn arbeiten lässt, die Trennung von Zuständig und Reviewer, die Prüfung direkt über den Status In Prüfung, Leitplanken und der Notausschalter.
---

Eine Board-Aufgabe einem KI-Agenten zuzuweisen setzt ihn in Bewegung. Wer bei der Aufgabe als **Zuständig** eingetragen ist — eine Person, ein Projekt-Agent oder eine Automatisierung — treibt die Arbeit und die Board-Choreografie; der **Reviewer** ist der benannte Mensch, auf den das fertige Ergebnis wartet. Eine Aufgabe, die eine Automatisierung vorschlägt, liegt im [Backlog](/de/platform/projects/backlog), bis ein Mensch sie startet — von diesem Moment an ist sie eine Board-Aufgabe wie jede andere und tritt in die Schleife unten ein.

<Frame caption="Das Aufgaben-Board eines Projekts — eine Karte einem Agenten zuzuweisen startet die Schleife unten.">

![Ein Kanban-Aufgaben-Board im Projekt Website-Relaunch mit sieben Aufgabenkarten, verteilt über seine Status-Spalten, von Backlog und Zu erledigen über In Prüfung bis Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Die Ausführungsschleife

1. **Weise** die Aufgabe einem Agenten zu. Die Karte wandert nach _In Bearbeitung_, und der Agent arbeitet in seiner eigenen Sandbox-Session — mit Beschreibung, Kommentaren und Eingabedateien der Aufgabe als Kontext.
2. Der Agent **meldet sich zurück**: Sein Ergebnis landet als Kommentar an der Aufgabe (Dateien in der Output-Zone), und die Aufgabe parkt auf **_In Prüfung_** — Agenten können nie auf _Erledigt_ stellen; diese Regel setzt der Server durch.
3. Mit dem Parken geht die **Review-Anfrage** raus: Der **Reviewer** der Aufgabe bekommt eine Glocke im Posteingang und eine E-Mail, und die Karte trägt auf dem Board den Chip _Wartet auf {name}_. Ist niemand benannt, landet die Anfrage bei der Person, die die Aufgabe angelegt hat (sonst beim Projekt-Ersteller) — ein Abschluss bleibt nie stumm.
4. Ein Mensch **entscheidet auf dem Board**: Die Karte von _In Prüfung_ auf _Erledigt_ zu ziehen — per Drag oder über das Status-Feld im Aufgabenblatt — gibt frei, und die Entscheidung wird als die dieser Person festgehalten, nie als die des Agenten. Zum Zurückschicken **@-erwähnst** du den Zuständigen in einem Kommentar: Das Feedback startet einen Überarbeitungslauf, der das vorige Gespräch dort fortsetzt, wo es aufgehört hat, und das Ergebnis wieder auf _In Prüfung_ parkt. Wandert die Karte in eine andere Spalte, wird die Review-Anfrage stattdessen zurückgezogen — die Glocken verstummen, und das nächste Parken fragt neu.

Ein fehlgeschlagener Lauf lässt die Aufgabe, wo sie war, und erklärt sich im Aufgabenblatt — und die Plattform versucht es von selbst erneut, sofort und bis zu dreimal in Folge; die Lauf-Zeile zählt die Versuche mit. Ein Versuch, der fünfzehn Minuten oder länger lief, beweist Fortschritt und bekommt ein frisches Kontingent — eine lange Aufgabe, die immer wieder stolpert, steht also immer wieder auf. Sackgassen, die kein neuer Versuch heilt — ein gelöschter Agent, ein Lauf über seinem Zeitlimit — landen direkt bei dir. Sind die automatischen Versuche aufgebraucht, bleibt der Fehler auf der Karte stehen, und **Erneut ausführen** setzt dieselbe Konversation dort fort, wo sie stehen geblieben ist. Eine übergeordnete Aufgabe mit offenen Teilaufgaben lässt sich erst schließen, wenn die letzte Teilaufgabe erledigt ist.

## Zuständig und Reviewer

Die beiden Rollen sind bewusst getrennte Felder:

| Rolle         | Wer                                         | Aufgabe                                                                                                                                                  |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zuständig** | Person, Agent oder Automatisierung          | Treibt die Arbeit und den Board-Status — der eine, polymorphe Zuständige                                                                                 |
| **Reviewer**  | ein Projektmitglied mit Bearbeitungsrechten | Der benannte Mensch, auf den gewartet wird: erhält die Review-Anfrage und füllt den Filter **Wartet auf mein Review**; sein Zug auf _Erledigt_ entscheidet |

Den Reviewer wählst du im Aufgabenblatt im Feld **Reviewer**. Die Benennung ist bewusst **weich**: Sie steuert Benachrichtigungen und die Warteschlange, aber jedes Projektmitglied mit Bearbeitungsrechten kann weiterhin ein Review entscheiden — und anders als beim Zuständigen darfst du den Reviewer auch ändern, während ein Lauf läuft. Zum Prüfen musst du die Aufgabe nie übernehmen: Agent oder Automatisierung bleiben zuständig, die Choreografie läuft nach der Entscheidung weiter.

Das Board benennt die Wartestelle: Karten auf _In Prüfung_ tragen einen Chip **Wartet auf {name}** (bzw. _Wartet auf dein Review_), und der Board-Filter **Review** reduziert das Board auf die Aufgaben, die auf dich warten — deine persönliche Review-Warteschlange im Projekt.

## Erwähnungen

**Erwähne einen Agenten mit @** in einem Aufgaben-Kommentar, und er liest den erwähnenden Text und handelt. Ein `@` öffnet eine Autovervollständigung über Mitglieder und die Agenten des Projekts; der Composer zeigt vorab, ob jeder erwähnte Agent wirklich reagiert (Automatisierung aus, Sicherung ausgelöst, im Projekt nicht erwähnbar). Eine Erwähnung des **Zuständigen** gilt als Feedback zu seiner Arbeit: Ein laufender Agent nimmt den Kommentar mitten im Lauf auf, ein untätiger startet einen Überarbeitungslauf, der den Kommentar wortwörtlich mitbekommt und das vorige Gespräch dort fortsetzt, wo es aufgehört hat.

## Leitplanken

Jeder Agenten-Lauf — Zuweisung, Erwähnung, Review-Überarbeitung — passiert dasselbe Zulassungstor:

- **Ein Motor pro Aufgabe**: Eine Aufgabe mit laufendem Lauf lehnt einen zweiten ab, und eine Neuzuweisung mitten im Lauf wird verweigert (erst abbrechen — der Picker bietet Abbrechen-und-neu-zuweisen an).
- **Parallelität**: Agent-Sessions schöpfen aus der Kapazität der Organisation; überzählige Läufe reihen sich ein und starten, sobald ein Platz frei wird.
- **Sicherung pro Aufgabe**: Zu viele automatische Läufe innerhalb einer Stunde auf einer Aufgabe pausieren die Automatisierung dort, bis ein Mensch ihren Status ändert.

## Den Zuständigen wählen

Nicht jede Aufgabe gehört auf einen Coding-Harness. Als Faustregel:

| Aufgabentyp                                                 | Zuweisen an                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche, Texte, Zusammenfassungen, persönliche Ergebnisse | Eine **Person**                                                                                                                                             |
| Board-Arbeit, die ein bereitgestellter Desk treibt          | Eine **Automatisierung** — ihr Desk treibt dann die Status-Verben des Boards, und die Prüfung findet im Subjekt-Panel der Aufgabe statt                     |
| Repository-Arbeit — Bugs, Features, Refactorings, PRs       | Einen **Agenten** auf einem Coding-[**Harness**](/de/platform/agents/harnesses) — angelegt im Agents-Tab des Projekts mit dem Harness, der zur Arbeit passt |

Der Zuständigen-Picker gruppiert **Agenten** und **Automatisierungen**. Jeder Agent läuft in einer Sandbox auf dem **Harness**, der bei seiner Erstellung gewählt wurde — vorab ausgestattet mit seinen Skills, Konnektoren und Anweisungen.

## Der Notausschalter

Die Governance-Richtlinie `task_automation` trägt den Hauptschalter: Ausschalten stoppt den Startpfad — laufende Arbeit endet regulär, Neues startet nicht. Nur Admins dürfen das, und es wird auditiert; auf einer selbst gehosteten Instanz ist die Richtlinie eine der Governance-Konfigurationsdateien der Organisation, neben den Limits auf [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

## Wo das hingehört

Aufgaben-Automatisierung macht aus dem Projekt-Board eine Delegationsfläche statt einer To-do-Liste: Ein Mensch weist zu, ein benannter Mensch prüft, der Agent erledigt alles dazwischen — und _Erledigt_ bleibt eine menschliche Entscheidung. Als Nächstes lohnt sich [Backlog](/de/platform/projects/backlog): wie vorgeschlagene Arbeit in die Schleife gelangt.
