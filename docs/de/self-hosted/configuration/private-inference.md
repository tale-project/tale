---
title: Private Inferenz auf einem Mac betreiben
description: Bereite festgelegte Modellartefakte vor, prüfe einen dedizierten Apple-Silicon-Mac und verbinde verifizierte private Modellrouten mit Tale.
---

Mit der Tale CLI betreibst du einen dedizierten Mac für die Modelle deiner Organisation. Die Modelldeklaration gehört ins Client-Repository; deine Deployment-Automatisierung liefert Host, privates Netzwerk, Quell-Commit und Zugangsdaten. Die Vorbereitung lädt keine Modellgewichte und belegt keine Hardwareleistung: Aktivierung und Abnahme finden auf dem Ziel-Mac statt.

## Voraussetzungen prüfen

Nutze macOS 15 oder neuer auf Apple Silicon mit einem dedizierten interaktiven Konto ohne Admin-Rechte und einer aktiven grafischen Sitzung. Host-Freigabe, privates Netzwerk, SSH und Fernzugriff richtest du separat ein. Die CLI prüft den deklarierten Benutzer, Hostnamen, die lokale Adresse und freie Ressourcen; sie konfiguriert weder das Betriebssystem noch lockert sie Apples Sicherheitsvorgaben.

Die geprüfte Laufzeit ist die signierte, notarisierte Anwendung oMLX 0.6.4. Tale bindet Download, vollständigen Artefakthash und signierte ARM64-Codeidentität und nutzt das enthaltene Python samt nativen Kerneln. Ein hashgebundener Tale-Einstiegspunkt begrenzt Rechenanfragen über den öffentlichen FastAPI-Middleware-Anschluss; die signierten Anwendungsdateien bleiben unverändert. Eine andere Laufzeit braucht ein geprüftes CLI-Update. `.github/actions/setup-cli` baut die CLI aus einem exakten Tale-Commit auf Linux oder macOS ARM64; die Vorbereitung für Mac-Inferenz ist vom verwalteten Linux-Stack getrennt.

## Schritt 1 — Modelle im Client-Repository festlegen

Committe `tale/inference/spec.json`. Die Schemaversion ist `1`, `runtime` lautet `omlx-0.6.4-macos15`. Deklariere `name`, den exakten Organisations-Slug, `models`, `nodes` und eine Umgebungsreferenz für `serviceKey`. Jeder Knoten nennt Schlüssel, dedizierten Benutzer, Hostnamen, private IPv4-Adresse, zugewiesene Modellschlüssel und eine separate `adminKey`-Referenz. Die Adresse darf `{ "env": "TALE_INFERENCE_NODE_ADDRESS" }` verwenden; die Vorbereitung hält den aufgelösten Wert fest.

Jedes Modell nennt Repository, vollständige unveränderliche Revision, API-Modell-ID, Fähigkeit (`text`, `vision` oder `embedding`), Architektur, Kontextgrenze sowie Pfad, Bytezahl und SHA-256 jeder benötigten Datendatei. Gib die Embedding-Dimension explizit an. Halte die Rollen getrennt: Ein Textmodell belegt keine Bildunterstützung. Python aus dem Modell-Repository, Bytecode und versteckte Repository-Dateien sind unzulässig.

Für ein unterstütztes GLM-DSA-Artefakt, das Repository-Code auswählt, gibt es ausschließlich `configurationProjection.kind: "signed-omlx-glm-dsa"`. Diese Projektion entfernt nach Prüfung des ursprünglichen Konfigurationshashs genau `model_file: "glm_moe_dsa.py"`, erhält alle anderen Einstellungen und prüft den deklarierten abgeleiteten Hash. Beide Hashes gehören zur Modellidentität. Die integrierte Architektur der signierten Laufzeit und ein echtes Laden auf dem Ziel müssen bestehen; `trust_remote_code` bleibt aus.

## Schritt 2 — Ohne Modellgewichte vorbereiten

Setze `INFERENCE_REPOSITORY` auf die kanonische GitHub-URL des Clients, `INFERENCE_SOURCE_COMMIT` auf den vollständigen Commit und `INFERENCE_BUNDLE` auf einen neuen absoluten Ausgabeordner. Löse zuerst die öffentlichen Adressvariablen der Deklaration auf.

```bash
tale --json inference prepare \
  --repository "$INFERENCE_REPOSITORY" \
  --source-ref "$INFERENCE_SOURCE_COMMIT" \
  --spec tale/inference/spec.json \
  --output "$INFERENCE_BUNDLE"
```

