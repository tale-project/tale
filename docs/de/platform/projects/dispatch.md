---
title: Agenten mit der Arbeitsverteilung auslasten
description: Lass Tale die bereiten Aufgaben eines Projekts auf freien Agenten starten, ständige Rollen nach Zeitplan ausführen, die Boards anderer Projekte bedienen, Arbeit hinter Signalen von außen zurückhalten und sehen, warum ein Agent untätig ist.
---

Die Arbeitsverteilung startet die bereiten Aufgaben eines Projekts auf den Agenten in ihrem Pool, sobald einer frei ist, und startet ständige Rollen – etwa die Routing-Runde eines Managers oder eine nächtliche Prüfung – nach ihrem Zeitplan. Niemand muss jeden Lauf von Hand starten, und keine Automatisierung und kein Manager-Agent muss entscheiden, wann ein Agent beginnen darf. Wer das Projekt lesen kann, sieht im Projekt unter **Arbeitsverteilung**, was sie tut; Projektadministratoren ändern sie.

Die Arbeitsverteilung entscheidet, wann und wo Arbeit startet. Was sich zu tun lohnt, bleibt die Entscheidung einer Person oder eines Manager-Agenten: Setze Prioritäten, ordne das Board und verschiebe Aufgaben zwischen Spalten – die Arbeitsverteilung nimmt die Arbeit in dieser Reihenfolge.

<Frame caption="Der Tab Arbeitsverteilung zeigt, ob die Arbeitsverteilung eingeschaltet ist, wie viele Läufe ihr Pool hält und warum jeder Agent des Pools untätig ist.">

![Der Tab Arbeitsverteilung des Projekts Website relaunch: Die Arbeitsverteilung ist aus, kein Lauf wird gehalten, beide Agenten des Pools sind untätig, weil die Arbeitsverteilung aus ist, und es gab noch keinen Durchlauf.](/images/platform/project-dispatch.webp)

</Frame>

## Festlegen, was die Arbeitsverteilung nimmt und wer daran arbeitet

Öffne das Projekt, wähle **Arbeitsverteilung** und dann **Bearbeiten** – oder **Arbeitsverteilung einrichten**, solange das Projekt keine hat.

