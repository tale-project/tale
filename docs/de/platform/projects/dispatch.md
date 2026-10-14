---
title: Agenten mit der Arbeitsverteilung auslasten
description: Lass Tale die bereiten Aufgaben eines Projekts auf freien Agenten starten, ständige Rollen nach Zeitplan ausführen, Arbeit hinter Signalen von außen zurückhalten und sehen, warum ein Agent untätig ist.
---

Die Arbeitsverteilung startet die bereiten Aufgaben eines Projekts auf den Agenten in ihrem Pool, sobald einer frei ist, und startet ständige Rollen – etwa die Routing-Runde eines Managers oder eine nächtliche Prüfung – nach ihrem Zeitplan. Niemand muss jeden Lauf von Hand starten, und keine Automatisierung und kein Manager-Agent muss entscheiden, wann ein Agent beginnen darf. Wer das Projekt lesen kann, sieht im Projekt unter **Arbeitsverteilung**, was sie tut; Projektadministratoren ändern sie.

Die Arbeitsverteilung entscheidet, wann und wo Arbeit startet. Was sich zu tun lohnt, bleibt die Entscheidung einer Person oder eines Manager-Agenten: Setze Prioritäten, ordne das Board und verschiebe Aufgaben zwischen Spalten – die Arbeitsverteilung nimmt die Arbeit in dieser Reihenfolge.

## Festlegen, was die Arbeitsverteilung nimmt und wer daran arbeitet

Öffne das Projekt, wähle **Arbeitsverteilung** und dann **Bearbeiten**.

