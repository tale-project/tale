---
title: Bereitstellung aktualisieren und wiederherstellen
description: Prüfe ein Upgrade vorab, stelle mit Wiederherstellungsplan bereit und wähle bei Bedarf den richtigen Rollback-Weg.
---

Bei einer Workspace-Bereitstellung ändert `tale update` CLI und Workspace-Dateien; `tale deploy` ändert die laufenden Dienste. Wähle Zielversion und Wiederherstellungspunkt vor beiden Schritten. Ein Blue-Green-Rollout lässt Anwendungsreplikate überlappen, doch Snapshots, Entleerungsphasen und der Austausch zustandsbehafteter Dienste können Arbeit unterbrechen.

Verwaltete Bereitstellungen verwenden feste Quellrevisionen und vorbereitete Bundles statt dieses Workspace-Ablaufs. Folge dafür [Verwaltete Bereitstellungen](/de/self-hosted/install/cli-install#managed-deployments). Wenn sich nur Client-Inhalte ändern, nutze [Konfigurations-Releases](/de/self-hosted/configuration/config-releases).

## Upgrade vorbereiten

1. Führe `tale status` im vorgesehenen Workspace aus. Halte laufende Version, Workspace-Version und aktuellen Bereitstellungszustand fest.
2. Lies die Release Notes der Zielversion zu Kompatibilität, erforderlicher Konfiguration und bekannten Einschränkungen. Für Instanzen vor 0.5 gilt der getrennte Umstieg weiter unten.
3. Prüfe eine wiederherstellbare Sicherung außerhalb des Hosts, passende Schlüssel und den Sicherungsumfang externer Datenbanken und Buckets. [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) beschreibt die benötigten Bestandteile.
4. Plane Kapazität für alte und neue Anwendungsreplikate gleichzeitig. Vereinbare ein Wartungsfenster, wenn Snapshots, Sandbox-Austausch oder zustandsbehaftete Dienste benötigte Arbeit unterbrechen können.
5. Prüfe die Vorschau von Update und Bereitstellung. Ein erfolgreicher Probelauf beweist nicht, dass eine echte Migration gelingt; lies alle Warnungen.

## Version auswählen

Workspace-Befehle versuchen, die CLI an die Version aus `tale.json` anzupassen. Schlägt der Download fehl, warnt die CLI und verwendet das vorhandene Programm weiter. Kläre eine unerwartete Abweichung, bevor du die Bereitstellung änderst.

Ohne Versionsargument wählt `tale update` das neueste Release innerhalb der aktuellen `major.minor`-Linie. Eine andere Linie wählst du ausdrücklich:

```bash
tale update --dry-run
tale update --version <target-version> --dry-run
tale update --version <target-version>
```

Das Update ersetzt die CLI und gleicht Workspace-Vorlagen ab; laufende Container bleiben bestehen. Scheitert der Dateiabgleich, versucht die CLI, zur vorherigen Workspace-Version zurückzukehren. Prüfe danach Dateien und Ausgabe vor der Bereitstellung.

## Vorschau prüfen und bereitstellen

```bash
tale deploy --dry-run
tale deploy
tale status
```

Ein Versionswechsel oder eine Überschreibung der Host-Konfiguration erstellt vor Änderungen einen lokalen Snapshot, sofern du nicht `--skip-backup` angibst. Dieser Snapshot ist ein zusätzlicher Schutz und ersetzt keine externe Sicherung.

| Dienstgruppe | Normale Bereitstellung | Wann zusätzliche Unterbrechung einplanen? |
| --- | --- | --- |
| `platform`, `backend-api`, `backend-worker` | Gemeinsam als neue Anwendungsfarbe ausrollen. | Alte und neue Replikate überlappen; das Entleeren kann neue Turns verweigern. |
| `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Nach dem Entleeren betroffener Arbeit an Ort und Stelle ersetzen. | Es sind gemeinsame Ausführungsdienste, keine zweite Blue-Green-Anwendungsgruppe. |
| `db`, `object-store`, `proxy` | Laufende Dienste behalten; die CLI meldet ausgelassene Updates. | Verwende `--stop`, wenn diese Dienste ersetzt werden müssen. |

```bash
tale deploy --stop
```

`TALE_PLATFORM_REPLICAS`, `TALE_BACKEND_API_REPLICAS` und `TALE_BACKEND_WORKER_REPLICAS` erlauben 1–16 Replikate. Erhöhe die Rolle, deren Engpass du gemessen hast. Mehr Worker beheben weder einen Datenbankausfall noch ein ausgeschöpftes Anbieterlimit.

## Die Übergabe verstehen

Die CLI startet die freie Farbe und wartet auf erfolgreiche Zustandsprüfungen ihrer Replikate, bevor sie die Übergabe abschließt. Während der Überlappung können beide Versionen Anfragen bedienen. Releases müssen daher während der Migration mit der vorherigen Anwendungsversion zusammenarbeiten können.

Vor dem Entfernen wird die alte API geleert: Neue Chat-Turns können eine Drain-Verweigerung erhalten, während laufende Turns Zeit zum Abschluss bekommen. Die Chat-Phase wartet bis zu drei Minuten; die Web-Phase nutzt `DRAIN_TIMEOUT`, standardmäßig 30 Sekunden. Die Web-Zustandsroute bleibt gesund, solange ihr Alias gemeinsam verwendet wird. Das Trennen der alten Container von den bedienenden Netzwerken entfernt sie aus DNS und kann übrige Verbindungen kappen. Deshalb erfolgt es nach den Entleerungsphasen.

Wird die neue Gruppe nicht innerhalb von `HEALTH_CHECK_TIMEOUT` gesund, schließt die CLI den Wechsel nicht ab. Prüfe gespeicherten Bereitstellungszustand und Protokolle vor einem erneuten Versuch. Ein unterbrochener Rollout kann beide Gruppen oder eine ausstehende Übergabe hinterlassen. Folge den Wiederherstellungshinweisen der CLI, statt Container oder Zustandsdateien von Hand zu löschen.

## Migrationen und Nutzerergebnis prüfen

Das Backend wendet nummerierte SQL-Migrationen beim Start unter einem sitzungsgebundenen Advisory Lock an. Andere Replikate warten darauf. Ein Migrationsfehler verhindert den regulären Start des neuen Backends. Prüfe Fehler und Datenbank vor einem neuen Versuch. Vorwärtsgerichtete Migrationen werden durch einen anderen Image-Tag nicht rückgängig gemacht.

`tale migrate` aktualisiert mitgelieferte Organisationsstandards und rollt keine Datenbankmigration zurück. Prüfe vor einer Überschreibung der Host-Konfiguration, ob lokale Anpassungen tatsächlich ersetzt werden sollen.

Prüfe nach der Bereitstellung öffentliches Zertifikat und Anmeldung, öffne ein vorhandenes Projekt oder einen Chat und lade eine bekannte Datei herunter. Teste kontrolliert die genutzten Wissens- und Automatisierungsfunktionen. Kontrolliere Worker-Fortschritt, Speicherzustand und die tatsächlich laufende Version. Bewahre die Sicherung von vor dem Upgrade bis zur Abnahme auf.

## Rollback-Weg wählen

| Situation | Wiederherstellung |
| --- | --- |
| Zur gespeicherten vorherigen Version derselben `major.minor`-Linie zurückkehren | `tale rollback` prüft diese Grenze und fragt vor der erneuten Bereitstellung nach Bestätigung. Lies zusätzlich die Kompatibilitätshinweise des Releases. |
| Über eine Minor- oder Major-Grenze zurückkehren | Stelle den abgestimmten Datenstand vor dem Upgrade und dessen passende Version wieder her. `tale rollback` verweigert dieses reine Image-Downgrade. |
| Zielversion oder Datenkompatibilität unbekannt | Kläre Version und Herkunft der Sicherung vor dem Start eines älteren Programms. |

```bash
tale rollback
```

`--yes` überspringt die Bestätigung für einen bereits genehmigten unbeaufsichtigten Lauf. Die Prüfung derselben Versionslinie ist eine Schranke, kein eigenständiger Nachweis der Kompatibilität aller externen Integrationen und lokalen Anpassungen. Eine ältere Migrationsliste als Präfix der neuen macht ein Downgrade allein nicht sicher.

## 0.4 → 0.5: eine separate Installation

Mit 0.5 ersetzte Postgres den früheren Convex-Anwendungsspeicher. Es gibt keinen Importer für einen direkten Wechsel dieser Datenbanken. Halte alte Instanz und Backups intakt, während du eine neue Bereitstellung mit separatem Workspace und Datenbestand vorbereitest.

Erstelle Organisationen und Nutzer neu, prüfe und übertrage kompatible Konfiguration und importiere benötigte Dokumente erneut. Dateien in einem externen Bucket erhalten nicht automatisch Referenzen in der neuen Anwendungsdatenbank. Nimm die Ersatzumgebung ab, bevor du die alte stilllegst.

Die CLI verweigert den nicht unterstützten Umstieg standardmäßig. Die Expertenoption `--accept-data-loss` ist kein Migrationswerkzeug und erhält keine alten Anwendungsdaten. Historische Volumes oder Datenbanken können nach früheren Upgrades verbleiben. Ihr Vorhandensein allein ist kein Grund, sie bei diesem Ablauf zu löschen.
