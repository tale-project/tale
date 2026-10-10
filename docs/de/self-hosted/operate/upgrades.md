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

Das Leeren umfasst auch Automations. Worker der alten Farbe starten keinen neuen Job und geben jeden Automations-Lauf beim nächsten Schritt weiter, sodass er auf der neuen Farbe weiterläuft; die CLI wartet innerhalb derselben drei Minuten auch auf diese Schritte. Wenn die alten Container anhalten, hat jeder Worker 120 Sekunden, um weiterzugeben, was er noch hält (mehr, wenn du `SHUTDOWN_DRAIN_MS` erhöhst: Die CLI hält diese Frist 15 Sekunden darüber), und ein Schritt, der 20 Sekunden nach Beginn des Anhaltens noch arbeitet, wird unterbrochen und läuft auf der neuen Farbe noch einmal. Ausgenommen ist ein Schritt, der gerade etwas an einen externen Dienst gesendet hat, denn der Dienst hat es vielleicht schon erhalten: Dieser Lauf wartet, bis eine Person entscheidet, wie es weitergeht, wie [Automatisierungsläufe prüfen und Fehler beheben](/de/platform/automations/execution-logs) es beschreibt. Das erste Update auf Automations-Schreibprotokoll 2 läuft anders ab: Die Migration hält alle älteren Läufe in der Warteschlange, in Ausführung oder im Wartezustand an und bewahrt ihren vorherigen Zustand sowie ungeklärte externe Auswirkungen. Sie laufen nicht automatisch weiter. Bereits zugelassene oder gesendete Arbeit eines alten Workers kann noch abgeschlossen werden. Eine ausdrückliche Stoppanforderung hält fest, wer sie gestellt hat, und fordert den Abbruch der zugehörigen Sitzung an; sie belegt weder deren Ende noch das Ergebnis eines externen Schreibvorgangs. Sie gibt die gehaltene Aufgabe und ihre Nachweise nicht frei. Prüfe das tatsächliche Ergebnis, bevor du Ersatzarbeit planst.

Das Modell-Gateway wird an Ort und Stelle ersetzt, bevor die neue Farbe startet. Wenn sein Container stoppt, nimmt das Gateway keine neuen Modellaufrufe mehr an und gibt laufenden Aufrufen, gestreamte Antworten eingeschlossen, bis zu 90 Sekunden, um fertig zu werden. Seine Ausgabenzähler speichert es am Ende nur, wenn das innerhalb von 30 Sekunden nach dem Stopp geschieht, denn das eigene Aufräumfenster des Gateways zählt ab dem Stoppsignal. Ein Aufruf, der danach noch streamt, wird vollständig beantwortet, aber seine Kosten und die der Sekunden davor werden womöglich nicht gebucht. Bis das neue Gateway antwortet, schlägt ein neuer Modellaufruf fehl, und eine Antwort, die nach 90 Sekunden noch gestreamt wird, bricht ab. Eine Bereitstellung kann deshalb bis zu 90 Sekunden auf das Gateway warten.

Beide Farben verwenden das Volume `static-assets` der Bereitstellung. Bevor eine Web-Replik bereit ist, legt sie dort die unveränderlichen Skripte, Stylesheets, Schriftarten und Bilder ihres Builds ab. So kann jede Farbe die Dateien liefern, auf die das HTML der anderen Farbe verweist. Laufende Repliken frischen ihre Dateien stündlich auf; ausgemusterte Dateien bleiben danach noch sieben Tage verfügbar. Binde dieses gemeinsame Volume auch in deinem eigenen Compose-Aufbau auf jeder Web-Replik ein. Beim ersten Upgrade von einer Version ohne diese Unterstützung fehlt den alten Repliken diese gemeinsame Rückfallmöglichkeit noch.

Ein offener Tab arbeitet bei der Übergabe normalerweise weiter. Ist ein benötigter Teil nicht mehr verfügbar, wartet Tale, bis API und Datenbank antworten, und lädt dann einmal neu. Lässt sich der Teil weiterhin nicht laden, zeigt Tale **Eine neue Version ist verfügbar** mit der Aktion **Neu laden**, statt erneut automatisch zu laden. Während eines Ausfalls bleibt der Verbindungshinweis sichtbar. Fehlgeschlagene Leseanfragen werden nach der Wiederverbindung aktualisiert; fehlgeschlagene Schreibanfragen werden nicht automatisch erneut gesendet.