Das JSON-Ergebnis enthält `bundleSha256`, `source`, `modelCount`, `nodeCount` und `modelWeightsDownloaded: false`. Übernimm den Hash als `INFERENCE_BUNDLE_SHA`. Optional akzeptiert `--sources <file>` die vorhandene Zuordnung `repository@fullSHA` zu lokalen Checkouts; sonst nutzt die Beschaffung dieselbe geprüfte GitHub-Grenze wie verwaltete Deployments. `TALE_SOURCE_SSH_KEY` gehört nur in die Vorbereitung. Lokales `--spec <file>` ohne Repository/Revision dient der Entwicklung und enthält keinen Nachweis eines Quell-Commits.

```bash
tale --json inference validate \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
tale --json inference plan \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA"
```

Die Validierung prüft das vollständige Metadateninventar, die Quellenbindung und die Bytes von `runtime-admission.py`. Die Planung nennt den Ressourcenbedarf und meldet `ready: false`, solange keine Hardwarebeobachtung vorliegt. Beide Befehle laden keine Gewichte und aktivieren keinen Dienst. Übertrage beide Bundle-Dateien und nutze auf dem freigegebenen Mac dieselbe festgelegte CLI.

## Schritt 3 — Tatsächliche Kapazität prüfen

Führe `inference plan` mit `--observe` auf dem Ziel aus. `--hardware <file>` akzeptiert stattdessen eine explizite Planungsbeobachtung; die erneuten Prüfungen bei der Aktivierung bleiben verpflichtend. Die Zulassung berücksichtigt physischen RAM, freien Speicherplatz, macOS/ARM64, den von MLX empfohlenen Arbeitsspeicher und eine wirksame positive Grenze für gebundenen Speicher. Sobald die verifizierte Laufzeit vorliegt, folgen die nativen Kernelprüfungen.

Physischer RAM allein reicht nicht. Ein großes quantisiertes Modell kann zusammen mit Kontext, Caches, Bild- und Embedding-Gewichten die wirksame Metal-Grenze überschreiten. Die CLI reserviert Arbeitsspeicher, begrenzt Parallelität und Caching und prüft nach dem Bereitstellen sowie beim Status erneut. Sie ändert weder `sysctl` noch Swap, Energieprofil oder Systemsicherheit. Ändert eine separat verwaltete Host-Richtlinie eine Grenze, verlange vor der Aktivierung deren bestätigten Istwert.

Modelle bleiben verdrängbar und laden bei Bedarf. Die Planung prüft die größte aktive Rolle samt Reserve und Caches gegen die wirksame Grenze; der Speicherplatzbedarf umfasst weiterhin alle Modelle. Gleichzeitige RAM-Residenz aller Rollen ist keine Voraussetzung. Beim Rollenwechsel kann ein Modell entladen und ein anderes erneut geladen werden; große Gewichte verursachen dabei erhebliche Wartezeit. Ein ungeladenes Modell bedeutet nicht, dass der Dienst ausgefallen ist.

## Schritt 4 — Auf dem Ziel aktivieren und messen

Injiziere getrennte Admin- und Dienstschlüssel über die deklarierten Umgebungsreferenzen. Beide brauchen 32–256 URL-sichere Zeichen. Der Admin-Schlüssel bleibt auf dem Mac; nur der Dienstschlüssel gehört auf den Router- und nativen Anbieterpfad. Private Einstellungen und Wiederherstellungsdateien erhalten Modus `0600` unter dem Application-Support-Verzeichnis des dedizierten Benutzers.

Diese Zielbefehle laden die festgelegte Laufzeit und Gewichte, prüfen Bytes und Signaturen und senden synthetische Modellanfragen. Setze `INFERENCE_NODE` auf den deklarierten Knotenschlüssel. Das sind Betriebsanweisungen; CI ohne echte Modelle belegt weder deren Geschwindigkeit noch Genauigkeit.

```bash
tale --json --yes inference apply \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json --yes inference benchmark \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
tale --json inference status \
  --bundle "$INFERENCE_BUNDLE" --bundle-sha "$INFERENCE_BUNDLE_SHA" \
  --node "$INFERENCE_NODE"
```

Betriebsbereitschaft verlangt exakte Modell-IDs, authentifizierte API-Antworten, die genaue Zulassungsrichtlinie und native Kernel. Die Abnahme prüft Textstreams, eine Werkzeugaufruf-Antwort ohne Ausführung, Bildverarbeitung sowie 64 geordnete Embedding-Vektoren mit exakten Dimensionen innerhalb der nativen Frist von 60 Sekunden, einschließlich Warteschlange. Hinzu kommen eine begrenzte gemischte Last und Messungen von Speicherdruck, Swap-Nutzung und kumulierten Auslagerungen vor, während und nach den Anfragen. Speicherdruck, wachsende Auslagerung oder eine verpasste Embedding-Frist verhindern die Freigabe. Das ersetzt weder einen Dauertest noch eine Prüfung der Rechnungs-OCR; behalte eigene Fachbeispiele und längere Zielmessungen bei.

