---
title: Eine Aufgabe an einen Agenten delegieren
description: Starte einen Agenten, prüfe sein Ergebnis, fordere Änderungen an und setze fehlgeschlagene Läufe fort oder brich sie ab.
---

Ein Projektagent bearbeitet eine Aufgabe und legt das Ergebnis einer Person zur Prüfung vor. Weise ihm die Arbeit zu, starte den Lauf und halte Rückmeldungen an der Aufgabe fest. Du brauchst Bearbeitungszugriff auf das Projekt; außerdem müssen Anbieter, passende Agent-Laufzeit und Sandbox-Kapazität verfügbar sein.

<Frame caption="Agentenarbeit nutzt dasselbe Board wie menschliche Arbeit: Sie startet unter In Bearbeitung und wartet unter In Prüfung auf die Abnahme.">

![Das Aufgabenboard zeigt Arbeit in Backlog, Zu erledigen, In Bearbeitung, In Prüfung, Erledigt und Abgebrochen.](/images/platform/projects-task-board.webp)

</Frame>

## Die Aufgabe vorbereiten und starten

1. Erstelle eine [Aufgabe](/de/platform/projects/tasks) mit gewünschtem Ergebnis, Abschlusskriterien und Eingabedateien.
2. Wähle unter **Zuständig** einen [Projektagenten](/de/platform/projects/project-agents).
3. Lege unter **Reviewer** fest, wer das Ergebnis prüfen soll. Ohne benannten Reviewer geht die Anfrage an den Ersteller der Aufgabe oder des Projekts.
4. Klicke auf **Agent starten** oder verschiebe die Aufgabe nach **In Bearbeitung**.

Die Zuweisung allein startet keinen Lauf. Eine bereits zugewiesene Aufgabe kann im **Backlog** bleiben, bis das Team ihren Start beschließt. Nach dem Start verwendet der Agent Beschreibung, Kommentare und Eingabedateien in seiner Sandbox. Die Laufanzeige zeigt, ob er wartet oder arbeitet.

## Das Ergebnis lesen und annehmen

Der Agent schreibt seinen Bericht als Aufgabenkommentar und legt erzeugte Dateien als Ergebnisse ab. Danach wechselt die Aufgabe auf **In Prüfung**. Der Reviewer erhält eine Benachrichtigung und bei eingerichtetem E-Mail-Versand auch eine E-Mail.

Lies den Bericht, öffne die Dateien und vergleiche sie mit den Abschlusskriterien. Setze die Aufgabe erst auf **Erledigt**, wenn du die Arbeit annimmst. Tale hält die menschliche Entscheidung fest. Ein Agent darf seine eigene Aufgabe nicht als erledigt markieren.

**Reviewer** steuert Benachrichtigung und Prüfwarteschlange. Andere Projektmitglieder mit Bearbeitungsrechten dürfen das Ergebnis ebenfalls annehmen. Ein Wechsel des Reviewers ändert nicht die Zuständigkeit des Agenten.

## Änderungen anfordern

Beschreibe die nötige Änderung in einem Aufgabenkommentar und **erwähne den zuständigen Agenten mit @**. Die Erwähnung ist eine Anweisung: Ein aktiver Agent kann sie während seines Laufs erhalten. Ein wartender Agent beginnt einen Überarbeitungslauf, der das bisherige Gespräch fortsetzt. Das Ergebnis landet erneut unter **In Prüfung**.

Ein Kommentar ohne Erwähnung hält eine Notiz fest, ohne diese Agentenaktion zu starten. Die Erwähnungsauswahl zeigt an, wenn ein Agent nicht reagieren kann, etwa weil die Aufgabenautomatisierung ausgeschaltet oder pausiert ist.

Bei einer Aufgabe mit zuständiger Automatisierung erwähnst du diese Automatisierung für einen weiteren Lauf. Die Erwähnung einer anderen Automatisierung überträgt weder die Zuständigkeit noch startet sie diese. [Automatisierungen](/de/platform/automations/concepts) erklärt Workflows mit mehreren Schritten.

## Wartende und fehlgeschlagene Läufe behandeln

| Zustand oder Problem | Maßnahme |
| --- | --- |
| Warten auf einen Sandbox-Platz | Die Kapazität der Organisation oder der gemeinsam genutzten Infrastruktur kann ausgeschöpft sein. Warte auf einen Platz oder bitte einen Admin, [Sandboxes](/de/platform/admin/sandboxes) zu prüfen. |
| Automatischer Wiederholungsversuch | Tale wiederholt einen behebbaren Fehler. Beobachte die Versuchszahl und starte keinen zusätzlichen Lauf. |
| Der Lauf bleibt fehlgeschlagen | Lies den Fehler und behebe die Ursache. Nutze dann **Erneut ausführen**, um das Gespräch fortzusetzen. Gelöschte Agenten und Zeitlimits erfordern einen Eingriff. |
| Neuzuweisung wird verweigert | Brich den aktiven Lauf ab, bevor du neu zuweist. |
| Automatisierung einer Aufgabe ist pausiert | Zu viele automatische Starts haben die Sicherung ausgelöst. Prüfe die wiederholte Arbeit, bevor ein menschlicher Statuswechsel die Pause aufhebt. |
| Die Aufgabe lässt sich nicht abschließen | Schließe zuerst ihre offenen Teilaufgaben ab. |

Bei behebbaren Fehlern folgen bis zu drei sofortige Wiederholungsversuche. Ein Lauf, der mindestens fünfzehn Minuten Fortschritt macht, erhält ein neues Versuchskontingent. So kann lange Arbeit Unterbrechungen überstehen. Die Richtigkeit des Ergebnisses musst du trotzdem prüfen.

## Arbeit abbrechen oder pausieren

Mit **Lauf abbrechen** stoppst du den aktiven Agenten. Auch das Verschieben einer laufenden Agentenaufgabe aus **In Bearbeitung** kann den Lauf abbrechen. Lies die Bestätigung vorher. Pro Aufgabe kann nur ein Agentenlauf aktiv sein.

Ein Admin kann die Aufgabenautomatisierung für die Organisation ausschalten. Neue Läufe starten dann nicht; bestehende Arbeit endet regulär. Organisationslimits und Budgets gelten weiterhin für jeden Lauf. Siehe [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

## Die passende Zuständigkeit wählen

Weise einer Person Arbeit zu, die menschliches Urteilsvermögen oder Zugriff außerhalb der Agentenrechte braucht. Nutze einen Projektagenten für eine klar begrenzte Aufgabe mit seinen konfigurierten Dateien und Tools. Eine Automatisierung passt zu festen Abläufen mit mehreren Schritten, Auslösern oder Connector-Freigaben.

Für den ersten Lauf folge [Deinen ersten Agenten erstellen](/de/tutorials/editor/first-agent-end-to-end). Halte die Aufgabe so klein, dass du ihr Ergebnis selbst prüfen kannst.