Wird die neue Gruppe nicht innerhalb von `HEALTH_CHECK_TIMEOUT` gesund, schließt die CLI den Wechsel nicht ab. Prüfe gespeicherten Bereitstellungszustand und Protokolle vor einem erneuten Versuch. Ein unterbrochener Rollout kann beide Gruppen oder eine ausstehende Übergabe hinterlassen. Folge den Wiederherstellungshinweisen der CLI, statt Container oder Zustandsdateien von Hand zu löschen.

## Migrationen und Nutzerergebnis prüfen

Beim Start wendet das Backend seine nummerierten Migrationen in der Reihenfolge ihrer Dateinamen unter einem sitzungsgebundenen Advisory Lock an. SQL-Migrationen ändern das Schema, TypeScript-Datenmigrationen aktualisieren bestehende Zeilen nach den Regeln der Anwendung. Die Tabelle `app_migrations` verzeichnet beide Arten mit ihrem Dateinamen, sodass jede Migration pro Datenbank nur einmal läuft. Andere Replikate warten darauf. Ein Migrationsfehler verhindert den regulären Start des neuen Backends. Prüfe Fehler und Datenbank vor einem neuen Versuch. Vorwärtsgerichtete Migrationen werden durch einen anderen Image-Tag nicht rückgängig gemacht.

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

`tale rollback` tauscht nur die Anwendungs-Images von `platform`, `backend-api` und `backend-worker` aus. Es stellt kein Volume wieder her und lässt Datenbank, Speicher, Proxy, Sandbox-Dienste und Modell-Gateway, wie sie sind. Auch sonst stellt kein Bereitstellungsschritt von selbst Daten wieder her: Scheitert ein gewöhnlicher Deploy (ohne `--services`) an seinen Zustandsprüfungen, bleibt die bisherige Anwendungsfarbe in Betrieb, doch was er bereits an Ort und Stelle ersetzt hat, bleibt ersetzt. Nur `tale restore` spielt die Volumes eines Snapshots zurück.

## Umstellung des Automations-Protokolls: mit kompatibler Version reparieren

Sobald die Datenbank Automations-Schreibprotokoll 2 verzeichnet, brauchst du eine Runtime mit Protokoll 2 und die passende CLI. Bevor die CLI Deployment-Dateien, Infrastruktur oder Datenverkehr ändert, liest sie das installierte Migrationsverzeichnis und prüft Protokoll, Quellrevision und unveränderlichen Digest des ausgewählten Backend-Images. Ein älteres Image, fehlende oder nicht unterstützte Protokollmetadaten, ein unlesbares oder mehrdeutiges Verzeichnis oder eine geänderte Datenbankidentität stoppen Deployment und Rollback. Vor der Umschaltung muss eine ausstehende Farbe in jeder Backend-Rolle dasselbe zugelassene Image enthalten. Eine angehaltene Datenbank wird für diese Prüfung nicht automatisch gestartet.

Auch ein bereits erstelltes Protokoll-2-Backend verlangt ein kompatibles Ziel, selbst wenn es angehalten ist oder seine erste Migration noch nicht abgeschlossen hat. Die CLI liest das installierte Mindestprotokoll nach dem Image-Download und vor Deployment-Änderungen erneut. Eine parallel verwendete ältere CLI oder manuelle Docker-Befehle fallen nicht unter diese Koordination.

Die aktuelle Prüfung für tagbasierte Deployments unterstützt nur die mitgelieferte Anwendungsdatenbank. Ein ausdrücklich gesetztes `DATABASE_URL`, ein eigenes `APP_DB_NAME` oder ein installiertes Backend, das noch auf eine andere Datenbank zeigt, werden abgelehnt, bis ein gesondert verifizierter Leseweg vorliegt. Eine entfernte Überschreibung in `.env` belegt nicht, dass das laufende Backend seine Verbindung geändert hat. Lass die bestehende Runtime bestehen und repariere die Prüfung; umgehe die Ablehnung nicht mit einer älteren CLI.