Text, Bilder und Embeddings teilen sich einen nativen Rechenplatz. Standardmäßig warten höchstens vier weitere Anfragen; `limits.queuedRequests` legt diese Grenze fest. Validierte Anfragen starten in Eingangsreihenfolge. `queueTimeoutSeconds` und `requestTimeoutSeconds` stehen jeweils auf 1800. In der Warteschlange abgebrochene Anfragen starten nie. Bereits angenommene Arbeit behält ihren Platz nach einem Verbindungsabbruch, bis native Aktivität und Metal-Synchronisation beendet sind. Unklare Bereinigung oder ein Timeout angenommener Arbeit sperrt den Knoten bis zur Prüfung und zum Neustart. Überzählige Arbeit erhält `503`, bevor sie die Modellanwendung erreicht.

Unter oMLX 0.6.4 kann anhaltende Embedding-Arbeit die Textausgabe verzögern. Die serielle Ausführung begrenzt diesen Einfluss, ändert aber nicht den Scheduler. HTTP-Stapel mit bis zu 64 Embeddings bleiben gültig; intern erfolgt jeweils ein Forward. Benchmark-Belege trennen `loadedRoles` von Bereitschaft und nennen `coldRequest`, `queueWaitMs` und `coldRequestTotalMs`; der letzte Wert umfasst Warten, Laden und Generieren. Sie versprechen weder gleichzeitige Residenz noch interaktive Antwortzeiten. Regenerierbare Modell- und Cache-Verzeichnisse erhalten gezielte Spotlight-Ausschlüsse; sichere Einstellungen, Schlüssel und Belege weiter.

## Schritt 5 — Private Routen mit Tale verbinden

Ergänze die verwaltete Deployment-Spezifikation um `inference`. Dieses Fragment wählt committeten Client-Inhalt aus; Modellkataloge bleiben außerhalb der Deployment-Automatisierung.

```json
{
  "inference": {
    "repository": "https://github.com/example-team/client-app",
    "revision": { "env": "EXAMPLE_INFERENCE_REF" },
    "specPath": "tale/inference/spec.json",
    "overlayNetwork": { "env": "TALE_INFERENCE_NETWORK" },
    "readiness": []
  }
}
```

Jeder zugelassene `readiness`-Eintrag liefert eine Statusdatendatei über `file: { "env": "TALE_NODE_READY_FILE" }` mit exaktem `sha256`. Das sind aktuelle Beobachtungen des Betreibers, keine entfernte Hardwareattestierung. Ohne zugelassene Knoten antworten Berechnungen mit `503`; Katalogmetadaten bleiben intern verfügbar. Bereite ein neues verwaltetes Bundle vor, wenn sich die zugelassene Knotenliste ändert.

Die CLI erzeugt und prüft festgelegte Caddy- und ZeroTier-Dienste. Caddy lauscht ohne veröffentlichten Host-Port auf der Tale-Backend-Bridge unter `inference-overlay.local:8081`; sein Netzwerk-Namensraum erreicht die deklarierte private Mac-API auf Port `18080`. Die Host-Netzwerkrichtlinie muss diesen Pfad begrenzen. Berechnungen verlangen den Dienstschlüssel; Katalogmetadaten auf der internen Bridge benötigen keine Zugangsdaten. Jede Organisation hat eigene Routen, ohne zusätzlichen Ausweichpfad zu gehosteten Anbietern.

Replikate sind eigenständige Server für exakt dieselben Modelle. Das Routing bevorzugt das erste zugelassene gesunde Replikat und berücksichtigt einen optionalen Cache-Affinitätsschlüssel; es leitet keinen dynamischen Ladezustand ab. Die native Zulassung verwaltet Warteschlange und gemeinsamen Rechenplatz. Einen begonnenen Stream wiederholt das Routing nie. Verteiltes Modell-Sharding ist unzulässig, bis ein unterstützter Laufzeitpfad unabhängig nachgewiesen wurde.

Um den neuen Router-Namensraum freizugeben, setze `DEPLOYMENT_BUNDLE`, `TALE_CLI_COMMIT` und `DEPLOYMENT_COMMIT` auf die genaue Deployment-Auswahl. Lies danach den Zustand auf dem Linux-Ziel:

```bash
tale --json deploy inference-status --bundle "$DEPLOYMENT_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --deployment-ref "$DEPLOYMENT_COMMIT"
```

