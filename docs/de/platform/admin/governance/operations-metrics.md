---
title: Betriebsmetriken
description: Prüfe fehlgeschlagene und blockierte Chat-Antworten, Agentenarbeit in der Sandbox, die Ergebnisse von Automatisierungsläufen und den Fortschritt eines Projekts unter Einstellungen > Metriken.
---

Neben [Nutzung](/de/platform/admin/governance/usage-analytics) und [Feedback](/de/platform/admin/governance/feedback-analytics) findest du als Admin oder Inhaber unter **Einstellungen > Metriken** vier weitere Übersichten. **Chat-Zustand** zeigt, ob Antworten des Assistenten fehlschlagen oder blockiert werden, **Harness-Runden**, ob Agenten ihre Arbeit in der Sandbox abschließen, **Automatisierungen**, wie Live-Läufe enden, und **Projekte**, wie sich die Aufgaben eines Projekts bewegen. Jede Übersicht berechnet ihre Werte für den gewählten Zeitraum aus den Einträgen, die Tale noch aufbewahrt.

<Frame caption="Einstellungen > Metriken > Chat-Zustand: Zähler und Quoten, das tägliche Ergebnisdiagramm und die Aufschlüsselung nach Agent und Modell.">

![Die Übersicht Chat-Zustand für die letzten sieben Tage meldet sieben Assistenten-Antworten mit 0 % Fehlerrate, 0 % Blockierquote und keinen Guardrail-Ereignissen, einen Balken mit sieben erfolgreichen Antworten am aktuellen Tag und eine Aufschlüsselung, die jede Antwort einfachen Chats zuordnet und sie auf zwei Modelle verteilt.](/images/platform/metrics-chat-health.webp)

</Frame>

## Den Chat-Zustand prüfen

Öffne **Chat-Zustand**, wenn Mitglieder fehlgeschlagene oder verweigerte Antworten melden. Wähle unter **Filter** 1, 7 oder 30 Tage; die Seite öffnet mit 7 Tagen.

Die Karten zählen die **Assistenten-Antworten** im Zeitraum. **Fehlerrate** ist der Anteil dieser Antworten, die mit einem Fehler endeten, **Blockierquote** der Anteil, den Tale verweigert hat, etwa weil eine Schutzregel die Nachricht blockiert hat. **Guardrail-Ereignisse** zählt die Erkennungen im Zeitraum und wie viele davon eine Nachricht blockiert haben.

**Antworten im Zeitverlauf** teilt die Antworten jedes Tages in **Erfolgreich**, **Fehler** und **Blockiert** auf. So siehst du, wann ein Problem begonnen hat. **Aufschlüsselung** zeigt den Anteil jedes Agenten und jedes Modells; eine Antwort in einem einfachen Chat ohne Agent zählt als **Nicht zugeordnet**.

Unter **Fehler** gruppiert **Nach Fehlertyp** die Fehlschläge, zum Beispiel **Ratenlimit**, **Modell nicht gefunden**, **Guthaben aufgebraucht** oder **Nutzungslimit erreicht**. **Letzte Fehler** listet die jüngsten mit Modell und Agent auf. Der Typ verrät, was du als Nächstes prüfst: die Zugangsdaten eines Anbieters oder sein Kontingent unter [KI-Anbieter](/de/platform/admin/providers), die Verfügbarkeit eines Modells unter [Modelle](/de/platform/admin/governance/content-models) oder eine Budgetregel unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

**Guardrails** schlüsselt die Ereignisse nach Art und nach Filter auf und zeigt Erkennungen, Blockierungen und Filterfehler pro Tag. Diese Ereignisse stammen von den Filtern unter [Schutzregeln](/de/platform/admin/governance/guardrails) und umfassen nur, was die Aufbewahrung noch behält.

## Harness-Runden beobachten

Eine Harness-Runde ist ein Arbeitsschritt, den ein Harness wie Claude Code oder Codex in der Sandbox ausführt: ein [Projektagent](/de/platform/projects/project-agents), der an einer Aufgabe arbeitet, oder ein Agent-Schritt in einer Automatisierung. **Harness-Runden** zeigt, ob diese Runden zu Ende kommen. Wähle 7, 30 oder 90 Tage; die Seite öffnet mit 30 Tagen.