Ältere CLIs und ein manueller Image-Austausch setzen diese Deployment-Prüfung nicht um. Die Schreibsperre der Datenbank und getrennte Ausführungswarteschlangen bleiben im Mischbetrieb notwendig. Ein Backup stellt gespeicherte Daten wieder her, aber keine bereits gesendeten Nachrichten, Zahlungen oder anderen Auswirkungen bei externen Diensten. Es erlaubt nach dieser Umstellung keine Runtime mit dem alten Protokoll. Repariere mit einer kompatiblen Version und bewahre gehaltene Läufe samt Nachweisen auf.

## Bifrost 1.6 → 2.2: Der Speicher des Modell-Gateways wird migriert

Ein Release nach 0.5.64 stellt das Modell-Gateway (`sandbox-llm-gateway`) von Bifrost 1.6 auf Bifrost 2.2 um; seine Release Notes nennen den Wechsel. Beim ersten Start migriert das neue Gateway seinen Speicher in `llm-gateway-data` an Ort und Stelle und behält Anbieter, Schlüssel, Budgets und Admin-Konto; von Hand ist nichts zu tun. Die Migration indiziert auch das Anfrageprotokoll des Gateways, daher kann dieser Start bei einer Instanz mit langer Anfragehistorie länger dauern.

`tale deploy` ersetzt das Gateway, bevor es die neue Anwendungsfarbe startet. Scheitert die Bereitstellung danach, kann der Speicher also schon migriert sein. Der Snapshot, den ein `tale deploy` mit Versionswechsel vorher erstellt, enthält `llm-gateway-data` zusammen mit den anderen Volumes und ist damit auch der Wiederherstellungspunkt des Gateways. Snapshots, die entstanden sind, bevor die CLI den Speicher des Gateways erfasste, enthalten kein solches Archiv; `tale restore` führt sie als `without gateway`. Stellst du mit `--skip-backup` bereit, kopiere das Volume vorher selbst: Stoppe das Gateway, was laufende Agent-Turns und Modellaufrufe beendet, kopiere das Volume und stelle dann bereit. `<id>` ist die `id` in `tale.json`:

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v <id>_llm-gateway-data:/from:ro -v "$PWD/llm-gateway-data-backup:/to" alpine:3.22 cp -a /from/. /to/
```

Das Gateway eines Releases vor dem Wechsel startet auf dem migrierten Speicher und bedient Tale, protokolliert aber Fehler `no such column: oauth_configs.token_id`, und Bifrost unterstützt dieses Downgrade nicht. `tale rollback` startet dieses Gateway nicht: Das Gateway bleibt bei dem neueren Image und seinem Speicher. Gestartet wird es, sobald wieder ein Release vor dem Wechsel bereitgestellt wird, etwa mit `tale update --version` und `tale deploy` nach einer Snapshot-Wiederherstellung. Bring deshalb zuerst den Speicher zurück. Stellst du den Snapshot von vor dem Upgrade wieder her, kommt `llm-gateway-data` mit den anderen Volumes zurück. Führt `tale restore` diesen Snapshot als `without gateway`, stoppe das Gateway und spiele deine Kopie zurück, bevor du das ältere Release bereitstellst:

```bash
docker stop <id>-sandbox-llm-gateway
docker run --rm -v "$PWD/llm-gateway-data-backup:/from:ro" -v <id>_llm-gateway-data:/to alpine:3.22 sh -c 'find /to -mindepth 1 -delete && cp -a /from/. /to/'
```

Ein Gateway ohne Admin-Konto, bei einer neuen Installation oder nachdem sein Volume ersetzt wurde, legt das Konto jetzt nur für einen Aufrufer an, der sein Setup-Token vorweist; das Image übernimmt es aus `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD`. `tale deploy`, die Compose-Datei im Repository und die Kubernetes-Manifeste dieser Dokumentation geben dem Gateway diese Variable bereits. Eine selbst geschriebene Compose-Datei oder ein Manifest, das sie nur dem Backend gibt, muss sie auch dem Gateway geben.

Zwei Verhaltensweisen ändern sich. Legt ein Aufrufer auf, beendet das Gateway jetzt den Modellaufruf, ob er eine ganze Antwort oder einen Stream angefordert hat. Eine abgebrochene Anfrage hält ein selbst betriebenes Modell also nicht mehr beschäftigt; die Modell-Endpunkte verbuchen einen solchen Aufruf mit seinem Prompt und der Ausgabe, die den Aufrufer erreicht hatte. Und ein Upstream, der die Antwort-Header einer gestreamten Antwort zurückhält, etwa ein Router, der Anfragen bis zu einem freien Modell in eine Warteschlange stellt, muss seine Antwort innerhalb des Anfrage-Timeouts des Gateways beginnen: 600 Sekunden, oder länger, wenn `SANDBOX_LLM_GATEWAY_STREAM_IDLE_TIMEOUT_SECONDS` es anhebt.

## 0.4 → 0.5: eine separate Installation

Mit 0.5 ersetzte Postgres den früheren Convex-Anwendungsspeicher. Es gibt keinen Importer für einen direkten Wechsel dieser Datenbanken. Halte alte Instanz und Backups intakt, während du eine neue Bereitstellung mit separatem Workspace und Datenbestand vorbereitest.

Erstelle Organisationen und Nutzer neu, prüfe und übertrage kompatible Konfiguration und importiere benötigte Dokumente erneut. Dateien in einem externen Bucket erhalten nicht automatisch Referenzen in der neuen Anwendungsdatenbank. Nimm die Ersatzumgebung ab, bevor du die alte stilllegst.

Die CLI verweigert den nicht unterstützten Umstieg standardmäßig. Die Expertenoption `--accept-data-loss` ist kein Migrationswerkzeug und erhält keine alten Anwendungsdaten. Historische Volumes oder Datenbanken können nach früheren Upgrades verbleiben. Ihr Vorhandensein allein ist kein Grund, sie bei diesem Ablauf zu löschen.

## 0.3 → 0.4: die OpenAI-kompatible API entfällt

Von 0.2.10 bis 0.3 bot Tale unter `/api/v1` eine OpenAI-kompatible Schicht: `POST /api/v1/chat/completions` und `POST /api/v1/images/generations` mit Anfragen und Antworten im OpenAI-Format sowie ein `GET /api/v1/models` im OpenAI-Format. Ihr Feld `model` konnte einen Agenten nennen. Mit dem Neuaufbau in 0.4 ist diese Schicht entfallen. Aufrufer dieser Routen, auch OpenAI-SDKs, die auf die Instanz zeigen, funktionieren danach nicht mehr, denn 0.4 bedient keine der drei Routen, und spätere Versionen bringen sie nicht zurück. Eine aktuelle Version beantwortet Chat Completions und Bildgenerierung mit `404 NOT_FOUND`, oder mit `400 ORG_SLUG_REQUIRED`, wenn der Schlüsselinhaber mehreren Organisationen angehört und die Anfrage keinen `X-Organization-Slug` mitschickt, den ein OpenAI-SDK standardmäßig nicht sendet. Ihr `GET /api/v1/models` liefert die eigene Liste von Tale mit Modellen und Agent-Laufzeiten, die ein OpenAI-Client nicht lesen kann.

Finde diese Aufrufer vor dem Upgrade und plane ihren Ersatz. Ein Aufrufer, der die Antwort eines Modells braucht, kann auf die Modell-Endpunkte umsteigen, die Versionen ab API-Vertrag 3.7.0 anbieten. Sie unterscheiden sich von der Schicht aus 0.3: Die Basis-URL ist `/api/v1/openai`, für Anthropic-Clients `/api/v1/anthropic`, statt `/api/v1`; `model` nennt ein Modell als `<providerSlug>/<modelId>`, nie einen Agenten; Bildgenerierung wird nicht bedient; und die Endpunkte sind ausgeschaltet, bis ein Admin unter **Einstellungen > Richtlinien > Modelle** den Schalter **Modell-Endpunkte für API-Schlüssel** einschaltet. Danach durchläuft jeder Aufruf Modellzugriff, Eingabe-Guardrails und Budgets. Die Modell-Endpunkte erreichen die Modelle über dasselbe Modell-Gateway wie verwaltete Agenten. Fragen aus Skripten an den eingebauten Assistenten wandern zur asynchronen REST-Chat-API, die als Assistent antwortet und nicht als reines Modell. Editor-Integrationen, die das Wissen von Tale brauchen, nutzen den MCP-Endpoint, und Arbeit, die in Tale laufen soll, in einer Sandbox und mit Prüfung durch eine Person, geht an einen Projektagenten an einer Aufgabe. [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor) beschreibt jeden dieser Wege.
