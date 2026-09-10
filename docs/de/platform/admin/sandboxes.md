---
title: Sandboxes
description: Begrenze gleichzeitige Aufgaben und vergleiche belegte Kontingente mit laufenden Sandboxes und der Host-Auslastung.
---

Unter Sandboxes siehst du, wie viel Arbeit deine Organisation starten darf und wie viel Infrastruktur gerade belegt ist. Öffne als Admin oder Inhaber **Einstellungen > Sandboxes**, um die Grenzen zu ändern; Entwickler sehen die Grenzen und die zusammengefasste Kapazität, aber keine Details privater Arbeitsumgebungen.

<Frame caption="Die Summe der drei Arbeitslimits passt sich automatisch an. Sie darf die Kapazität der Bereitstellung nicht überschreiten.">

![Der Abschnitt Organisationslimits zeigt drei bearbeitbare Sitzungslimits und ihre berechnete Summe im Verhältnis zur Kapazität der Bereitstellung.](/images/platform/settings-sandboxes.webp)

</Frame>

## Gleichzeitige Aufgaben begrenzen

Ändere eine Grenze und klicke im Seitenkopf auf **Speichern**. **Verwerfen** stellt die gespeicherten Werte wieder her. Jede Grenze erlaubt eine ganze Zahl von 1 bis 500 und gilt für neue Starts. Eine niedrigere Grenze unterbricht keine laufende Arbeit.

**Sitzungen deiner Organisation insgesamt** zeigt beim Bearbeiten die Summe der drei Limits im Verhältnis zur Kapazität der Bereitstellung. Die Standardwerte ergeben **2 + 2 + 2 = 6**. Bei einer Kapazität von 8 kannst du eine Summe von 8 speichern; bei 9 musst du zunächst ein Limit verringern. Beim Speichern prüft der Server die aktuelle Kapazität erneut. Fehlt die Kapazitätsangabe, kannst du Limits weiterhin verringern; aktualisiere die Infrastrukturdaten, bevor du ein Limit erhöhst. Senkt der Betreiber die Kapazität unter deine gespeicherte Summe, verringere die Limits, bevor du erneut speicherst.

| Aufgabe | Standard | Was ein Kontingent belegt |
| --- | --- | --- |
| Projekt-Agent-Sitzungen | 2 | Die Arbeitsumgebung eines Agenten beim Start oder während der Arbeit; derselbe Agent nutzt sie für weitere Aufgaben wieder. |
| Workflow-Sitzungen | 2 | Die Arbeitsumgebung eines Workflow-Laufs, die seine Agenten- und Skriptschritte gemeinsam nutzen. |
| Render-Sitzungen | 2 | Temporäre Umgebungen, die Webseiten beim Crawling rendern. |

Ein Workflow-Lauf nutzt eine gemeinsame Sandbox für seine Agenten- und Sandbox-Skriptschritte. Gleichzeitige Läufe haben jeweils eine eigene Sandbox und belegen jeweils ein Workflow-Kontingent, auch wenn sie denselben Workflow ausführen.

Die Belegungsanzeige vergleicht belegte Organisationskontingente mit der gespeicherten Grenze. Fehlen die Belegungsdaten, bleiben die Eingaben gesperrt; stattdessen erscheinen keine bearbeitbaren Standardwerte.

## Tatsächliche Kapazität ablesen

Die **Infrastrukturkapazität** aktualisiert sich alle 15 Sekunden. Mit **Aktualisieren** rufst du eine weitere Messung ab. Diese Zahlen beschreiben eine andere Grenze als die Organisationskontingente:

<Frame caption="Sandboxes der Bereitstellung zeigt die gemeinsame Belegung und Kapazität. Sandboxes deiner Organisation zählt auch Umgebungen im Leerlauf, die zur Wiederverwendung bereitstehen.">