| Einstellung                                             | Was sie bestimmt                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbeitsverteilung ist ein**                           | Ob die Arbeitsverteilung überhaupt etwas startet. Ausgeschaltet startet sie nichts; laufende Läufe arbeiten weiter.                                                                                                                            |
| **Agenten im Pool**                                     | Die Agenten des Projekts, die die Arbeitsverteilung startet. Eine Aufgabe, die einem Agenten außerhalb des Pools zugewiesen ist, startet sie nie.                                                                                              |
| **Läufe gleichzeitig**                                  | Wie viele Läufe der Pool höchstens gleichzeitig hält. Läufe, die Personen, Automatisierungen und ständige Rollen auf den Agenten des Pools starten, zählen mit; eine ständige Rolle startet zu ihrem Termin auch dann, wenn der Pool voll ist. |
| **Läufe pro Agent**                                     | Wie viele Läufe ein Agent des Pools höchstens gleichzeitig hält, standardmäßig 1. Jeder Lauf arbeitet in einem eigenen [Agenten-Worker](/de/platform/projects/project-agents#run-one-agent-on-several-tasks).                                  |
| **Bereite Arbeit aus**                                  | Die Spalten, aus denen bereite Arbeit kommt, **Zu erledigen**, **Backlog** oder beide, in der Reihenfolge, in der du sie aufführst.                                                                                                            |
| **Nicht zugewiesene Aufgaben**                          | **In Ruhe lassen** oder **Dem Pool geben**: Eine nicht zugewiesene Aufgabe wird dann dem freien Agenten mit dem meisten Platz zugewiesen.                                                                                                      |
| **Nie gestartete Aufgaben einem freien Agenten geben**  | Eine Aufgabe wartet auf einen beschäftigten Agenten des Pools nur so lange, bis ein anderer frei ist. Eine Aufgabe, die schon gelaufen ist, bleibt bei ihrem Agenten, damit ihr Gespräch und ihre Dateien zusammenbleiben.                     |
| **Nur Aufgaben mit Label** / **Nie Aufgaben mit Label** | Grenzt bereite Arbeit nach Labels ein. Ein Label, das das Projekt nicht hat, wird beim Speichern abgelehnt.                                                                                                                                    |
| **Sandbox-Host**                                        | Wie vorsichtig ein Start auf dem gemeinsamen Sandbox-Host zugelassen wird: **Schwellenwerte der Bereitstellung** oder **Vorsichtig**, das zusätzlich wartet, bis Last sowie Druck auf Arbeitsspeicher und Datenträger nachlassen.              |
| **Zeit zwischen Starts (Sekunden)**                     | Der kleinste Abstand zwischen zwei Starts, standardmäßig 30 Sekunden, damit ein Host nicht viele Starts auf einmal trifft.                                                                                                                     |
| **Ausgelasteten Host erneut fragen nach (Sekunden)**    | Hält der Host einen Start zurück, fragt die Arbeitsverteilung nach diesen Wartezeiten nacheinander erneut, standardmäßig nach 60, 120 und 240 Sekunden, danach im Abstand der letzten.                                                         |

Bereite Arbeit wird nach Spalte geordnet, dann nach Priorität, dann nach ihrem Platz auf dem Board und zuletzt nach Alter. Eine Aufgabe ist bereit, wenn sie in einer gewählten Spalte liegt, nicht archiviert ist, keinen offenen Blocker hat und kein Lauf an ihr arbeitet.

## Wie die Arbeitsverteilung Arbeit startet

Die Arbeitsverteilung macht einen Durchlauf, sobald sich etwas ändert: Ein Lauf des Projekts endet, ein Modell antwortet wieder, jemand speichert die Arbeitsverteilung oder eine Schranke öffnet sich – und mindestens einmal pro Minute. Jeder Durchlauf:

1. startet die ständigen Rollen, die fällig sind;
2. zählt die Läufe, die die Agenten des Pools halten, egal wer sie gestartet hat;
3. lässt einen Agenten in Ruhe, solange das KI-Modell, das er nutzt, [ausgelastet](/de/platform/projects/task-automation#handle-waiting-and-failed-runs) ist;
4. fragt vor jedem Start den Sandbox-Host und hört auf, wenn der Host ausgelastet ist;
5. startet die am besten eingeordnete bereite Aufgabe auf ihrem eigenen freien Agenten.

Jeder Start durchläuft dieselben Prüfungen wie ein Start vom Board: Eine Aufgabe mit offenem Blocker wartet, eine Aufgabe nimmt höchstens drei automatische Starts pro Stunde an, und eine Aufgabe läuft nur einmal gleichzeitig. Ein Lauf, den die Arbeitsverteilung gestartet hat, zeigt im Verlauf der Aufgabe **Von der Arbeitsverteilung gestartet** und läuft im Namen des Projekts, nicht einer Person.

Jeder Lauf eines Agenten braucht einen Agenten-Worker. Kann der Pool gleichzeitig mehr Läufe halten, als deine Organisation Agenten-Worker hat, weist **Arbeitsverteilung** darauf hin: Die zusätzlichen Läufe würden nur auf einen freien Worker warten. Inhaber und Admins erhöhen das Limit unter [Sandboxes](/de/platform/admin/sandboxes#das-relevante-limit-erkennen).

## Ständige Rollen nach Zeitplan ausführen

Eine ständige Rolle startet einen Agenten nach Zeitplan auf seiner eigenen Aufgabe, für Arbeit, die wiederkehrt: ein Manager-Agent, der alle dreißig Minuten Reviews verteilt, eine nächtliche Qualitätsprüfung. Füge sie in **Bearbeiten** unter **Ständige Rollen** hinzu:

| Feld                                 | Was es ist                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| **Schlüssel**                        | Ein kurzer Name wie `manager`, der in der Bezeichnung jedes Termins erscheint.     |
| **Agent** und **Aufgabe**            | Wer arbeitet, und die Aufgabe, die die Anweisungen und den Verlauf der Rolle hält. |
| **Zeitplan (Cron)** und **Zeitzone** | Ein Cron-Ausdruck mit fünf Feldern, gelesen in der Zeitzone.                       |
| **Modus**                            | Ein Wort, das der Agent bei jedem Termin erhält, etwa `full` oder `light`.         |
| **Auftrag**                          | Was der Agent bei jedem Termin zuerst angeht.                                      |

Bei jedem Termin verschiebt die Arbeitsverteilung die Aufgabe nach **In Bearbeitung** und startet den Agenten mit dem Auftrag, beschriftet mit dem Termin in der Zeitzone der Rolle – zum Beispiel `manager 2026-10-14 16:30 Europe/Zurich`. Trifft ein Termin die Rolle noch bei der Arbeit an, wird er in diesen Lauf aufgenommen, statt einen zweiten zu starten. Nach einem Ausfall läuft nur der letzte verpasste Termin. Jeder Termin wird genau einmal entschieden, auch wenn zwei Durchläufe auf ihn treffen, und die Aufgabe einer Rolle wird nie als bereite Arbeit gestartet.

## Arbeit hinter einer Schranke zurückhalten

Eine Schranke hält die bereite Arbeit zurück, für die sie gilt, solange ein Signal von außen das verlangt – zum Beispiel, solange die Warteschlange der Runner deines CI-Systems voll ist. Lege die Schranke in **Bearbeiten** unter **Schranken** an: einen **Schlüssel**, die **Labels, die sie zurückhält** (ohne Labels hält sie alle bereite Arbeit zurück), und lass sie entweder von einer Person schließen und öffnen oder einen Wert mit **Schließen ab** und **Wieder öffnen unter** beurteilen. Eine geschlossene Schranke öffnet sich erst unter dem zweiten Wert wieder – der Hälfte des ersten, wenn du ihn nicht festlegst –, damit ein Signal nahe der Schwelle nicht hin und her schaltet.

Ein externes System meldet den Zustand der Schranke über die [REST-API](/de/develop/api-reference#dispatch); Projektadministratoren können sie unter **Schranken** auch **Schließen** und **Öffnen**. Eine Schranke, zu der niemand innerhalb von **Veraltet nach (Sekunden)** etwas meldet – standardmäßig zehn Minuten –, öffnet sich wieder oder schließt sich, wenn **Wenn veraltet** auf **Schließen** steht. **Zeit zwischen ihren Starts (Sekunden)** lässt einen Start ihrer Arbeit durch und den nächsten erst nach dieser Zeit. Ständige Rollen hält eine Schranke nie zurück.

## Lesen, warum ein Agent untätig ist

**Agenten** listet jeden Agenten des Pools mit den Läufen, an denen er arbeitet, und mit dem Grund, wenn er keinen hat:

| Untätig, weil                                    | Bedeutung                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Sein Modell ist ausgelastet**                  | Der Anbieter hat das Modell des Agenten als ausgelastet gemeldet; der Agent nimmt wieder Arbeit an, sobald das Modell antwortet. |
| **Der Sandbox-Host ist ausgelastet**             | Der Host hat den letzten Start zurückgehalten; die Arbeitsverteilung fragt nach ihren Wartezeiten erneut.                        |
| **Alle Agenten-Worker sind belegt**              | Jeder Agenten-Worker deiner Organisation ist beschäftigt.                                                                        |
| **Wartet zwischen Starts**                       | Der letzte Durchlauf hat einen Lauf gestartet und wartet die Zeit zwischen Starts ab.                                            |
| **Eine Schranke hält die bereite Arbeit zurück** | Die Arbeit, die für diesen Agenten übrig ist, hält eine Schranke zurück.                                                         |
| **Keine bereite Arbeit**                         | Keine Aufgabe in den gewählten Spalten ist für diesen Agenten bereit.                                                            |
| **Arbeitsverteilung ist aus**                    | Die Arbeitsverteilung oder die Aufgabenautomatisierung deiner Organisation ist ausgeschaltet.                                    |
| **Noch kein Durchlauf**                          | Die Arbeitsverteilung hat seit der Aufnahme des Agenten in den Pool noch keinen Durchlauf gemacht.                               |

**Letzte Durchläufe** zeigt die letzten 20 Durchläufe: wann, was sie ausgelöst hat, wie viele Läufe sie gestartet und zurückgehalten haben und warum sie aufgehört haben. **Jetzt einen Durchlauf starten** löst sofort einen aus. Eine selbst betriebene Bereitstellung kann alarmieren, wenn eine Arbeitsverteilung keine Durchläufe mehr macht; [Prometheus und Grafana](/de/self-hosted/operate/observability/prometheus-grafana) zeigt die Regel.

## Die Arbeitsverteilung als Konfiguration verwalten

Eine Bereitstellung, die ihre Konfiguration in einem Repository führt, deklariert die Arbeitsverteilung eines Projekts als verwaltete Ressource `project-dispatch` und wendet sie wie andere [verwaltete Einstellungen](/de/develop/mcp-settings) mit der Tale-CLI an. Was sie deklariert, zeigt **Bearbeiten**; eine Änderung in der App wird beim nächsten Anwenden überschrieben.
