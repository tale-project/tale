---
title: Sandbox-Kapazität verwalten
description: Passe Grenzen für gleichzeitige Arbeit an, lies Infrastrukturwerte und kläre blockierte Sandbox-Starts.
---

Öffne **Einstellungen > Sandboxes**, wenn Agenten oder Website-Scans keine Ausführungsumgebung erhalten. Die Seite trennt die Arbeitsgrenzen deiner Organisation von der tatsächlichen Infrastruktur des Deployments. Inhaber und Admins dürfen Limits ändern und festlegen, wann ungenutzte Arbeitsbereiche gelöscht werden. Entwickler sehen Limits und zusammengefasste Kapazität, aber keine privaten Workspace-Details.

## Das relevante Limit erkennen

| Arbeitsart | Standard | Was einen Platz belegt |
| --- | --- | --- |
| Projektagenten-Sitzungen | 2 | Ein startender oder arbeitender Agenten-Workspace, den der Agent für seine Aufgaben wiederverwendet. |
| Workflow-Sitzungen | 2 | Die Sandbox eines Workflow-Laufs. Gleichzeitige Läufe belegen getrennte Plätze. |
| Render-Sitzungen | 2 | Eine vorübergehende Sandbox zum Rendern von Seiten bei Website-Scans. |

Die Werte begrenzen gleichzeitige Arbeit, nicht die Anzahl der Aufgaben oder die Ausgaben. Ein Agent kann mehrere Aufgaben in seinem einen Workspace bearbeiten. Die Limits reservieren keine Infrastruktur: Alle Organisationen teilen sich die Deployment-Kapazität.

<Frame caption="Die Summe der drei Arbeitslimits passt sich automatisch an. Sie darf die Kapazität der Bereitstellung nicht überschreiten.">

![Der Abschnitt Organisationslimits zeigt drei bearbeitbare Sitzungslimits und ihre berechnete Summe im Verhältnis zur Kapazität der Bereitstellung.](/images/platform/settings-sandboxes.webp)

</Frame>

## Ein Arbeitslimit ändern

1. Prüfe die belegten Plätze der Arbeitsart und die Infrastrukturwerte darunter.
2. Gib beim passenden Limit eine ganze Zahl von 1 bis 500 ein. Die angezeigte Gesamtzahl berechnet die Summe aller drei Felder neu.
3. Halte die Summe innerhalb der Deployment-Kapazität und wähle **Speichern** im Kopfbereich. **Verwerfen** stellt die gespeicherten Werte wieder her.
4. Öffne die Seite erneut, prüfe die gespeicherten Limits und beobachte, ob neue Arbeit einen Platz erhält.

Die Standardwerte ergeben zusammen 6. Bei einer Deployment-Kapazität von 8 ist eine Summe von 8 erlaubt, 9 wird abgelehnt. Der Server prüft die Kapazität beim Speichern erneut. Der aktuelle Wert kann deshalb von der ersten Beobachtung abweichen. Die verbundenen [Geräte](/de/platform/admin/sandbox-devices) deiner Organisation erhöhen die Obergrenze um die Sandboxes, die sie ausführen: Mit einem Gerät, das 4 ausführt, darf die Summe 12 erreichen.

Eine Senkung betrifft künftige Starts und unterbricht keine laufende Arbeit. Sind Infrastrukturwerte nicht verfügbar, bleiben Senkungen möglich; Erhöhungen brauchen einen aktuellen Kapazitätswert. Hat der Betreiber die Kapazität unter deine bisherige Summe gesenkt, reduziere die Limits vor dem nächsten Speichern. Lassen sich bereits die Organisationsbelegungen nicht laden, bleiben die Felder gesperrt, statt bearbeitbare Standardwerte anzuzeigen.

## Die Infrastrukturwerte lesen

<Frame caption="Sandboxes der Bereitstellung zeigt die gemeinsame Belegung und Kapazität. Sandboxes deiner Organisation zählt auch Umgebungen im Leerlauf, die zur Wiederverwendung bereitstehen.">