| Einstellung                                             | Was sie bestimmt                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbeitsverteilung ist ein**                           | Ob die Arbeitsverteilung überhaupt etwas startet. Ausgeschaltet startet sie nichts; laufende Läufe arbeiten weiter.                                                                                                                            |
| **Agenten im Pool**                                     | Die Agenten des Projekts, die die Arbeitsverteilung startet. Eine Aufgabe, die einem Agenten außerhalb des Pools zugewiesen ist, startet sie nie.                                                                                              |
| **Läufe gleichzeitig**                                  | Wie viele Läufe der Pool höchstens gleichzeitig hält, von 1 bis 500. Läufe, die Personen, Automatisierungen und ständige Rollen auf den Agenten des Pools starten, zählen mit; eine ständige Rolle startet zu ihrem Termin auch dann, wenn der Pool voll ist. |
| **Läufe pro Agent**                                     | Wie viele Läufe ein Agent des Pools höchstens gleichzeitig hält, standardmäßig 1 und nie mehr als **Läufe gleichzeitig**. Jeder Lauf arbeitet in einem eigenen [Agenten-Worker](/de/platform/projects/project-agents#run-one-agent-on-several-tasks). |
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
3. lässt einen Agenten in Ruhe, solange das KI-Modell, das er nutzt, [ausgelastet](/de/platform/projects/task-automation#handle-waiting-and-failed-runs) ist, und startet Arbeit auf diesem Modell in Wellen, sobald es wieder antwortet;
4. fragt vor jedem Start den Sandbox-Host und hört auf, wenn der Host ausgelastet ist;
5. startet die am besten eingeordnete bereite Aufgabe – auf dem Board dieses Projekts oder auf einem Board, das sie [bedient](#sources) – auf ihrem eigenen freien Agenten.

Jeder Start durchläuft dieselben Prüfungen wie ein Start vom Board: Eine Aufgabe mit offenem Blocker wartet, eine Aufgabe nimmt höchstens drei automatische Starts pro Stunde an, und eine Aufgabe läuft nur einmal gleichzeitig. Ein Lauf, den die Arbeitsverteilung gestartet hat, zeigt im Verlauf der Aufgabe **Von der Arbeitsverteilung gestartet** und läuft im Namen des Projekts, nicht einer Person.

Jeder Lauf eines Agenten braucht einen Agenten-Worker. Kann der Pool gleichzeitig mehr Läufe halten, als deine Organisation Agenten-Worker hat, weist **Arbeitsverteilung** darauf hin: Die zusätzlichen Läufe würden nur auf einen freien Worker warten. Inhaber und Admins erhöhen das Limit unter [Sandboxes](/de/platform/admin/sandboxes#das-relevante-limit-erkennen).

## Einen Agenten an Hunderten Aufgaben arbeiten lassen {#limits}

Die Arbeitsverteilung kann einen Agenten an so vielen Aufgaben gleichzeitig beschäftigen, wie deine Organisation Agenten-Worker haben darf: an bis zu 500. Soll der Agent Coder an 256 Aufgaben gleichzeitig arbeiten, nimm Coder als einzigen Agenten in den Pool, setze **Läufe gleichzeitig** und **Läufe pro Agent** auf 256 und gib deiner Organisation unter [Sandboxes](/de/platform/admin/sandboxes#das-relevante-limit-erkennen) mindestens 256 **Agenten-Worker**, soweit das Deployment so viele ausführen kann. Jeder Lauf arbeitet weiterhin in einem eigenen Worker mit eigenem Arbeitsbereich.

| Einstellung                                             | Erlaubte Werte                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| **Läufe gleichzeitig**                                  | 1 bis 500                                                         |
| **Läufe pro Agent**                                     | 1 bis 500, nie mehr als **Läufe gleichzeitig**; standardmäßig 1   |
| **Agenten im Pool**                                     | Bis zu 50                                                         |
| **Nur Aufgaben mit Label** / **Nie Aufgaben mit Label** | Jeweils bis zu 20 Labels                                          |
| **Zeit zwischen Starts (Sekunden)**                     | 0 bis 3.600; standardmäßig 30                                     |
| **Ausgelasteten Host erneut fragen nach (Sekunden)**    | 1 bis 10 Wartezeiten, jede von 10 bis 3.600                       |
| **Ständige Rollen**                                     | Bis zu 20                                                         |
| **Schranken**                                           | Bis zu 10                                                         |
| **Bediente Boards**                                     | Bis zu 20 andere Projekte                                         |
| **Reviewer**                                            | Bis zu 10 Agenten                                                 |

Darf ein Agent mehr Läufe halten als **Läufe gleichzeitig**, wird das Speichern unter **Läufe pro Agent** abgelehnt. Eine Arbeitsverteilung, die vor dieser Regel gespeichert wurde, arbeitet unverändert weiter; das nächste Speichern korrigiert sie.

Wie schnell sich ein großer Pool füllt, hängt von **Zeit zwischen Starts (Sekunden)** ab. Ist eine Zeit gesetzt, startet jeder Durchlauf eine Aufgabe, und der nächste Durchlauf folgt um diese Zeit später. Der 256. Lauf startet also 255-mal diese Zeit nach dem ersten: bei den standardmäßigen 30 Sekunden nach 2 Stunden, 7 Minuten und 30 Sekunden, bei 5 Sekunden nach 21 Minuten und 15 Sekunden. Bei 0 startet ein Durchlauf jede bereite Aufgabe, die der Sandbox-Host zulässt, höchstens zwei Minuten lang, und der nächste Durchlauf macht sofort weiter; ist der Host ausgelastet, bremsen ihn seine Wartezeiten bis zur nächsten Frage. Ein Durchlauf liest bis zu 500 bereite Aufgaben – genug, um den größten Pool zu füllen.

Antwortet ein KI-Modell wieder, nachdem es ausgelastet war, starten die Läufe, die darauf gewartet haben, in Wellen im Abstand von 15 Sekunden: erst ein Lauf, dann zwei, dann vier und so weiter, höchstens ein Sechzehntel von ihnen auf einmal. Auch 256 wartende Läufe haben so nach spätestens fünf Minuten begonnen. Neue Arbeit, die die Arbeitsverteilung auf diesem Modell startet, nimmt genauso zu, damit die bereite Arbeit, die sie zurückgehalten hat, solange das Modell ausgelastet war, das Modell nicht auf einmal erreicht: ein Lauf, sobald das Modell wieder antwortet, zwei weitere 15 Sekunden später, dann vier, acht und sechzehn und danach bis zu 32 alle 15 Sekunden. Dabei zählt jeder Lauf, der seither auf dem Modell gestartet wurde, egal wer ihn gestartet hat. Ein Pool von 256 Läufen auf diesem Modell ist so nach spätestens drei Minuten gefüllt; nach fünf Minuten ist der Anlauf vorbei. Ist **Zeit zwischen Starts (Sekunden)** langsamer als dieser Anlauf, gilt sie weiterhin.

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

## Die Boards anderer Projekte bedienen {#sources}

Die Arbeitsverteilung eines Projekts kann die Boards anderer Projekte deiner Organisation bearbeiten. Ein Projekt „Entwicklung“ hält zum Beispiel einen Pool von Coding-Agenten, der die bereite Arbeit übernimmt, die auf den Boards der Projekte „Website“, „Abrechnung“ und „Mobile App“ eingeht. Diese anderen Projekte sind die Quellen der Arbeitsverteilung. Lege sie in der verwalteten Ressource `project-dispatch` oder mit den [Einstellungs-Tools](/de/develop/mcp-settings) fest: Jede Quelle nennt die ID des Projekts und, wenn du willst, die Spalten, aus denen ihre bereite Arbeit kommt (ohne Angabe die der Arbeitsverteilung), sowie die Labels jenes Projekts, die sie übernimmt oder auslässt. **Bearbeiten** lässt die Quellen, wie sie sind; es ändert sie nicht.

Solange eine Arbeitsverteilung ein Projekt bedient:

- reiht sich dessen bereite Arbeit in einer gemeinsamen Reihenfolge mit ihrer eigenen ein – Spalte, Priorität, Platz auf dem Board, Alter –, und die Läufe jedes Agenten auf allen Boards zählen für **Läufe pro Agent** und **Läufe gleichzeitig**;
- dürfen die Agenten des Pools, der ständigen Rollen und die Reviewer den Aufgaben dieses Projekts zugewiesen und darauf gestartet werden; mit ihren Aufgaben-Tools finden, lesen, kommentieren, verschieben und reviewen sie diese Aufgaben, soweit freigegeben. Dort legen sie keine Aufgabe an, starten keinen anderen Agenten und lesen sonst nichts von jenem Projekt. Das Board jenes Projekts zeigt sie mit Namen, und seine Listen für Zuständige und Reviewer bieten sie an, versehen mit dem Projekt, aus dessen Arbeitsverteilung sie kommen; eine Erwähnung dort erreicht sie nicht;
- gehört ein Lauf an einer seiner Aufgaben zu dieser Aufgabe: Er erscheint auf dem Board jenes Projekts und im Verlauf der Aufgabe, für die Personen, die jenes Projekt lesen. Der Agent liest die Anweisungen beider Projekte: Das Projekt des Boards entscheidet, wie seine Aufgaben geschrieben, gelabelt, verschoben, geprüft und berichtet werden, das eigene Projekt des Agenten, wie der Agent arbeitet;
- erhält ein Lauf, den eine Person dort startet – mit **Agent starten**, einem Kommentar oder einem Verschieben nach **In Bearbeitung** –, die Secrets, Zugangsdaten und den ständigen Arbeitsbereich des Agenten nur, wenn diese Person sowohl jenes Projekt als auch das eigene Projekt der Arbeitsverteilung bearbeiten darf. Der Lauf aller anderen arbeitet nur an seiner eigenen Aufgabe, in einem eigenen Arbeitsbereich und ohne die Secrets des Agenten. Die Aufgaben-Tools eines Laufs erreichen nur die Boards, die die startende Person bearbeiten darf; ein Lauf, den die Arbeitsverteilung gestartet hat, erreicht jedes Board, das sie bedient.

Wer eines dieser Projekte nicht öffnen kann, sieht es auf der Seite **Arbeitsverteilung** als **Ein Projekt, das du nicht öffnen kannst**; die Läufe auf seinem Board werden gezählt, aber nicht aufgelistet, und eine Liste der Zuständigen kennzeichnet die Agenten, die es schickt, nur mit **Aus der Arbeitsverteilung eines anderen Projekts**.

Um eine Quelle hinzuzufügen oder zu ändern, brauchst du das Recht, jenes Projekt zu bearbeiten, zusätzlich zum Verwalten des eigenen Projekts. Eine Quelle, die bleibt, wie sie ist, wird nicht erneut geprüft, und das Ausschalten der Arbeitsverteilung wird nie wegen der Projekte abgelehnt, die sie bedient. Tale prüft dieses Recht bei jedem Durchlauf, jedem Start und jedem Tool-Aufruf erneut, und zwar für die Person, die die Arbeitsverteilung zuletzt gespeichert hat: Ein Projekt, das gelöscht oder archiviert wurde oder das diese Person nicht mehr bearbeiten darf, wird übersprungen. Die Arbeitsverteilung übernimmt dann nichts mehr daraus, und ihre Agenten können an seinen Aufgaben nichts mehr tun, bis jemand, der es bearbeiten darf, die Arbeitsverteilung erneut speichert. Einer solchen Person sagt **Bearbeiten** das und bietet **Speichern** auch ohne Änderung an, und eine unveränderte Deklaration, die mit der CLI angewendet wird, speichert die Arbeitsverteilung erneut. Seine Aufgaben bleiben diesen Agenten zugewiesen, bis jemand sie neu zuweist, doch **Agent starten** wird bei ihnen abgelehnt, und weder ein Verschieben nach **In Bearbeitung** noch ein erneuter Versuch oder ein Kommentar startet sie dort. Wird einer der Agenten der Arbeitsverteilung oder ihr Projekt gelöscht, verschwindet dieser Agent aus den Aufgaben, die er auf allen Boards innehat. **Bediente Boards** auf der Seite **Arbeitsverteilung** zeigt jede Quelle als **Bedient** oder übersprungen, und warum. Der Tab **Arbeitsverteilung** eines Projekts, das eine andere Arbeitsverteilung bedient, sagt das und verlinkt sie – ob das Projekt eine eigene Arbeitsverteilung hat oder nicht.

### Prüfen, was der Pool erarbeitet hat {#reviewers}

Die **Reviewer** der Arbeitsverteilung sind Agenten ihres eigenen Projekts mit der Freigabe für das [Review von Aufgaben](/de/platform/projects/task-automation#agent-review); sie prüfen, was ihr Pool auf jedem Board erarbeitet hat, das sie bedient. Beendet ein Agent des Pools eine Aufgabe, geht das Review an den Reviewer, den die Aufgabe nennt, falls sie einen nennt. Andernfalls geht es an den ersten Reviewer der Arbeitsverteilung, der die Arbeit nicht selbst erarbeitet hat, noch vor dem Standard-Reviewer des Projekts. Ein Reviewer prüft nie seine eigene Arbeit.

## Lesen, warum ein Agent untätig ist

**Agenten** listet jeden Agenten des Pools mit den Läufen, an denen er arbeitet, und mit dem Grund, wenn er keinen hat:

| Untätig, weil                                    | Bedeutung                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Sein Modell ist ausgelastet**                  | Der Anbieter hat das Modell des Agenten als ausgelastet gemeldet; der Agent nimmt wieder Arbeit an, sobald das Modell antwortet. |
| **Der Sandbox-Host ist ausgelastet**             | Der Host hat den letzten Start zurückgehalten; die Arbeitsverteilung fragt nach ihren Wartezeiten erneut.                        |
| **Alle Agenten-Worker sind belegt**              | Jeder Agenten-Worker deiner Organisation ist beschäftigt.                                                                        |
| **Wartet zwischen Starts**                       | Der nächste Start wartet: auf die Zeit zwischen Starts, auf die nächste Welle eines Modells, das wieder antwortet, oder auf den nächsten Durchlauf, der sofort folgt, wenn einem Durchlauf die Zeit ausging. |
| **Eine Schranke hält die bereite Arbeit zurück** | Die Arbeit, die für diesen Agenten übrig ist, hält eine Schranke zurück.                                                         |
| **Keine bereite Arbeit**                         | Keine Aufgabe in den gewählten Spalten ist für diesen Agenten bereit.                                                            |
| **Arbeitsverteilung ist aus**                    | Die Arbeitsverteilung oder die Aufgabenautomatisierung deiner Organisation ist ausgeschaltet.                                    |
| **Noch kein Durchlauf**                          | Die Arbeitsverteilung hat seit der Aufnahme des Agenten in den Pool noch keinen Durchlauf gemacht.                               |

Ein Lauf auf einem Board, das die Arbeitsverteilung bedient, nennt neben seiner Aufgabe das Projekt dieses Boards. Hält ein Agent mehr als fünf Läufe, zeigt die Seite, wie viele es sind – **Läuft**, **In der Warteschlange** und jeden Grund, aus dem seine Läufe warten, etwa **Wartet auf Modellkapazität** –, und dazu seine ersten fünf Läufe, die ältesten zuerst. Eine Schaltfläche wie **45 weitere Läufe zeigen** listet bis zu 50 davon auf; darüber hinaus nennt die Seite, wie viele weitere hier nicht aufgeführt sind. Die [REST-API](/de/develop/api-reference#dispatch) zählt und listet sie auf dieselbe Weise.

**Letzte Durchläufe** zeigt die letzten 20 Durchläufe: wann, was sie ausgelöst hat, wie viele Läufe sie gestartet und zurückgehalten haben und warum sie aufgehört haben. **Jetzt einen Durchlauf starten** löst sofort einen aus. Eine selbst betriebene Bereitstellung kann alarmieren, wenn eine Arbeitsverteilung keine Durchläufe mehr macht; [Prometheus und Grafana](/de/self-hosted/operate/observability/prometheus-grafana) zeigt die Regel.

## Die Arbeitsverteilung als Konfiguration verwalten

Eine Bereitstellung, die ihre Konfiguration in einem Repository führt, deklariert die Arbeitsverteilung eines Projekts als verwaltete Ressource `project-dispatch` und wendet sie wie andere [verwaltete Einstellungen](/de/develop/mcp-settings) mit der [Tale-CLI](/de/self-hosted/install/cli-install#plattform-konfigurieren) an. Was sie deklariert, zeigt **Bearbeiten**; eine Änderung in der App wird beim nächsten Anwenden überschrieben. Bevor die CLI etwas aus einer Deklaration schreibt, fragt sie Tale, ob die deklarierte Arbeitsverteilung gespeichert würde. Nennt die Arbeitsverteilung etwas, das das Projekt nicht verwenden kann – einen Agenten, eine Aufgabe, ein Label oder einen Zeitplan –, einen Reviewer ohne Freigabe für Reviews oder eine Quelle, die der deklarierende Schlüssel nicht bearbeiten darf, lehnt die CLI den Plan bei diesem Feld ab, und nichts aus der Deklaration wird angewendet, auch nicht die Zeitpläne, die sie ausschalten würde. Dieselbe Deklaration kann das Projekt, seine Agenten, Daueraufgaben und Labels anlegen: Die Prüfung zählt mit, was sie anlegt, und die Arbeitsverteilung wird geschrieben, sobald es existiert.
