---
title: Agenten mit Skills ausrüsten
description: Wähle wiederverwendbare Skill-Bundles für Projekt-Agenten und Automationsknoten, prüfe ihren Zugriff und kontrolliere die Ausführung.
---

Rüste einen Agenten mit einem Skill aus, wenn er ein wiederverwendbares Vorgehen oder Referenzmaterial aus der [Skill-Bibliothek](/de/platform/workspace/skills) der Organisation braucht. Die Bibliothek speichert das Bundle; die Ausrüstung des Agenten bestimmt, welche Bundles seinen Läufen zur Verfügung stehen.

## Einen Skill für die Aufgabe wählen

Ein hilfreicher Skill erklärt, wann er gebraucht wird, wie die Arbeit abläuft und woran ein gutes Ergebnis erkennbar ist. Rüste zum Beispiel den Agenten für Release Notes mit dem passenden Skill aus. Gib ihm einige Änderungen und prüfe, ob sein Ergebnis dem erwarteten Format entspricht.

Das Bundle enthält `SKILL.md` und kann Referenzen, Dateien oder Skripte mitbringen. Beim Import werden diese Dateien nicht ausgeführt. Nach dem Ausrüsten können die Anweisungen jedoch einen Coding-Agenten mit Shell oder anderen Werkzeugen dazu anleiten, ein enthaltenes Skript auszuführen. Prüfe daher das gesamte Bundle vor der Verwendung. Ein Skill bildet keine zusätzliche Berechtigungsgrenze.

## Einen Projekt-Agenten ausrüsten

Öffne den [Projekt-Agenten](/de/platform/projects/project-agents) und wähle die benötigten Skills in seiner Ausrüstung. Die Liste richtet sich nach dem Zugriff des Projekts, auch wenn du persönlich mehr Skills lesen kannst:

| Projektzugriff | Verfügbare Skills |
| --- | --- |
| Organisationsweites Projekt | Organisationsweite Skills |
| Mit Teams geteiltes Projekt | Organisationsweite Skills sowie Team-Skills, die mit mindestens einem Team des Projekts geteilt sind |

Alte private Skills können nicht für einen Projekt-Agenten ausgewählt werden. Dieselbe Zugriffsregel wird beim Start einer Aufgabe geprüft. Die Auswahl eines Skills gewährt dem Projekt keinen dauerhaften Zugriff darauf.

## Skills in einer Automation verwenden

Die Agent-Knoten einer Automation geben an, welche Skills sie brauchen. Ein an ein Projekt gebundener Lauf nutzt dessen Zugriff. Ein Lauf auf Organisationsebene kann nur organisationsweite Skills verwenden. Deine persönliche Mitgliedschaft in weiteren Teams erweitert diesen Zugriff nicht.

Beim Einrichten der Sandbox stellt Tale die ausgerüsteten Bundles als Dateien bereit und gibt dem Agenten die Pfade zu ihren `SKILL.md`-Anweisungen. Unterstützende Dateien liegen daneben. Wähle die Ausrüstung gezielt und sage dem Agenten, welches Vorgehen für die Aufgabe wichtig ist. Dass ein Skill verfügbar ist, belegt noch nicht, dass das Ergebnis seinen Anweisungen folgt.

## Fehlende oder geänderte Skills prüfen

Löschst du einen Skill, wird er bei jedem Agenten abgelegt, der ihn ausgerüstet hatte; das Audit-Protokoll hält fest, bei welchen. Ist ein benötigter Skill nicht mehr mit dem Ausführungsbereich geteilt, schlägt die Bereitstellung fehl und nennt den nicht verfügbaren Skill; der Lauf wird nicht automatisch wiederholt, weil eine Wiederholung daran nichts ändert. Im Dialog des Agenten erscheint der Skill als nicht verfügbar, damit du ihn abwählen kannst — alle anderen Einstellungen des Agenten lassen sich weiterhin speichern. Stelle den vorgesehenen Zugriff wieder her oder entferne die veraltete Ausrüstung, bevor du es erneut versuchst.

Änderungen an einem geteilten Bundle wirken sich auf spätere Bereitstellungen aus. Prüfe Ersetzungen und teste den Agenten nach größeren Änderungen mit einer bekannten Eingabe. Verlasse dich nicht darauf, dass ein gleichnamiger Skill im Repository das ausgerüstete Bundle überschreibt.

## Skills oder Agent-Anweisungen wählen

| In einen Skill gehört, was… | In die Agent-Anweisungen gehört, was… |
| --- | --- |
| mehrere Agenten als gemeinsames Vorgehen nutzen. | die Rolle oder den Stil dieses Agenten festlegt. |
| Referenzdateien oder Skripte benötigt. | eine kurze, beständige Regel für diesen Agenten ist. |
| zentral gepflegt werden soll. | erklärt, wie dieser Agent seine ausgerüsteten Skills verwenden soll. |

Die [Anleitung zur Skill-Bibliothek](/de/platform/workspace/skills) erklärt, wie du Bundles erstellst, importierst, bearbeitest und teilst.
