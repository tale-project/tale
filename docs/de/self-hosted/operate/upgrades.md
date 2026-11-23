---
title: Bereitstellung aktualisieren und wiederherstellen
description: Prüfe ein Upgrade vorab, stelle mit Wiederherstellungsplan bereit und wähle bei Bedarf den richtigen Rollback-Weg.
# The CLI's deployment workspace (`tale init`) keeps its English name in German,
# and terminology-ui-label cannot tell it from the app's Arbeitsbereich.
i18nLintExclude:
  - terminology-ui-label
---

Bei einer Workspace-Bereitstellung ändert `tale update` CLI und Workspace-Dateien; `tale deploy` ändert die laufenden Dienste. Wähle Zielversion und Wiederherstellungspunkt vor beiden Schritten. Ein Blue-Green-Rollout lässt Anwendungsreplikate überlappen, doch Snapshots, Entleerungsphasen und der Austausch zustandsbehafteter Dienste können Arbeit unterbrechen.

Verwaltete Bereitstellungen verwenden feste Quellrevisionen und vorbereitete Bundles statt dieses Workspace-Ablaufs. Folge dafür [Verwaltete Bereitstellungen](/de/self-hosted/install/cli-install#managed-deployments). Wenn sich nur Client-Inhalte ändern, nutze [Konfigurations-Releases](/de/self-hosted/configuration/config-releases).

## Upgrade vorbereiten

1. Führe `tale status` im vorgesehenen Workspace aus. Halte laufende Version, Workspace-Version und aktuellen Bereitstellungszustand fest.
2. Lies die Release Notes der Zielversion zu Kompatibilität, erforderlicher Konfiguration und bekannten Einschränkungen. Für Instanzen vor 0.5 gilt der getrennte Umstieg weiter unten, und ein Workspace mit v0.5.77 oder älter durchläuft einmal die Umstellung des Automatisierungs-Schreibprotokolls, die ebenfalls weiter unten beschrieben ist.
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
| `platform`, dazu `backend-api` und `backend-worker`, wo sie getrennt laufen | Gemeinsam als neue Anwendungsfarbe ausrollen. | Alte und neue Replikate überlappen; das Entleeren kann neue Turns verweigern. |
| `sandbox`, `sandbox-egress` | Nach dem Entleeren betroffener Arbeit an Ort und Stelle ersetzen. | Es sind gemeinsame Ausführungsdienste, keine zweite Blue-Green-Anwendungsgruppe. |
| `db`, `object-store`, `proxy` | Laufende Dienste behalten; die CLI meldet ausgelassene Updates. | Verwende `--stop`, wenn diese Dienste ersetzt werden müssen. |

```bash
tale deploy --stop
```

Bei einer Instanz, die vor diesem Release installiert wurde, zieht dieser Deploy auch die Dateien von MinIO zu versitygw um, wie unter [Dateien ziehen von MinIO zu versitygw um](#blob-store) beschrieben.

`TALE_PLATFORM_REPLICAS` legt fest, wie viele `platform`-Replikate eine Farbe ausführt, von 1 bis 16; jedes ist die ganze Anwendung. Setzt du `TALE_BACKEND_WORKER_REPLICAS` oder `TALE_BACKEND_API_REPLICAS`, [laufen die Worker getrennt](#one-process) und lassen sich für sich skalieren. Erhöhe, wo du einen Engpass gemessen hast. Mehr Worker beheben weder einen Datenbankausfall noch ein ausgeschöpftes Anbieterlimit.

## Die Übergabe verstehen

Die CLI startet die freie Farbe und wartet auf erfolgreiche Zustandsprüfungen ihrer Replikate, bevor sie die Übergabe abschließt. Während der Überlappung können beide Versionen Anfragen bedienen. Releases müssen daher während der Migration mit der vorherigen Anwendungsversion zusammenarbeiten können.

Vor dem Entfernen wird die alte API geleert: Neue Chat-Turns können eine Drain-Verweigerung erhalten, während laufende Turns Zeit zum Abschluss bekommen. Die Chat-Phase wartet bis zu drei Minuten; die Web-Phase nutzt `DRAIN_TIMEOUT`, standardmäßig 30 Sekunden. Die Web-Zustandsroute bleibt gesund, solange ihr Alias gemeinsam verwendet wird. Das Trennen der alten Container von den bedienenden Netzwerken entfernt sie aus DNS und kann übrige Verbindungen kappen. Deshalb erfolgt es nach den Entleerungsphasen.

Das Leeren umfasst auch Automatisierungen. Worker der alten Farbe starten keinen neuen Job und geben jeden Automatisierungslauf beim nächsten Schritt weiter, sodass er auf der neuen Farbe weiterläuft; die CLI wartet innerhalb derselben drei Minuten auch auf diese Schritte. Wenn die alten Container anhalten, hat jeder Worker 120 Sekunden, um weiterzugeben, was er noch hält (mehr, wenn du `SHUTDOWN_DRAIN_MS` erhöhst: Die CLI hält diese Frist 15 Sekunden darüber), und ein Schritt, der 20 Sekunden nach Beginn des Anhaltens noch arbeitet, wird unterbrochen und läuft auf der neuen Farbe noch einmal. Ausgenommen ist ein Schritt, der gerade etwas an einen externen Dienst gesendet hat, denn der Dienst hat es vielleicht schon erhalten: Dieser Lauf wartet, bis eine Person entscheidet, wie es weitergeht, wie [Automatisierungsläufe prüfen und Fehler beheben](/de/platform/automations/execution-logs) es beschreibt. Das erste Update auf Automatisierungs-Schreibprotokoll 2 läuft anders ab: Die Migration hält alle älteren Läufe in der Warteschlange, in Ausführung oder im Wartezustand an und bewahrt ihren vorherigen Zustand sowie ungeklärte externe Auswirkungen. Sie laufen nicht automatisch weiter. Bereits zugelassene oder gesendete Arbeit eines alten Workers kann noch abgeschlossen werden. Eine ausdrückliche Stoppanforderung hält fest, wer sie gestellt hat, und fordert den Abbruch der zugehörigen Sitzung an; sie belegt weder deren Ende noch das Ergebnis eines externen Schreibvorgangs. Sie gibt die gehaltene Aufgabe und ihre Nachweise nicht frei. Prüfe das tatsächliche Ergebnis, bevor du Ersatzarbeit planst.

Beide Farben verwenden das Volume `static-assets` der Bereitstellung. Bevor eine Web-Replik bereit ist, legt sie dort die unveränderlichen Skripte, Stylesheets, Schriftarten und Bilder ihres Builds ab. So kann jede Farbe die Dateien liefern, auf die das HTML der anderen Farbe verweist. Laufende Repliken frischen ihre Dateien stündlich auf; ausgemusterte Dateien bleiben danach noch sieben Tage verfügbar. Binde dieses gemeinsame Volume auch in deinem eigenen Compose-Aufbau auf jeder Web-Replik ein. Beim ersten Upgrade von einer Version ohne diese Unterstützung fehlt den alten Repliken diese gemeinsame Rückfallmöglichkeit noch.

Ein offener Tab arbeitet bei der Übergabe normalerweise weiter. Ist ein benötigter Teil nicht mehr verfügbar, wartet Tale, bis API und Datenbank antworten, und lädt dann einmal neu. Lässt sich der Teil weiterhin nicht laden, zeigt Tale **Eine neue Version ist verfügbar** mit der Aktion **Neu laden**, statt erneut automatisch zu laden. Während eines Ausfalls bleibt der Verbindungshinweis sichtbar. Fehlgeschlagene Leseanfragen werden nach der Wiederverbindung aktualisiert; fehlgeschlagene Schreibanfragen werden nicht automatisch erneut gesendet.

Wird die neue Gruppe nicht innerhalb von `HEALTH_CHECK_TIMEOUT` gesund, schließt die CLI den Wechsel nicht ab. Prüfe gespeicherten Bereitstellungszustand und Protokolle vor einem erneuten Versuch. Ein unterbrochener Rollout kann beide Gruppen oder eine ausstehende Übergabe hinterlassen. Folge den Wiederherstellungshinweisen der CLI, statt Container oder Zustandsdateien von Hand zu löschen.

## Einen Workspace auf Incus aktualisieren {#incus}

Ein Workspace auf der experimentellen [Incus-Laufzeit](/de/self-hosted/install/incus) wird mit denselben Befehlen `tale update` und `tale deploy` aktualisiert. Anders ist, wie die CLI den Stack ändert und den Verkehr von einer Farbe an die andere übergibt. Eine verwaltete Bereitstellung auf Incus hat keine Farben, ersetzt jeden Dienst an Ort und Stelle, und ihr Upgrade wird vorerst abgelehnt; siehe [die aktuellen Grenzen](/de/self-hosted/install/incus#limits).

### Zuerst den Plan prüfen {#incus-plan}

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
```

`--plan-only` gibt einen Plan je Bereich aus, für die Volumes, die Infrastruktur, die zustandsbehafteten Dienste und die Farbe, die es startet, und ändert nichts. `--plan` wendet den geprüften Plan nur an, solange der Knoten noch genau ihn braucht, und prüft jeden Bereich, bevor es etwas ändert. Vor jeder Änderung prüft `tale deploy` den Knoten gegen den Vertrag des Stacks; nach dem Erhöhen einer Replikatzahl führst du `tale incus bootstrap` erneut aus, damit die Limits des Projekts passen. Der Snapshot vor einem Versionswechsel ist ein nativer Satz, aufgenommen unter einem Einfrieren von deutlich unter einer Sekunde, wie unter [Snapshots auf Incus](/de/self-hosted/operate/backups-and-restore#incus) beschrieben.

### Die stoppgebundenen Dienste ersetzen {#incus-stop-gated}

Auf Incus ist die stoppgebundene Stufe größer: Neben `db`, `object-store` und `proxy` behalten auch die Resolver (`names`, `names-sessions`) und der Traffic-Switch ihr laufendes Image, bis eine Bereitstellung mit `--stop` kommt, und die CLI meldet, was sie stehen gelassen hat. Das Ersetzen des Switch oder des Proxys unterbricht allen Verkehr, bis die neue Instanz gesund ist; plane für `tale deploy --stop` also ein kurzes Fenster ein.

### Dem Farbwechsel folgen {#incus-flip}

Der Traffic-Switch ist eine Instanz des Proxy-Images, die vor den Replikaten von `platform` und `backend-api` steht, auch vor dem Modell-Relay, das die Replikate von `backend-api` auf Port 8080 bereitstellen. Er kennt von Anfang an jede Replikat-Adresse beider Farben und wird während eines Farbwechsels, eines rollierenden Ersetzens oder eines Rollbacks nie neu geladen. Jedes Replikat der neuen Farbe bekommt Verkehr, sobald es die Zulassungsprobe des Switch besteht, die ein Replikat erst beantwortet, wenn es bereit ist, und die CLI wartet, bis jedes Replikat gesund ist.

Dann zieht die CLI die alte Farbe zurück: Sie markiert jedes alte Replikat so, dass seine Zulassungsprobe fehlschlägt, und innerhalb von Sekunden schickt der Switch ihm keine neue Anfrage mehr. `/api/health` des Replikats behält seine Bedeutung und schlägt erst nach seinem Stoppsignal fehl, sodass die eigene Zustandsprüfung des Edge nicht gestört wird. Offene Streams, etwa die Live-Aktualisierungen einer Seite, bleiben auf der alten Farbe offen. Dann laufen die Leerungsphasen wie oben beschrieben, jedes alte Replikat stoppt innerhalb seiner Schonfrist und wird gelöscht, und seine Streams enden dort: Die Clients verbinden sich mit der neuen Farbe neu. Unter Docker ist die Reihenfolge anders, weil die alten Container die bedienenden Netzwerke erst nach den Leerungsphasen verlassen.

Bricht eine Bereitstellung mitten im Farbwechsel ab, macht das nächste `tale deploy` an der festgehaltenen Phase weiter, und `tale status` meldet bis dahin den unvollendeten Wechsel; lösche keine Instanzen von Hand. `--services` ersetzt stattdessen die Replikate der aktiven Farbe nacheinander: Jedes wird zurückgezogen, geleert, ersetzt und ist gesund, bevor das nächste dran ist. `tale rollback` geht dieselben Schritte zur vorherigen Version.

### Die Umgebung stoppen und starten {#incus-stop-start}

```bash
tale stop
tale start
```

`tale stop` stoppt die Umgebung in drei Gruppen: den Edge, den Switch und beide Farben; dann die Sandbox-Dienste; dann die Datenbanken, den Objektspeicher und die Resolver. Jeder Dienst bekommt seine eigene Schonfrist. `tale start` startet die Gruppen in umgekehrter Reihenfolge, jede gesund vor der nächsten, startet auch einen Dienst, den Incus nach wiederholten Abstürzen gestoppt hat, und lehnt ab, solange eine Wiederherstellung aussteht. `--dry-run` gibt die Reihenfolge aus und ändert nichts. Auf einem Host, der neben Tale andere Projekte betreibt, führst du `tale stop` aus, bevor der Host herunterfährt: Incus stoppt sonst die Gruppen aller Projekte nacheinander, jede bis zu 30 Sekunden lang, und die Datenbanken können vor ihrem Stoppsignal abgeschnitten werden, wie [Das Herunterfahren des Hosts einplanen](/de/self-hosted/install/incus#host-shutdown) erklärt.

## Migrationen und Nutzerergebnis prüfen

Beim Start wendet das Backend seine nummerierten Migrationen in der Reihenfolge ihrer Dateinamen unter einem sitzungsgebundenen Advisory Lock an. SQL-Migrationen ändern das Schema, TypeScript-Datenmigrationen aktualisieren bestehende Zeilen nach den Regeln der Anwendung. Die Tabelle `app_migrations` verzeichnet beide Arten mit ihrem Dateinamen, sodass jede Migration pro Datenbank nur einmal läuft. Andere Replikate warten darauf. Ein Migrationsfehler verhindert den regulären Start des neuen Backends. Prüfe Fehler und Datenbank vor einem neuen Versuch. Vorwärtsgerichtete Migrationen werden durch einen anderen Image-Tag nicht rückgängig gemacht.

`tale migrate` ergänzt die mitgelieferten Konfigurationsdateien, die einer Organisation fehlen, und legt in einer Organisation ohne Projekt das Einstiegsprojekt an. Der Befehl fügt keine Automatisierung hinzu und rollt keine Datenbankmigration zurück. Prüfe vor einer Überschreibung der Host-Konfiguration, ob lokale Anpassungen tatsächlich ersetzt werden sollen.

Prüfe nach der Bereitstellung öffentliches Zertifikat und Anmeldung, öffne ein vorhandenes Projekt oder einen Chat und lade eine bekannte Datei herunter. Teste kontrolliert die genutzten Wissens- und Automatisierungsfunktionen. Kontrolliere Worker-Fortschritt, Speicherzustand und die tatsächlich laufende Version. Bewahre die Sicherung von vor dem Upgrade bis zur Abnahme auf.

## Rollback-Weg wählen

| Situation | Wiederherstellung |
| --- | --- |
| Zur gespeicherten vorherigen Version derselben `major.minor`-Linie zurückkehren | `tale rollback` prüft diese Grenze und fragt vor der erneuten Bereitstellung nach Bestätigung. Lies zusätzlich die Kompatibilitätshinweise des Releases. |
| Über eine Minor- oder Major-Grenze zurückkehren | Stelle den abgestimmten Datenstand vor dem Upgrade und dessen passende Version wieder her. `tale rollback` verweigert dieses reine Image-Downgrade. Ein Workspace, der die Anwendung als einen Prozess ausführt, [holt zuerst seine drei Dienste zurück](#one-process). |
| Zielversion oder Datenkompatibilität unbekannt | Kläre Version und Herkunft der Sicherung vor dem Start eines älteren Programms. |

```bash
tale rollback
```

`--yes` überspringt die Bestätigung für einen bereits genehmigten unbeaufsichtigten Lauf. Die Prüfung derselben Versionslinie ist eine Schranke, kein eigenständiger Nachweis der Kompatibilität aller externen Integrationen und lokalen Anpassungen. Eine ältere Migrationsliste als Präfix der neuen macht ein Downgrade allein nicht sicher.

`tale rollback` tauscht nur die Images der Anwendung aus: die von `platform` und, wo sie getrennt laufen, die von `backend-api` und `backend-worker`. Es stellt kein Volume wieder her, lässt Datenbank, Speicher, Proxy und Sandbox-Dienste, wie sie sind, und startet das Modell-Gateway nie wieder, wie [Das Modell-Relay löst das Modell-Gateway ab](#model-relay) erklärt. Auch sonst stellt kein Bereitstellungsschritt von selbst Daten wieder her: Scheitert ein gewöhnlicher Deploy (ohne `--services`) an seinen Zustandsprüfungen, bleibt die bisherige Anwendungsfarbe in Betrieb, doch was er bereits an Ort und Stelle ersetzt hat, bleibt ersetzt. Nur `tale restore` spielt die Volumes eines Snapshots zurück.

## Das Modell-Relay löst das Modell-Gateway ab {#model-relay}

Bis zu diesem Release stand ein eigener Dienst, `sandbox-llm-gateway`, zwischen einem Coding-Agenten in einer Sandbox und dem Modellanbieter und bediente die [Modell-Endpunkte für API-Schlüssel](/de/platform/admin/governance/content-models#model-endpoints). Diese Aufgabe übernimmt jetzt das Backend selbst, in seinem [Modell-Relay](/de/self-hosted/configuration/environment-reference#model-relay). Jeder Modellaufruf eines Agent-Turns und jeder Aufruf der Modell-Endpunkte läuft über das Relay, und das Relay ruft jeden Anbieter mit den Zugangsdaten der Organisation an dem Endpunkt auf, den die Definition des Anbieters nennt. Es läuft in dem Prozess, der die API bedient; eine Bereitstellung betreibt deshalb einen Container weniger, und das Speicherlimit des Gateways, zwischen 512 MiB und mehreren GiB, entfällt.

Ist **Prompts nur in der EU/im EWR verarbeiten** eingeschaltet, wird das Modell eines Coding-Agenten oder eines Modell-Endpunkts jetzt wie im Chat an dem Endpunkt beurteilt, den das Relay aufruft. Ein Anbieter aus dem Katalog wie OpenRouter mit dem Endpunkt `eu.openrouter.ai` wird jetzt zugelassen, wo das Gateway ihn abgelehnt hat; was zählt, steht unter [Prompts nur in der EU/im EWR verarbeiten](/de/platform/admin/governance/content-models#eu-processing).

Eine neue Bereitstellung betreibt kein Gateway, und `tale init` und `tale deploy` erzeugen `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD` nicht mehr. Eine Bereitstellung, die ein Gateway betreibt, behält es, solange Schlüssel, die das Gateway ausgegeben hat, noch offen sind: die Schlüssel von Agent-Turns, die vor dem Upgrade begonnen haben und noch nicht abgerechnet sind. Das Backend liest die Ausgaben dieser Turns beim Gateway und widerruft ihre Schlüssel mit dem Admin-Passwort. Lass das Passwort deshalb unverändert in der `.env`, solange das Gateway bleibt. Fehlt es unter Docker in der `.env`, schreibt `tale deploy` es aus der Umgebung des Gateways zurück, bevor es die neue Farbe startet, und sagt das. Hat auch das Gateway keines, nennt der Deploy, was fehlt: Setze das Passwort in der `.env` auf das, mit dem das Gateway bereitgestellt wurde, und starte den Deploy erneut. Ist es verloren, entferne den Container `<id>-sandbox-llm-gateway` selbst. Der nächste Deploy sagt dem Backend dann, dass das Gateway entfernt ist, und die Schlüssel, die es ausgegeben hat, werden ohne ihre Ausgaben abgeschlossen. Unter Docker fragt jedes `tale deploy` außerdem das laufende Backend, wie viele solche Schlüssel offen sind. `<id>` ist die `id` in `tale.json`:

- **Keiner:** Der Deploy entfernt den Container `<id>-sandbox-llm-gateway`, nie sein Volume, und gibt aus, wie du das Volume entfernst.
- **Einige:** Der Deploy lässt den Container, wie er ist, und sagt, wie viele Schlüssel des Gateways noch offen sind: die von Turns, die vor dem Upgrade begonnen haben, von Sessions, die noch laufen, und von einer Organisation, die gerade gelöscht wird. Ein späteres `tale deploy` fragt erneut.
- **Keine Antwort:** Der Deploy behält den Container und nennt den Grund. Beim ersten Deploy dieses Release gehört das Backend, das er fragt, noch zum früheren Release und kann nicht antworten. Das nächste `tale deploy` fragt erneut.

Sobald der Container weg ist, starten `tale deploy` und `tale rollback` das Backend mit leerem `SANDBOX_LLM_GATEWAY_URL`. Das sagt ihm, dass das Gateway entfernt ist: Es fragt beim Gateway nichts mehr an, auch auf einem Host, der keinen DNS-Server erreicht.

`tale deploy --dry-run` stellt dieselbe Frage und sagt, was der Deploy davon tun würde.

Das Volume `<id>_llm-gateway-data` bleibt, wenn der Container geht. Es enthält die Schlüssel der Anbieter, die das Gateway erreicht hat, in der SQLite-Datenbank des Gateways, und die Ausgaben der Schlüssel, die es ausgegeben hat. Entferne es, sobald kein Turn es mehr braucht, mit dem Befehl, den der Deploy ausgegeben hat:

```bash
docker volume rm <id>_llm-gateway-data
```

Die anderen Befehle gehen so mit dem Gateway und seinem Volume um:

- Snapshots ab diesem Release archivieren das Volume nicht mehr. Ein älterer Snapshot, der es enthält, stellt es beim Wiederherstellen weiterhin wieder her.
- `tale reset --all` entfernt den Container eines behaltenen Gateways und sein Volume mit den anderen Daten-Volumes, nie das Volume `backups`.
- `tale restore` stoppt ein behaltenes Gateway, das läuft, wie die anderen zustandsbehafteten Container.
- `tale runtime migrate --finish` entfernt das Volume mit den anderen Docker-Daten-Volumes: Der Incus-Stack braucht es nicht.
- `tale rollback` startet das Gateway nie wieder. Ein Release aus der Zeit vor dem Relay führt Agent-Turns und die Modell-Endpunkte über das Gateway aus. Nach einem Rollback auf ein solches Release funktionieren sie deshalb nur, solange der Container des Gateways noch läuft. `tale deploy` entfernt den Container nur, während ein Release mit dem Relay läuft, und `tale rollback` kehrt zu dem Release zurück, das vor dem letzten Deploy lief. Ein Rollback nach dem Entfernen landet also bei einem Release mit dem Relay.

Mit eigenen Compose-Dateien oder auf Kubernetes fragt niemand das Backend für dich. Sitzungen erreichen das Relay auf dem Port 8080 der Backend-API: Unter Kubernetes muss der Service `backend-api` ihn bereitstellen und Session-Pods müssen ihn erreichen dürfen, wie [Auf Kubernetes bereitstellen](/de/self-hosted/install/kubernetes) zeigt, und `kubectl apply` lässt Deployment, Services und Claim des Gateways stehen. Entferne den Dienst des Gateways, sobald kein Schlüssel, den es ausgegeben hat, mehr offen ist, und sein Volume oder seinen Claim, sobald kein Turn es mehr braucht. Setze danach `SANDBOX_LLM_GATEWAY_URL` im Backend leer: Auf einem Host, dessen Container keinen DNS-Server erreichen, hielte das Backend das entfernte Gateway sonst für eines, das nur vorübergehend nicht erreichbar ist, und das Löschen einer Organisation würde darauf warten. Ist [`TALE_CONTROL_TOKEN`](/de/self-hosted/configuration/environment-reference) im Backend gesetzt, frag es so, wie `tale deploy` es tut. Es antwortet `{"open":0}`, sobald keiner mehr offen ist:

```bash
docker compose exec backend-api sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
kubectl -n tale exec deploy/backend-api -- sh -c 'curl -fsS -H "Authorization: Bearer $TALE_CONTROL_TOKEN" http://localhost:3005/api/control/gateway-keys'
```

## Die Anwendung als ein Prozess {#one-process}

Ein Workspace führt die Anwendung als einen `platform`-Prozess pro Replikat aus: Web-Ebene, API und Worker. Frühere Versionen führten sie als drei Dienste aus, `platform`, `backend-api` und `backend-worker`, und ihre Images tun das weiterhin.

Das erste `tale deploy` einer Version, die als ein Prozess laufen kann, startet die neue Farbe so neben der alten Farbe aus drei Diensten und entfernt die alte nach der Übergabe, wie bei jeder anderen Bereitstellung. `tale deploy --dry-run` nennt die Dienste, die die neue Farbe ausführen würde. Danach gilt:

- Es gibt keinen `backend-api`- und keinen `backend-worker`-Container mehr. `tale logs backend-api` und `tale logs backend-worker` lesen stattdessen das Log von `platform`. Passe an, was du selbst pflegst und was diese Container beim Namen nennt, etwa einen Log-Versand oder eine Alarmregel.
- Andere Dienste erreichen die API weiterhin unter dem Namen `backend-api`, unter dem jetzt auch `platform` antwortet.
- `PLATFORM_MEMORY_RESERVATION` bemisst den einen Prozess und beträgt für ihn standardmäßig `256m`, höchstens sein Speicherlimit von `12g`. `BACKEND_API_MEMORY_RESERVATION` und `BACKEND_WORKER_MEMORY_RESERVATION` gelten nur für diese Dienste, wo es sie gibt.
- `tale deploy --services platform` ersetzt die ganze Anwendung an Ort und Stelle und leert deshalb zuerst die API, damit laufende Chat-Turns zu Ende kommen. Nennst du einen Dienst, den die laufende Farbe nicht ausführt, lehnt die CLI ab und nennt die Dienste, die sie ausführt.

Um die Worker für sich zu skalieren, setze `TALE_BACKEND_WORKER_REPLICAS`, `TALE_BACKEND_API_REPLICAS` oder beide auf einen Wert von 1 bis 16 und stelle bereit. Die neue Farbe führt dann `backend-worker` mit seiner Anzahl neben einem `platform` aus, das Web-Ebene und API ist und so viele Replikate hat wie der größere der Werte `TALE_PLATFORM_REPLICAS` und `TALE_BACKEND_API_REPLICAS`. Entferne beide Variablen, und die nächste Bereitstellung kehrt zu einem Prozess zurück.

`TALE_APP_TIER` legt die Form ausdrücklich fest und hat Vorrang vor den Replikatzahlen: `one-process`, `workers-apart` oder `three-services`. Mit `three-services` führt auch eine Version, die als ein Prozess laufen kann, `platform` nur als Web-Ebene aus, neben `backend-api` und `backend-worker`.

Eine CLI aus der Zeit vor dieser Änderung stellt nur über drei Diensten bereit. Sie sucht die Container `backend-api` und `backend-worker`, und ohne sie verweigert sie Bereitstellung und Rollback, ohne etwas zu ändern: mit `The installed backend database connection is unknown` über einem Prozess und mit `The installed backend database inventory is incomplete`, wo nur die Worker getrennt laufen. Bevor du zu einer solchen CLI zurückkehrst, etwa um einen Snapshot einer früheren Versionslinie wiederherzustellen, setze `TALE_APP_TIER=three-services` und führe `tale deploy` mit der aktuellen CLI aus. Dann führt der Workspace die Dienste aus, die die ältere CLI kennt. Tu das vor der Wiederherstellung: Danach gehören die Daten zur früheren Version, und nur deren CLI darf sie starten. `tale restore` prüft das selbst, wo das Image der früheren Version noch auf dem Host liegt, und lehnt ab, bevor es etwas ändert. Entferne die Variable, sobald du wieder auf einer Version bist, die als ein Prozess läuft. `tale rollback` braucht diesen Schritt nicht: Die aktuelle CLI startet die drei Dienste der früheren Version selbst.

Jede Farbe führt die Dienste aus, die ihr eigenes Image unterstützt. `tale rollback` auf eine Version vor dieser Änderung bringt daher ihre drei Dienste zurück. Die Compose-Datei im Repository, die [Kubernetes-Manifeste](/de/self-hosted/install/kubernetes) und die [Incus-Laufzeit](/de/self-hosted/install/incus) bleiben bei den drei Diensten.

## Eine Datenbank für einen kleinen Host {#database-profile}

`tale deploy` startet die mitgelieferte Datenbank mit dem Profil `small`: 32 MB Shared Buffers statt 256 MB, 4 MB für eine Sortierung statt 32 MB, 40 Verbindungen statt 100, ein Autovacuum-Worker und keine parallelen Abfragen. Damit belegt die Datenbank unter derselben Last weniger als die Hälfte des bisherigen Speichers, was eine Instanz auf einem Host mit einem halben Gigabyte braucht. Die Anwendung öffnet passend dazu weniger Verbindungen, [höchstens 15 aus ihrem einen Prozess](/de/self-hosted/configuration/environment-reference#database).

Eine laufende Datenbank behält bei `tale deploy` ihre Größen, denn der Deploy lässt sie weiterlaufen. Diese Größen übernimmt sie, sobald sie neu erstellt wird: mit `tale deploy --services db` oder `tale deploy --stop`, was die Anwendung kurz unterbricht. Auf der Platte ändert sich nichts, und die Suche arbeitet wie zuvor: Was nicht in die Shared Buffers passt, liest PostgreSQL über den Seitencache des Hosts.

Hat dein Host Speicher übrig und eine große Wissensdatenbank, bist du mit den bisherigen Größen besser bedient. Setz dafür vor dem Deploy in der `.env` des Workspace:

```dotenv
DB_PROFILE=standard
```

Um nur eine Größe zu ändern, nenn stattdessen diese, etwa `DB_SHARED_BUFFERS=1GB`. Eine Größe, die du nennst, geht dem Profil vor.

## Der Token-Anbieter für YouTube-Links ist standardmäßig aus {#token-provider}

Frühere Versionen haben `bgutil-provider` mit jeder Instanz gestartet. `tale deploy` startet ihn jetzt nur, wo die `.env` des Workspace `VIDEO_INGEST_POT_PROVIDER=true` setzt, und der erste Deploy dieser Version entfernt sonst den laufenden.

YouTube-Links funktionieren weiter von einer Adresse, die YouTube nicht auf die Probe stellt. Von einer anderen scheitert ein Link und nennt den Anbieter. Fügen deine Mitglieder YouTube-Links ein und steht dein Host in einem Rechenzentrum, [aktiviere den Anbieter](/de/self-hosted/configuration/video-ingestion#token-provider) vor dem Upgrade.

## Dateien werden innerhalb eines Speicherlimits gelesen {#file-memory-limit}

Ein Replikat liest jede Datei jetzt in einem eigenen Prozess, eine Datei nach der anderen, und bricht ab, sobald eine Datei mehr Arbeitsspeicher braucht, als das Limit erlaubt. Bisher wurde eine große Tabelle oder ein großes PDF im Prozess der Anwendung gelesen, der dabei um mehrere Hundert Megabyte wachsen konnte.

Das Limit beträgt 512 MiB, und 96 MiB, wo `tale deploy` die Anwendung als einen Prozess ausführt, was eine Instanz auf einem Host mit einem halben Gigabyte braucht. Unter 96 MiB passt weiterhin eine Tabelle mit 100.000 Zeilen und 10 Spalten, ebenso etwa 20 MB reiner Text. Eine Datei, die mehr braucht, zeigt **Fehlgeschlagen** mit einer Erklärung, die das Limit nennt. Sind deine Dokumente größer und hat dein Host Speicher übrig, setz vor dem Deploy in der `.env` des Workspace:

```dotenv
HEAVY_SLOT_MEMORY_MB=512
```

Wähle danach bei einem fehlgeschlagenen Dokument **Indexierung erneut versuchen**. [Arbeitsspeicher zum Lesen von Dateien](/de/self-hosted/configuration/environment-reference#file-memory) nennt, was passt und wie ein Replikat mehrere Dateien gleichzeitig liest.

## Videolinks werden in einer Sandbox-Sitzung abgerufen {#video-sandbox}

Bis zu diesem Release hat das Backend `yt-dlp` neben sich selbst gestartet, um einen Videolink zu lesen. Jetzt führt es `yt-dlp` in einer eigenen Sandbox-Sitzung des Links aus. Was ein Mitglied einfügt, wird so nach den Regeln der Sandbox abgerufen und vom Sandbox-Host zugelassen, nicht in der Anwendung.

Prüfe vor dem Upgrade vier Dinge:

- **Sandbox-Ziele.** Die Anfragen eines Links verlassen die Instanz jetzt über den Egress-Proxy der Sandbox. Ist `SANDBOX_EGRESS_ALLOWLIST` gesetzt, ergänze die Videoplattformen, die deine Mitglieder nutzen, und die Hosts, von denen diese Plattformen Medien ausliefern. Das Backend selbst verbindet sich nicht mehr mit einer Videoplattform, nur noch mit einem Proxy, den du für Videos konfiguriert hast.
- **Render-Sitzungen.** Jeder Link in Arbeit belegt eine der **Render-Sitzungen** der Organisation, die auch Website-Scans nutzen. Der Standard ist 2. Findet ein Link keine freie, wartet er; bleiben Links **In Warteschlange**, während Websites gescannt werden, erhöhe das Limit unter **Einstellungen > Sandboxes**.
- **Entwicklungseinstellungen.** `VIDEO_INGEST_BIN_DIR`, `VIDEO_INGEST_FFMPEG_LOCATION` und `VIDEO_INGEST_YTDLP_PLUGIN_DIRS` nennen Werkzeuge auf dem Rechner des Backends. Die Sitzung eines Deployments nutzt die Werkzeuge ihres Images und ignoriert sie.
- **Images, die du selbst baust oder festlegst.** Das Anwendungs-Image enthält kein `yt-dlp` mehr; das Sandbox-Runtime-Image enthält es. Betreibe das Sandbox-Runtime-Image dieses Release: Mit einem älteren scheitert jeder Link mit „Video-Verarbeitung noch nicht aktiviert — Administrator kontaktieren“.

Das Audio eines Videos ohne Untertitel wird jetzt so gespeichert, wie die Plattform es ausliefert, meist als WebM- oder M4A-Datei; bisher wurde es in MP3 umgewandelt. Transkripte ändern sich nicht. [Videotranskripte importieren](/de/self-hosted/configuration/video-ingestion#where-retrieval-runs) beschreibt, wo ein Link abgerufen wird und welche Grenzen gelten.

## Dateien ziehen von MinIO zu versitygw um {#blob-store}

Eine neue Instanz legt ihre Dateien in versitygw ab, einem S3-Server, der jedes Objekt als eigene Datei im Volume `blob-data` speichert. versitygw braucht einen Bruchteil des Arbeitsspeichers von MinIO und hat ein Image für ARM64. Eine früher installierte Instanz hält ihre Dateien in `object-store-data`, in einem MinIO-eigenen Format, das versitygw nicht lesen kann. `tale deploy` behält dort deshalb MinIO bei und meldet das:

```text
The blob store stays MinIO: this deployment's blobs are in <id>_object-store-data, in MinIO's format. A new install runs versitygw. `tale deploy --stop` moves the blobs to versitygw, pausing the application for the last copy.
```

Ein Deploy, der den Objektspeicher ersetzt, zieht die Dateien um: `tale deploy --stop`, `tale deploy --services object-store` oder jeder Deploy, der den Objektspeicher gestoppt vorfindet. Mit `--dry-run` nennt er den Umzug, ohne ihn auszuführen. Bevor die CLI etwas kopiert, prüft sie drei Dinge; schlägt eine dieser Prüfungen fehl, behält sie MinIO:

- `OBJECT_STORE_SECRET_KEY` ist in der `.env` des Workspace gesetzt.
- Das Dateisystem, auf dem `blob-data` liegt, meist das unter `/var/lib/docker`, hat Platz für das Volume von MinIO, ein Zehntel mehr und zusätzlich 1 GiB. Beide Volumes bleiben darauf, bis du das von MinIO entfernst.
- Ein Objekt, das versitygw dort schreibt, kommt mit seinem Inhaltstyp und ETag zurück. versitygw legt beide in erweiterten Attributen ab, die ext4, XFS und Btrfs unterstützen. Auf einem Dateisystem ohne sie käme jede Datei ohne ihren Typ zurück.

Danach kopiert die CLI jeden Bucket, während die Anwendung weiterarbeitet. Anschließend pausiert sie die Anwendung für eine letzte Kopie dessen, was seit Beginn der ersten Kopie geschrieben wurde; dabei entfernt sie auch, was inzwischen gelöscht wurde. Sie vergleicht Buckets, Objekte und Bytes auf beiden Seiten, startet versitygw als Objektspeicher und lässt die Anwendung weiterlaufen. Während der Pause warten Anfragen, plane deshalb ein kurzes Wartungsfenster ein. Die Pause wächst mit dem, was sich während der ersten Kopie ändert, und mit der Zahl der Dateien, die der Vergleich auf beiden Seiten auflistet.

Gelingt der Umzug, meldet der Deploy, was er umgezogen hat, und lässt das Volume von MinIO, wie es war:

```text
Moved <n> object(s), <size>, to versitygw on <id>_blob-data. <id>_object-store-data is left as it was: remove it once you no longer need it (docker volume rm <id>_object-store-data).
```

Scheitert eine Prüfung oder ein Schritt, liefert MinIO die Dateien wie bisher aus. Die CLI entfernt, was der Umzug in `blob-data` geschrieben hat, nennt den Grund und setzt den Deploy mit MinIO fort:

```text
The blobs stay in MinIO (<id>_object-store-data), which serves them as before: <reason>.
```

Behebe den Grund und führe `tale deploy --stop` erneut aus. Nach einem gelungenen Umzug:

1. Lade einige bekannte Dateien herunter und öffne sie.
2. Erstelle mit `tale backup` einen Snapshot. Er archiviert `blob-data` samt seinen erweiterten Attributen.
3. Entferne das Volume von MinIO, sobald du es nicht mehr brauchst: `docker volume rm <id>_object-store-data`.

`tale rollback` behält versitygw bei. Bringe den Workspace nicht mit `tale update --version` auf ein früheres Release zurück: Die CLI eines solchen Release kennt nur MinIO. Sie würde MinIO auf seinem Volume im Stand vor dem Umzug starten, ohne die seither hochgeladenen Dateien, oder, wenn du dieses Volume schon entfernt hast, auf einem leeren. Um zu einem solchen Release zurückzukehren, stelle einen Snapshot aus der Zeit vor dem Umzug wieder her, wie unter [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) beschrieben.

`tale deploy` zieht die Dateien auf Docker um. Für einen Stack mit eigenen Compose-Dateien oder auf Kubernetes folge [Die Blobs von MinIO zu versitygw umziehen](/de/self-hosted/install/own-compose#blob-store).

## Pi ist die voreingestellte Agent-Laufzeit {#pi-default}

Agenten-Runden, die keine Agent-Laufzeit nennen, laufen jetzt auf Pi: der Agent-Schritt einer Automatisierung auf **Standard (Pi)** und der [Standard-Agent](/de/platform/admin/governance/content-models#standard-agent) der Organisation, solange seine **Agent-Laufzeit** auf **Automatisch** steht. Frühere Versionen ließen sie auf Claude Code laufen. An gespeicherten Einstellungen ändert sich nichts. Eine bestehende Organisation wechselt deshalb bei ihrem nächsten Lauf, und Agenten und Schritte, die eine Laufzeit nennen, behalten sie.

Ein Modell, das nur ein Abo bereitstellt, läuft weiter auf der Agent-Laufzeit, an die dieses Abo gebunden ist, etwa auf Claude Code bei einem Claude-Abo, statt abgelehnt zu werden. Ein Schritt, der beim Upgrade lief, beendet seine Runde dort, wo sie begann; wird er erneut versucht, beginnt der neue Versuch eine neue Konversation auf Pi im selben Arbeitsbereich. Solange während der Übergabe beide Farben laufen, kann ein Worker der früheren Version noch den neuen Versuch eines Schritts übernehmen, den diese Version auf Pi begonnen hat. Er übergibt die Konversation von Pi an Claude Code, das sie nicht fortsetzen kann, und dieser Versuch geht verloren. Das Agenten-Log jedes Laufs nennt, auf welcher Laufzeit eine Runde lief und warum.

Um bei Claude Code zu bleiben, nenne es dort, wo der Lauf seine Laufzeit bezieht:

- Beim Agent-Schritt einer Automatisierung wählst du im Feld **Agent-Laufzeit** **Claude Code** oder setzt `harness: claude-code` an der Node.
- Beim Standard-Agenten wählst du unter **Einstellungen > Richtlinien > Modelle** als **Agent-Laufzeit** **Claude Code** oder setzt `harness: claude-code` in seiner [Richtliniendatei](/de/self-hosted/configuration/providers#configure-the-standard-agent).

Projektagenten, die du angelegt hast, nennen ihre Laufzeit bereits und ändern sich nicht.

## Upgrade von v0.5.77 oder älter

Ab v0.5.78 schreiben Releases Automatisierungsläufe mit Schreibprotokoll 2. Ihre Migration `0163` setzt jeden Lauf, der noch in der Warteschlange steht, läuft oder wartet, auf **Zurückgehalten**, und ein zurückgehaltener Lauf läuft nie weiter. Das erste Upgrade von v0.5.77 hält deshalb das alte Backend an, sobald kein Lauf mehr offen ist, und startet erst dann die neue Version. `tale deploy` erledigt das selbst, einmalig.

1. Läuft der Workspace auf einem Release vor v0.5.77, bringe ihn zuerst auf v0.5.77. Die Umstellung beginnt nur bei diesem Release:

   ```bash
   tale update -v 0.5.77
   tale deploy
   ```

   Diese Schritte verwenden `-v`: CLIs aus der Zeit vor der Korrektur verstehen `tale update --version` als Frage nach ihrer eigenen Version und ändern nichts.

2. Lass jeden Automatisierungslauf in jeder Organisation zu Ende laufen oder brich ihn ab, und pausiere Zeitpläne und Auslöser, die neue Läufe starten würden, bis das Upgrade abgeschlossen ist.
3. Prüfe deine Sicherung außerhalb des Hosts, aktualisiere dann und sieh dir die Vorschau an. Sie nennt alles, was die Umstellung noch blockiert:

   ```bash
   tale update -v <target-version>
   tale deploy --dry-run
   ```

4. Stelle bereit, ohne `--stop` oder `--services`. Brauchen db, object-store oder proxy ein Update, führe danach `tale deploy --stop` aus:

   ```bash
   tale deploy
   ```

Bevor `tale deploy` etwas ändert, prüft es das Release des laufenden Backends, die Migrationshistorie der Datenbank und die Automatisierungsläufe. Ist etwas davon nicht bereit, hält es mit dem nächsten Schritt an und lässt den Workspace unverändert weiterlaufen. Andernfalls erstellt es wie gewohnt seinen Snapshot und ersetzt die Sandbox-Dienste. Unmittelbar bevor die neue Farbe startet, sperrt es neue Automatisierungsläufe, bestätigt, dass keiner mehr offen ist, hält die alten Container `backend-api` und `backend-worker` geordnet an und verzeichnet sie in `.tale/automation-cutover.json`. Ab diesem Anhalten ist die API nicht erreichbar, bis die neue Farbe gesund ist.

Der erste Start der neuen Farbe wendet jede Datenbankmigration seit v0.5.77 an, bevor er sich gesund meldet; bei einer großen Wissensdatenbank kann das Kopieren der Vektoren länger dauern als `HEALTH_CHECK_TIMEOUT`. Bricht das Deployment ab, nachdem das alte Backend angehalten wurde, führe `tale deploy` mit demselben Release erneut aus: Es erkennt seine eigene Übergabe, auch einen ersten Start, der mitten in seinen Migrationen abgebrochen wurde, wartet auf die bereits startende Farbe, statt sie neu zu erstellen, und schließt das Upgrade ab. Bewahre `.tale/automation-cutover.json` auf und starte die alten Container nicht von Hand. Sobald die Umstellung begonnen hat, lehnt `tale rollback` die Rückkehr zu v0.5.77 ab; repariere mit einer kompatiblen Version, wie der nächste Abschnitt beschreibt.

Ohne `tale deploy`, mit eigenen Compose-Dateien oder den [Kubernetes-Manifesten](/de/self-hosted/install/kubernetes), hält niemand diese Sperre für dich, und ein Rolling Update startet die neuen Backend-Container, während die alten noch laufen. Halte sie von Hand, in dieser Reihenfolge: Pausiere Zeitpläne und Auslöser und lass die Läufe zu Ende laufen; halte jedes `backend-api` und `backend-worker` von v0.5.77 an und stelle sicher, dass keines mehr läuft; prüfe, dass die Abfrage unten `0` liefert; und rolle erst dann die neue Version aus. Liefert sie mehr, starte das alte Backend wieder, lass diese Läufe zu Ende laufen und halte es erneut an. Mit Compose hält `docker compose stop backend-api backend-worker` beide an und kehrt zurück, sobald sie beendet sind.

```bash
kubectl -n tale scale --replicas=0 deployment/backend-api deployment/backend-worker
kubectl -n tale get pods -l 'app in (backend-api, backend-worker)'
psql "$DATABASE_URL" -Atc "select count(*) from app.automation_runs where status is null or status not in ('success', 'failed', 'cancelled')"
```

## Umstellung des Automatisierungsprotokolls: mit kompatibler Version reparieren

Sobald die Datenbank Automatisierungs-Schreibprotokoll 2 verzeichnet, brauchst du eine Runtime mit Protokoll 2 und die passende CLI. Bevor die CLI Deployment-Dateien, Infrastruktur oder Datenverkehr ändert, liest sie das installierte Migrationsverzeichnis und prüft Protokoll, Quellrevision und unveränderlichen Digest des ausgewählten Backend-Images. Ein älteres Image, fehlende oder nicht unterstützte Protokollmetadaten, ein unlesbares oder mehrdeutiges Verzeichnis oder eine geänderte Datenbankidentität stoppen Deployment und Rollback. Vor der Umschaltung muss eine ausstehende Farbe in jeder Backend-Rolle dasselbe zugelassene Image enthalten. Eine angehaltene Datenbank wird für diese Prüfung nicht automatisch gestartet.

Auch ein bereits erstelltes Protokoll-2-Backend verlangt ein kompatibles Ziel, selbst wenn es angehalten ist oder seine erste Migration noch nicht abgeschlossen hat. Die CLI liest das installierte Mindestprotokoll nach dem Image-Download und vor Deployment-Änderungen erneut. Eine parallel verwendete ältere CLI oder manuelle Docker-Befehle fallen nicht unter diese Koordination.

Die aktuelle Prüfung für tagbasierte Deployments unterstützt nur die mitgelieferte Anwendungsdatenbank. Ein ausdrücklich gesetztes `DATABASE_URL`, ein eigenes `APP_DB_NAME` oder ein installiertes Backend, das noch auf eine andere Datenbank zeigt, werden abgelehnt, bis ein gesondert verifizierter Leseweg vorliegt. Eine entfernte Überschreibung in `.env` belegt nicht, dass das laufende Backend seine Verbindung geändert hat. Lass die bestehende Runtime bestehen und repariere die Prüfung; umgehe die Ablehnung nicht mit einer älteren CLI.

Ältere CLIs und ein manueller Image-Austausch setzen diese Deployment-Prüfung nicht um. Die Schreibsperre der Datenbank und getrennte Ausführungswarteschlangen bleiben im Mischbetrieb notwendig. Ein Backup stellt gespeicherte Daten wieder her, aber keine bereits gesendeten Nachrichten, Zahlungen oder anderen Auswirkungen bei externen Diensten. Es erlaubt nach dieser Umstellung keine Runtime mit dem alten Protokoll. Repariere mit einer kompatiblen Version und bewahre gehaltene Läufe samt Nachweisen auf.

## Prüfe vor dem Upgrade den freien Sandbox-Speicherplatz

Der Docker-Spawner verweigert jetzt jede neue Session mit HTTP 429 `host_disk`, wenn der Datenträger mit den Arbeitsverzeichnissen der Sessions unter `SANDBOX_MIN_FREE_DISK` liegt. Das gilt auch für einen Host, der schon beim Upgrade unter diesem Wert liegt, und auch bei explizitem `SANDBOX_MAX_SESSIONS`. Bestehende Sessions laufen weiter, aber neue Arbeit wartet, bis Platz frei wird. Das Stoppen inaktiver Sessions gibt ihre erhaltenen Arbeitsverzeichnisse nicht frei.

Prüfe den freien Speicherplatz vor der Bereitstellung. Standardmäßig bleibt ein Zwanzigstel dieses Datenträgers frei, mindestens 2 GiB und höchstens 20 GiB. Gib Speicherplatz sicher frei oder konfiguriere bewusst einen anderen Mindestwert. `SANDBOX_MIN_FREE_DISK=0` schaltet diesen Schutz ab; du bist dann selbst dafür verantwortlich, dass der Datenträger nicht vollläuft. Der Spawner kann ungenutzte Build-Caches gestoppter Organisationen entfernen, pausiert aber nach drei aufeinanderfolgenden Entfernungen mit jeweils weniger als 1 MiB Gewinn für sechs Stunden. Verlasse dich bei einem vollen Host nicht auf diese Entfernung. Konfiguration und Grenzen der Wiederherstellung stehen in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference).

## Bifrost 1.6 → 2.2: Der Speicher des Modell-Gateways wird migriert

Das betrifft die Releases, die das Modell-Gateway noch betreiben. Ab dem Release, das es durch das [Modell-Relay](#model-relay) ersetzt, aktualisiert `tale deploy` das Gateway nicht mehr: Es behält oder entfernt es, wie dieser Abschnitt beschreibt.

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

Finde diese Aufrufer vor dem Upgrade und plane ihren Ersatz. Ein Aufrufer, der die Antwort eines Modells braucht, kann auf die Modell-Endpunkte umsteigen, die Versionen ab API-Vertrag 3.7.0 anbieten. Sie unterscheiden sich von der Schicht aus 0.3: Die Basis-URL ist `/api/v1/openai`, für Anthropic-Clients `/api/v1/anthropic`, statt `/api/v1`; `model` nennt ein Modell als `<providerSlug>/<modelId>`, nie einen Agenten; Bildgenerierung wird nicht bedient; und die Endpunkte sind ausgeschaltet, bis ein Admin unter **Einstellungen > Richtlinien > Modelle** den Schalter **Modell-Endpunkte für API-Schlüssel** einschaltet. Danach durchläuft jeder Aufruf Modellzugriff, Eingabe-Guardrails und Budgets. Die Modell-Endpunkte erreichen die Modelle über dasselbe Modell-Relay wie verwaltete Agenten. Fragen aus Skripten an den eingebauten Assistenten wandern zur asynchronen REST-Chat-API, die als Assistent antwortet und nicht als reines Modell. Editor-Integrationen, die das Wissen von Tale brauchen, nutzen den MCP-Endpoint, und Arbeit, die in Tale laufen soll, in einer Sandbox und mit Prüfung durch eine Person, geht an einen Projektagenten an einer Aufgabe. [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor) beschreibt jeden dieser Wege.