![Die Infrastrukturkapazität zeigt die Sandbox-Anzahl aller Organisationen im Verhältnis zur Gesamtkapazität, die Sandbox-Anzahl der eigenen Organisation sowie gemessene CPU- und Speicherwerte.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Messwert | Bedeutung |
| --- | --- |
| Sandboxes der Bereitstellung | Laufende und startende Umgebungen aller Organisationen / Kapazität der Bereitstellung. Unter Kubernetes heißt die Anzeige **Sandboxes der Bereitstellung (Namespace)**. |
| Sandboxes deiner Organisation | Laufende und startende Umgebungen deiner Organisation über alle Aufgabenarten hinweg, auch Umgebungen im Leerlauf. Die Anzeige nennt eine Anzahl ohne separate Laufzeitgrenze für die Organisation. |
| CPU-Auslastung des Hosts | Kürzlich genutzte und insgesamt verfügbare CPU-Kerne, einschließlich anderer Dienste. |
| Speichernutzung des Hosts | Belegter und gesamter Arbeitsspeicher in GiB, einschließlich anderer Dienste und unter Berücksichtigung freigebbarer Caches. |

Der Messzeitpunkt zeigt das Alter der Daten. Die CPU-Anzeige braucht zwei aktuelle Messungen; nach einer längeren Pause kann die Auslastung zunächst fehlen. Entfernte Hosts liefern gegebenenfalls Gesamtwerte ohne Auslastung. Ein Kubernetes-Namespace gibt keine Host-Messwerte frei. Eine fehlgeschlagene Messung erscheint als nicht verfügbar, niemals als null Auslastung.

## Belegung der Arbeitsumgebungen verstehen

Admins und Inhaber sehen außerdem die **Arbeitsbereiche**. Jede Zeile nennt den Agenten oder Workflow-Lauf, dem der Arbeitsbereich gehört, seinen Laufzeit- und Kontingentstatus und jede Aufgabe, die gerade darin läuft. Ein Projektagent bearbeitet seine Aufgaben gleichzeitig in dem einen Arbeitsbereich, der ihm gehört — eine Zeile kann also mehrere Aufgaben aufführen, während die Organisationsgrenze nur eine Sitzung zählt. **Kosten** summiert die gemessenen Kosten der abgeschlossenen Durchläufe des Arbeitsbereichs; ein noch laufender Durchlauf kommt hinzu, sobald er endet. Ein freigegebenes Kontingent kann noch zu einer laufenden Umgebung gehören: Die Arbeit ist beendet und der Organisationsplatz frei, während der Container bis zur Leerlaufbereinigung bereitsteht. Laufzeitstatus und Kontingentbelegung erscheinen deshalb getrennt.

Ist die Kapazität der Bereitstellung voll, kann Tale eine nicht angepinnte Umgebung im Leerlauf mit freigegebenem Kontingent stoppen, um Platz für neue Arbeit zu schaffen. Die Dateien ihres dauerhaften Arbeitsbereichs bleiben für den nächsten Start erhalten. Die Umgebung muss bestätigen, dass keine Arbeit mehr läuft. Angepinnte, beschäftigte oder nicht erreichbare Umgebungen sind vor dieser Freigabe geschützt. Gibt es keinen geeigneten Kandidaten, braucht neue Arbeit weiterhin freie Kapazität.

Crawling-Umgebungen sind temporär. Sie zählen zur Kapazität, auch wenn keine dauerhafte Arbeitsumgebung in der Liste steht.

## Die passende Grenze ändern

Erhöhe eine Organisationsgrenze, wenn das Kontingent dieser Aufgabenart voll ist und die neue Summe in die Kapazität der Bereitstellung passt. Andere Organisationen teilen sich diese Kapazität; deine Limits reservieren weder Container noch CPU oder Arbeitsspeicher. Auch ein freier Platz garantiert keine ausreichenden Ressourcen für weitere Arbeit. Der Betreiber legt die gemeinsame Kapazität fest. Für selbst gehostete Installationen steht die Einstellung in der [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastruktur). Token- und Ausgabenbudgets bleiben unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).
