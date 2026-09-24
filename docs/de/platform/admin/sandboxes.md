---
title: Sandbox-Kapazität verwalten
description: Passe Grenzen für gleichzeitige Arbeit an, lies Infrastrukturwerte und kläre blockierte Sandbox-Starts.
---

Öffne **Einstellungen > Sandboxes**, wenn Agenten oder Website-Scans keine Ausführungsumgebung erhalten. Die Seite trennt die Arbeitsgrenzen deiner Organisation von der tatsächlichen Infrastruktur des Deployments. Inhaber und Admins dürfen Limits ändern. Entwickler sehen Limits und zusammengefasste Kapazität, aber keine privaten Workspace-Details.

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

Die Standardwerte ergeben zusammen 6. Bei einer Deployment-Kapazität von 8 ist eine Summe von 8 erlaubt, 9 wird abgelehnt. Der Server prüft die Kapazität beim Speichern erneut. Der aktuelle Wert kann deshalb von der ersten Beobachtung abweichen.

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

Die Werte aktualisieren sich alle 15 Sekunden. Mit **Aktualisieren** forderst du eine neue Beobachtung an. Prüfe den Zeitstempel. Die CPU-Auslastung benötigt zwei Messungen; nach einer längeren Pause kann sie zunächst fehlen. Entfernte Hosts liefern gegebenenfalls nur Gesamtwerte. Namespace-Zugriff unter Kubernetes liefert keine Host-Messungen. Nicht verfügbare Werte sind unbekannt, nicht null.

## Belegte und inaktive Workspaces unterscheiden

Inhaber und Admins können **Arbeitsbereiche** prüfen. Jede Zeile nennt den zugehörigen Agenten oder Workflow-Lauf, Laufzeitstatus, Belegungsstatus und laufende Aufgaben. Die Zustände beantworten unterschiedliche Fragen: Ein Container kann für die Wiederverwendung weiterlaufen, obwohl er seinen Organisationsplatz bereits freigegeben hat. Der Arbeitsbereich eines Projekt-Agenten bleibt auch im Leerlauf aufgeführt, als **Gestoppt** mit **Kontingent freigegeben**, und verschwindet erst, wenn du ihn löschst. Der Arbeitsbereich eines Workflow-Laufs wird kurz nach dem Ende des Laufs zurückgefordert.

Die Ausgaben enthalten die gemessenen Kosten abgeschlossener Durchläufe. Ein noch laufender Durchlauf wird nach seinem Ende eingerechnet. Vorübergehende Crawler-Umgebungen zählen zur Kapazität, auch ohne eigene dauerhafte Workspace-Zeile.

Ist die Deployment-Kapazität voll, kann Tale eine nicht angeheftete, inaktive Umgebung zurückfordern, deren Belegung freigegeben ist und die bestätigt, dass keine Arbeit mehr läuft. Die dauerhaften Workspace-Dateien bleiben für den nächsten Start erhalten. Beschäftigte, angeheftete oder nicht erreichbare Umgebungen kommen nicht infrage. Ohne geeigneten Kandidaten braucht neue Arbeit freie Kapazität.

## Einen bestehenden Arbeitsbereich verwalten

Inhaber und Admins finden im Zeilenmenü diese Aktionen:

| Aktion | Wirkung |
| --- | --- |
| **Aufgabe stoppen** | Bricht alle laufenden Vorgänge dieses Arbeitsbereichs ab. Prüfe zuerst die Aufgabenliste; ein Agent kann mehrere Aufgaben bearbeiten. |
| **Anpinnen** / **Lösen** | Nimmt den Arbeitsbereich von der automatischen Inaktivitäts- und Ablaufbereinigung aus oder stellt die normale Bereinigung wieder her. Eine angeheftete Belegung kann weiter Kapazität beanspruchen. |
| **Löschen** | Fragt nach Bestätigung, bricht laufende Arbeit ab und entfernt Sandbox und Workspace-Dateien. Der nächste Agentenstart erzeugt eine neue Umgebung. |

Stoppe die Aufgabe, wenn die Arbeit enden, ihre Dateien aber bleiben sollen. Sichere vor dem Löschen benötigte Ergebnisse und lies die Bestätigung. Automatische Rückgewinnung inaktiver Kapazität bewahrt Workspace-Dateien; ausdrückliches Löschen entfernt sie.

## Einen blockierten Start klären

Erhöhe ein Arbeitslimit nur, wenn seine Plätze belegt sind und die neue Summe in die gemeinsame Kapazität passt. Ist das Deployment voll, schafft ein höheres Organisationslimit keine Infrastruktur. Lass den Betreiber Kapazität und Host-Ressourcen prüfen. Ein freier Containerplatz garantiert noch nicht genügend CPU oder Speicher.

Bei Zugangs- oder Modellproblemen hilft [KI-Provider](/de/platform/admin/providers), bei Ausgabengrenzen [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). Self-Hosted-Betreiber finden die Deployment-Einstellung in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure).