Die Karten zeigen **Runden gesamt**, die **Erfolgsquote**, die **Timeout-Quote**, die **Dauer p95**, innerhalb derer 95 % der Runden fertig wurden, und unter **Von Nutzer gestoppt** die Runden, die jemand angehalten hat. **Nach Harness** führt Runden, Erfolgsquote und Timeouts für jeden Harness auf. Steigt die Timeout-Quote, siehst du dort, von welchem Harness sie kommt. [Eine Agent-Laufzeit wählen](/de/platform/agents/harnesses) erklärt, wie jeder Harness arbeitet, und [Sandbox-Kapazität verwalten](/de/platform/admin/sandboxes), wo ihre Kapazität festgelegt wird.

## Automatisierungsläufe verfolgen

**Automatisierungen** zählt die Live-Läufe der Automatisierungen deiner Organisation. Testläufe erscheinen im Tab **Läufe** der jeweiligen Automatisierung, aber nicht hier. Wähle 7, 30 oder 90 Tage; die Seite öffnet mit 30 Tagen. Jede Karte vergleicht ihren Wert mit dem gleich langen Zeitraum davor.

**Erfolgsquote** ist der Anteil der abgeschlossenen Läufe, die erfolgreich waren: Fehlgeschlagene und gestoppte Läufe zählen dagegen, eingereihte, laufende und wartende Läufe zählen noch nicht. **Ø Dauer** mittelt über die abgeschlossenen Läufe, **Fehlgeschlagene Läufe** zählt die Fehlschläge. **Läufe im Zeitverlauf** zeigt die Zahl der Läufe pro Tag, **Status-Verteilung** das Ergebnis aller Läufe im Zeitraum und **Top-Automatisierungen** die zehn Automatisierungen mit den meisten Läufen, jeweils mit Erfolgsquote, durchschnittlicher Dauer, Fehlschlägen und letztem Lauf. Öffne den Tab **Läufe** einer fehlschlagenden Automatisierung, um die fehlgeschlagene Node zu finden; [Automatisierungsläufe prüfen und Fehler beheben](/de/platform/automations/execution-logs) führt dich durch.

## Den Fortschritt eines Projekts prüfen

**Projekte** zeigt jeweils ein Projekt: Wähle es unter **Projekt auswählen**. Hat die Organisation nur ein Projekt, ist es schon gewählt. Wähle 7, 30 oder 90 Tage; die Seite öffnet mit 30 Tagen.

| Kennzahl | Was sie misst |
| --- | --- |
| **Abgeschlossen** | Aufgaben, die im Zeitraum **Erledigt** erreicht haben, getrennt danach, ob ein Agent oder ein Mensch sie abgeschlossen hat. |
| **Ø Durchlaufzeit** | Die durchschnittliche Zeit vom ersten Wechsel einer Aufgabe nach **In Bearbeitung** bis **Erledigt**. Eine Aufgabe, die **In Bearbeitung** übersprungen hat, hat keine Durchlaufzeit. |
| **Eingriffsquote** | In der Prüfung angeforderte Änderungen plus die Fragen, die Agenten Menschen gestellt haben, bezogen auf die im Zeitraum gestarteten Agentenläufe. |
| **Ausgaben** | Die Kosten der Agentenläufe des Projekts, mit der Zahl der gestarteten und der fehlgeschlagenen Läufe. |

Die Diagramme darunter zeigen die offenen Aufgaben nach Status am Ende jedes Tages, die täglich erstellten und abgeschlossenen Aufgaben, den Verlauf der Durchlaufzeit, die Abschlüsse durch Agenten und Menschen sowie die täglichen Ausgaben. Steigt die Eingriffsquote bei gleichbleibender Zahl von Läufen, schicken Menschen mehr Arbeit zurück oder beantworten mehr Fragen. Lies dann die Aufgaben in der Prüfung, bevor du die Anweisungen des Agenten unter [Projektagenten](/de/platform/projects/project-agents) änderst.

## Die Werte richtig lesen

- Jede Übersicht rechnet mit den Einträgen, die Tale aufbewahrt. Aufbewahrungsregeln und Löschungen verkürzen den Verlauf: Ein leerer Zeitraum kann heißen, dass die Einträge fehlen, nicht dass nichts geschehen ist.
- Ein betriebsamer Zeitraum kann mehr enthalten, als ein Durchgang liest: Chat-Zustand, Harness-Runden, Automatisierungen und Projekte zählen jeweils höchstens die 5.000 jüngsten Einträge einer Art im Zeitraum. Zeigt Tale einen Hinweis auf aktuelle Aktivität, grenze den Zeitraum ein, bevor du Schlüsse ziehst.
- Kosten sind in der Anwendung erfasste Nutzung, keine Rechnung eines Anbieters; die [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) erklärt den Unterschied.
