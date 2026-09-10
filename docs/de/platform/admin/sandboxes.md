---
title: Sandboxes
description: Begrenze gleichzeitige Aufgaben und vergleiche belegte Kontingente mit laufenden Sandboxes und der Host-Auslastung.
---

Unter Sandboxes siehst du, wie viel Arbeit deine Organisation starten darf und wie viel Infrastruktur gerade belegt ist. Öffne als Admin oder Inhaber **Einstellungen > Sandboxes**, um die Grenzen zu ändern; Entwickler sehen die Grenzen und die zusammengefasste Kapazität, aber keine Details privater Arbeitsumgebungen.

<Frame caption="Vergleiche gespeicherte Organisationsgrenzen mit erfassten Laufzeitplätzen und der Host-Kapazität. Nicht messbare Auslastung bleibt ausdrücklich als nicht verfügbar gekennzeichnet.">

![Die Sandbox-Einstellungen zeigen drei bearbeitbare Organisationsgrenzen, tatsächliche Laufzeitplätze und gemessene Gesamtwerte für CPU und Arbeitsspeicher des Hosts.](/images/platform/settings-sandboxes.webp)

</Frame>

## Gleichzeitige Aufgaben begrenzen

Ändere eine Grenze und klicke im Seitenkopf auf **Speichern**. **Verwerfen** stellt die gespeicherten Werte wieder her. Jede Grenze erlaubt eine ganze Zahl von 1 bis 500 und gilt für neue Starts. Eine niedrigere Grenze unterbricht keine laufende Arbeit.

| Aufgabe | Standard | Was ein Kontingent belegt |
| --- | --- | --- |
| Projektagenten | 2 | Die Arbeitsumgebung eines Agenten beim Start oder während der Arbeit; derselbe Agent nutzt sie für weitere Aufgaben wieder. |
| Workflows | 4 | Die Arbeitsumgebung eines Workflow-Laufs, die seine Agenten- und Skriptschritte gemeinsam nutzen. |
| Rendering | 4 | Temporäre Umgebungen, die Webseiten beim Crawling rendern. |

Die Belegungsanzeige vergleicht belegte Organisationskontingente mit der gespeicherten Grenze. Fehlen die Belegungsdaten, bleiben die Eingaben gesperrt; stattdessen erscheinen keine bearbeitbaren Standardwerte.

## Tatsächliche Kapazität ablesen

Die Infrastrukturkapazität aktualisiert sich alle 15 Sekunden. Mit **Aktualisieren** rufst du eine weitere Messung ab. Diese Zahlen beschreiben eine andere Grenze als die Organisationskontingente:

| Messwert | Bedeutung |
| --- | --- |
| Session-Plätze des Hosts | Laufende und startende Umgebungen aller Organisationen im Verhältnis zur Grenze der Installation; unter Kubernetes gilt der Namespace. |
| Laufzeitplätze deiner Organisation | Laufende und startende Umgebungen deiner Organisation über alle Aufgabenarten hinweg, begrenzt durch die Installation. |
| CPU-Auslastung des Hosts | Kürzlich genutzte und insgesamt verfügbare CPU-Kerne, einschließlich anderer Dienste. |
| Arbeitsspeicher des Hosts | Belegter und gesamter Arbeitsspeicher in GiB, einschließlich anderer Dienste und unter Berücksichtigung freigebbarer Caches. |

Der Messzeitpunkt zeigt das Alter der Daten. Die CPU-Anzeige braucht zwei aktuelle Messungen; nach einer längeren Pause kann die Auslastung zunächst fehlen. Entfernte Hosts liefern gegebenenfalls Gesamtwerte ohne Auslastung. Ein Kubernetes-Namespace gibt keine Host-Messwerte frei. Eine fehlgeschlagene Messung erscheint als nicht verfügbar, niemals als null Auslastung.

## Belegung der Arbeitsumgebungen verstehen

Admins und Inhaber sehen außerdem die Arbeitsumgebungen mit dem zugehörigen Agenten oder Workflow und dem aktuellen Vorgang. Ein freigegebenes Kontingent kann noch zu einer laufenden Umgebung gehören: Die Arbeit ist beendet und der Organisationsplatz frei, während der Container bis zur Leerlaufbereinigung bereitsteht. Laufzeitstatus und Kontingentbelegung erscheinen deshalb getrennt.

Crawling-Umgebungen sind temporär. Sie zählen zur Kapazität, auch wenn keine dauerhafte Arbeitsumgebung in der Liste steht.

## Die passende Grenze ändern

Erhöhe eine Organisationsgrenze, wenn das Kontingent dieser Aufgabenart voll ist und die Installation noch Platz hat. Die Änderung fügt weder CPU noch Arbeitsspeicher hinzu; auch ein freier Laufzeitplatz garantiert keine ausreichenden Ressourcen. Die Laufzeitgrenzen legt der Betreiber fest. Für selbst gehostete Installationen stehen sie in der [Umgebungsvariablen-Referenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastruktur). Token- und Ausgabenbudgets bleiben unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).