![Die Infrastrukturkapazität zeigt die Sandbox-Anzahl aller Organisationen im Verhältnis zur Gesamtkapazität, die Sandbox-Anzahl der eigenen Organisation sowie gemessene CPU- und Speicherwerte.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Messwert | Bedeutung |
| --- | --- |
| Sandboxes des Deployments | Laufende und startende Umgebungen aller Organisationen im Verhältnis zur gemeinsamen Kapazität. Kubernetes betrachtet den Namespace. |
| Sandboxes deiner Organisation | Laufende und startende Umgebungen dieser Organisation, einschließlich bereitgehaltener inaktiver Umgebungen. Das ist eine Anzahl, kein weiteres Limit. |
| CPU-Auslastung des Hosts | Kürzlich genutzte und gesamte CPU-Kerne, einschließlich anderer Dienste auf dem Host. |
| Arbeitsspeicher des Hosts | Genutzter und gesamter Speicher, einschließlich anderer Dienste und unter Berücksichtigung freigebbaren Caches. |

Die Werte aktualisieren sich alle 15 Sekunden. Mit **Aktualisieren** forderst du eine neue Beobachtung an. Prüfe den Zeitstempel. Die CPU-Auslastung ist die Differenz zweier Messungen; die erste Beobachtung nach einer längeren Pause dauert etwa eine Sekunde länger. Entfernte Hosts liefern gegebenenfalls nur Gesamtwerte. Namespace-Zugriff unter Kubernetes liefert keine Host-Messungen. Nicht verfügbare Werte sind unbekannt, nicht null.

## Belegte und inaktive Workspaces unterscheiden

Inhaber und Admins können **Arbeitsbereiche** prüfen. Jede Zeile nennt den zugehörigen Agenten oder Workflow-Lauf, Laufzeitstatus, Belegungsstatus und laufende Aufgaben. Die Zustände beantworten unterschiedliche Fragen: Ein Container kann für die Wiederverwendung weiterlaufen, obwohl er seinen Organisationsplatz bereits freigegeben hat. Der Arbeitsbereich eines Projekt-Agenten bleibt auch im Leerlauf aufgeführt, als **Gestoppt** mit **Kontingent freigegeben**, bis du ihn löschst oder Tale ihn löscht: wenn ihn niemand [während der von deiner Organisation festgelegten Anzahl Tage](#delete-unused-workspaces-automatically) genutzt hat oder wenn [sein Agent, sein Projekt oder das zugehörige Mitglied entfernt wird](#explain-why-a-workspace-disappeared). Wurde der Agent selbst gelöscht, steht in der Zeile **Gelöschter Agent**, bis Tale den Arbeitsbereich gelöscht hat. Der Arbeitsbereich eines Workflow-Laufs wird kurz nach dem Ende des Laufs zurückgefordert.

Die Ausgaben enthalten die gemessenen Kosten abgeschlossener Durchläufe. Ein noch laufender Durchlauf wird nach seinem Ende eingerechnet. Vorübergehende Crawler-Umgebungen zählen zur Kapazität, auch ohne eigene dauerhafte Workspace-Zeile.

Ist die Deployment-Kapazität voll, kann Tale eine nicht angeheftete, inaktive Umgebung zurückfordern, deren Belegung freigegeben ist und die bestätigt, dass keine Arbeit mehr läuft. Die dauerhaften Workspace-Dateien bleiben für den nächsten Start erhalten. Beschäftigte, angeheftete oder nicht erreichbare Umgebungen kommen nicht infrage. Ohne geeigneten Kandidaten braucht neue Arbeit freie Kapazität. Eine Umgebung, deren Aufgabe oder Lauf beendet ist, stoppt nach einigen Minuten im Leerlauf, sodass ihr Platz bald nach dem Ende der Arbeit frei wird. Eine Agent-Umgebung, in der Docker läuft, behält ihre volle Leerlaufzeit, damit der nächste Durchgang ihre Images nicht erneut laden muss.

## Einen bestehenden Arbeitsbereich verwalten

Inhaber und Admins finden im Zeilenmenü diese Aktionen:

| Aktion | Wirkung |
| --- | --- |
| **Aufgabe stoppen** | Bricht alle laufenden Vorgänge dieses Arbeitsbereichs ab. Prüfe zuerst die Aufgabenliste; ein Agent kann mehrere Aufgaben bearbeiten. |
| **Anpinnen** / **Lösen** | Nimmt den Arbeitsbereich von der automatischen Inaktivitäts- und Ablaufbereinigung und vom Löschen wegen Nichtnutzung aus oder stellt die normale Bereinigung wieder her. Eine angeheftete Belegung kann weiter Kapazität beanspruchen. Verschwindet die Umgebung eines angehefteten Arbeitsbereichs, etwa nach einem Neustart des Hosts, startet Tale sie mit den Workspace-Dateien neu; der Arbeitsbereich bleibt angeheftet. |
| **Löschen** | Fragt nach Bestätigung und entfernt dann Sandbox und Workspace-Dateien im Hintergrund: Zuerst wird die Anheftung gelöst und laufende Arbeit abgebrochen. Bis der Arbeitsbereich entfernt ist, steht in seiner Zeile **Wird gelöscht**, und du kannst die Seite währenddessen weiter nutzen. Kann Tale ihn auch nach mehreren Versuchen nicht entfernen, bleibt der Arbeitsbereich ohne Anheftung in der Liste und zeigt **Nicht gelöscht**; wähle dann erneut **Löschen**, um ihn vollständig zu entfernen. Solange die Zeile **Wird gelöscht** zeigt, startet in diesem Arbeitsbereich nichts Neues: Der Lauf eines Agenten wartet und zeigt **Wartet auf einen Sandbox-Platz**, und ein Schritt eines Workflow-Laufs, der den Arbeitsbereich braucht, schlägt mit dem Grund fehl. Ist die Zeile verschwunden, erzeugt der nächste Start eine neue Umgebung; zeigt sie stattdessen **Nicht gelöscht**, geht die wartende Arbeit mit den alten Dateien weiter. |

Stoppe die Aufgabe, wenn die Arbeit enden, ihre Dateien aber bleiben sollen. Sichere vor dem Löschen benötigte Ergebnisse und lies die Bestätigung. Automatische Rückgewinnung inaktiver Kapazität bewahrt Workspace-Dateien; ausdrückliches und automatisches Löschen entfernen sie.

## Ungenutzte Arbeitsbereiche automatisch löschen {#delete-unused-workspaces-automatically}

Ein Projekt-Agent bewahrt seine Dateien zwischen den Läufen in Arbeitsbereichen auf: in einem, den er für alle seine Aufgaben wiederverwendet, und in einem getrennten für jedes Mitglied, das [seine Läufe startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet). Tale löscht einen Arbeitsbereich, den niemand während der von deiner Organisation festgelegten Anzahl Tage genutzt hat; **Löschen** entfernt einen Arbeitsbereich weiterhin sofort. Inhaber und Admins legen diese Regel unter **Bereinigung der Arbeitsbereiche** fest, direkt über der Liste **Arbeitsbereiche**. Entwickler sehen diesen Abschnitt nicht.

<Frame caption="Ist Ungenutzte Arbeitsbereiche löschen eingeschaltet, löscht Tale einen Arbeitsbereich, den niemand während der festgelegten Anzahl Tage genutzt hat. Angepinnte Arbeitsbereiche bleiben erhalten.">

![Der Abschnitt Bereinigung der Arbeitsbereiche zeigt den eingeschalteten Schalter Ungenutzte Arbeitsbereiche löschen und den Wert 30 bei Tage ohne Nutzung, jeweils mit einer Erklärung ihrer Wirkung.](/images/platform/sandbox-workspace-cleanup.webp)

</Frame>

1. Lass **Ungenutzte Arbeitsbereiche löschen** eingeschaltet, wie es voreingestellt ist. Solange der Schalter aus ist, löscht Tale keinen Arbeitsbereich wegen Nichtnutzung.
2. Gib bei **Tage ohne Nutzung** eine ganze Zahl von 1 bis 3650 ein; voreingestellt sind 30. Die Tage zählen ab dem Zeitpunkt, an dem der Agent zuletzt im Arbeitsbereich gearbeitet hat, oder ab dem Lösen seiner Anheftung.
3. Wähle **Speichern** im Kopfbereich. **Verwerfen** stellt die gespeicherten Werte wieder her.

Nach einer Änderung wird nie ein Arbeitsbereich vorzeitig gelöscht. Schaltest du das Löschen ein oder verkürzt du den Zeitraum, wird kein Arbeitsbereich wegen Nichtnutzung gelöscht, bevor seit der Änderung die volle Anzahl Tage vergangen ist. Dieselbe Wartezeit folgt auf das Update, das die Einstellung eingeführt hat. Ein längerer Zeitraum startet die Wartezeit nicht neu, Aus- und erneutes Einschalten dagegen schon.

In der Liste **Arbeitsbereiche** zeigt ein gestoppter Agenten-Arbeitsbereich unter seinem Status, wann er gelöscht wird: **Wird am … gelöscht, falls weiterhin ungenutzt**. Ein neuer Lauf im Arbeitsbereich startet die Zählung neu. Ein angepinnter Arbeitsbereich oder einer, den ein [Legal Hold](/de/platform/admin/governance/legal-hold) bewahrt, zeigt kein Datum und wird nie wegen Nichtnutzung gelöscht.

## Klären, warum ein Arbeitsbereich verschwunden ist {#explain-why-a-workspace-disappeared}

Neben ungenutzten Arbeitsbereichen löscht Tale einen Arbeitsbereich auch, sobald entfernt wird, wozu er gehört, unabhängig von der Bereinigungseinstellung:

- Das Löschen eines Projekt-Agenten löscht alle seine Arbeitsbereiche, auch die der Mitglieder. Das Löschen eines Projekts tut dasselbe für jeden Agenten darin.
- [Entfernst du ein Mitglied](/de/platform/admin/members-and-roles#zugriff-entziehen-oder-wiederherstellen) aus der Organisation, werden seine eigenen Arbeitsbereiche mit allen Agenten gelöscht. Setzt du es stattdessen auf **Deaktiviert**, bleiben sie erhalten.
- [Die Löschung der Daten einer Person](/de/platform/admin/governance/data-subject-requests) entfernt ihre eigenen Arbeitsbereiche, ohne auf laufende Arbeit darin zu warten.
- Das Löschen der Organisation entfernt alle ihre Sandboxes samt Dateien, widerruft die dafür ausgegebenen Gateway-Schlüssel, trennt ihre [Geräte](/de/platform/admin/sandbox-devices) und löscht die für sie angelegten Build- und Paket-Caches.

Das geschieht innerhalb von etwa einer Minute oder, falls im Arbeitsbereich noch eine Aufgabe läuft, nach deren Ende. Auch ein angepinnter Arbeitsbereich wird dann gelöscht, doch ein [Legal Hold](/de/platform/admin/governance/legal-hold) bewahrt jeden Arbeitsbereich, den er abdeckt: Eine Sperre der Organisation bewahrt alle, eine Sperre für eine Person deren eigene Arbeitsbereiche. Eine stündliche Bereinigung löscht außerdem Überreste, die niemandem mehr gehören, etwa den Arbeitsbereich eines Workflow-Laufs, der nie zurückgefordert wurde.

Jeden Arbeitsbereich, den Tale von selbst löscht, aus einem dieser Gründe oder wegen Nichtnutzung, verzeichnet das [Audit-Log](/de/platform/admin/governance/audit-logs) unter **Einstellungen > Richtlinien > Protokolle** als **Sandbox-Arbeitsbereich gelöscht**. Das ist ein Systemereignis der Kategorie **Daten**, dessen Metadaten den Grund nennen: `agent_deleted`, `member_removed`, `member_erased`, `unused` oder `orphaned`.

## Einen blockierten Start klären

Ein Start ohne freien Platz wartet, und du musst nichts tun. Sind die Limits deiner Organisation belegt oder ist das Deployment voll oder knapp an Arbeitsspeicher oder Speicherplatz, startet die Arbeit von selbst, sobald Platz frei wird. Ist das Deployment selbst voll, geht sein Platz an die Arbeit, die am längsten wartet, egal aus welcher Organisation, und jeder wartende Start erfährt, wann er an der Reihe ist:

- Ein Aufgabenlauf wartet in der Warteschlange. Er wird erneut versucht, sobald eine Sitzung endet, in deiner Organisation oder in einer anderen auf demselben Deployment. Ist das Deployment voll, wird er auch versucht, wenn er an der Reihe ist. Zusätzlich versucht Tale alle zwei Minuten einige wartende Läufe jeder Organisation, die am längsten wartenden zuerst.
- Der Agent-Schritt einer Automatisierung versucht es erneut, ohne seine Wiederholungen zu verbrauchen: wenn er an der Reihe ist, falls das Deployment voll ist, sonst nach einer Pause, die länger wird, solange der Schritt weiter wartet, bis zu etwa zwei Minuten. Der Lauf zeigt währenddessen **Wartet auf einen Sandbox-Platz**. Findet er zwei Stunden lang keinen Platz, schlägt der Lauf mit diesem Grund fehl.
- Das Crawling wartet, bis es an der Reihe ist, und setzt dann mit dem nächsten Stapel fort.

Erhöhe ein Arbeitslimit nur, wenn seine Plätze belegt sind und die neue Summe in die gemeinsame Kapazität passt. Ist das Deployment voll, schafft ein höheres Organisationslimit keine Infrastruktur. Für eigene Kapazität [verbindest du ein Gerät](/de/platform/admin/sandbox-devices): Neue Arbeitsbereiche starten dann darauf. Andernfalls lass den Betreiber Kapazität und Host-Ressourcen prüfen. Ein freier Containerplatz garantiert noch nicht genügend CPU, Arbeitsspeicher oder Speicherplatz.

Bei Zugangs- oder Modellproblemen hilft [KI-Provider](/de/platform/admin/providers), bei Ausgabengrenzen [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). Self-Hosted-Betreiber finden die Deployment-Einstellung in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure).