Das Ergebnis bindet Bundle und Quelle an `nodeId`, `networkId`, `networkType`, `status`, `online` und `assignedAddresses`. Der protokollierte private Namensraum muss laufen. `ACCESS_DENIED` ohne Adressen bedeutet, dass die Controller-Freigabe noch fehlt. Lass die Flottenverwaltung genau diesen Knoten autorisieren und wiederhole den Befehl. Vergleiche danach `PRIVATE`, `OK`, den Online-Zustand und die exakte deklarierte Adresse samt Präfix. `networkReady` bestätigt keine Modelle. Der Befehl tritt keinem Netzwerk bei und ruft keinen Controller auf.

Die Backend-Bereitstellung erzeugt explizite Anbieter `omlx-<model key>`, prüft Zugangsdaten und Kataloge und legt Bild- sowie Embedding-Routen separat fest. Unbekannte aktive Anbieterzugänge, widersprüchliche Richtlinien und unsichere Änderungen vorhandener Embeddings stoppen zur Prüfung. Der native Beleg bestätigt diese Bindungen und führt die Bereitschaft des Modellservers getrennt. Verwende die Deklarationen für neue Identitäten, Projekte und Besitzer unter [verwaltete Deployments](/de/self-hosted/install/cli-install#verwaltete-deployments), wenn native IDs noch fehlen.

## Modellrollen aufteilen

Verpassen kalte Modellwechsel oder die gemeinsame Warteschlange die native Frist, verteile Rollen auf getrennte Macs und behalte die Modellartefakte bei. Für die Schlüssel `reasoning`, `vision` und `embedding` ersetzt dieses Fragment `nodes`; liefere jede Adresse und Schlüsselreferenz separat:

```json
{
  "nodes": [
    { "key": "reasoning-01", "user": "inference", "hostName": "reasoning-mac", "address": { "env": "TALE_REASONING_ADDRESS" }, "models": ["reasoning"], "adminKey": { "env": "TALE_REASONING_ADMIN_KEY" } },
    { "key": "vision-01", "user": "inference", "hostName": "vision-mac", "address": { "env": "TALE_VISION_ADDRESS" }, "models": ["vision"], "adminKey": { "env": "TALE_VISION_ADMIN_KEY" } },
    { "key": "embedding-01", "user": "inference", "hostName": "embedding-mac", "address": { "env": "TALE_EMBEDDING_ADDRESS" }, "models": ["embedding"], "adminKey": { "env": "TALE_EMBEDDING_ADMIN_KEY" } }
  ]
}
```

Committe die Änderung, bereite ein neues Bundle vor und führe Zulassung sowie Benchmarks auf jedem Knoten aus. Übergib beim Vorbereiten der verwalteten Routen alle drei aktuellen Statusbelege. Für weitere Replikate einer Rolle weist du denselben Modellschlüssel einem zusätzlichen zugelassenen Knoten zu. Getrennte Maschinen vermeiden Konkurrenz zwischen Rollen; Zielmessungen entscheiden weiterhin über Kapazität und Latenz.

## Wiederherstellen, ohne unbekannten Zustand zu ersetzen

Bewahre das gesamte Zustandsverzeichnis, die ausstehende Absicht und Bereitschaftsbelege auf. Eine identische Wiederholung prüft vorhandene Bytes und Dienstidentität; Abweichungen stoppen, statt Dateien zu überschreiben. Vor Austausch oder Rollback darf der Dienst keine aktive Arbeit haben. Nach einer verlorenen Antwort gleicht Tale die protokollierte Aktivierung ab; unbekannter oder widersprüchlicher Zustand braucht eine Betreiberprüfung.

`inference rollback` nimmt dieselben Bundle-, Hash- und Knotenoptionen sowie `--release <retained-sha256>` und `--yes`. Es prüft die aufbewahrte Version vor der Aktivierung, löscht keine späteren Belege und verändert keine Host-Speichergrenzen. Lokale Sperren koordinieren einen Host; sie bieten weder hostübergreifendes Compare-and-Swap noch Schutz vor unabhängigen Admin-Änderungen.

## Mit der Zielabnahme fortfahren

Bewahre Quell-, Bundle- und Statushashes zusammen mit Host-Freigabe und gemessener Last auf. Die CLI liefert reproduzierbare Eingaben und klare Freigabegrenzen; schließe Dauerlast- und Fachprüfungen auf dem Ziel ab, bevor produktive Aufgaben folgen. [Konfigurationen veröffentlichen](/de/self-hosted/configuration/config-releases) hält Automatisierungen zusammen mit diesen Modellrouten fest.
