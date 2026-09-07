---
title: Compose anpassen
description: Den App-Tier skalieren, die ausgelieferte Compose-Datei überlagern und wissen, welche Container Singletons bleiben.
---

Jeder Prozess, der in Tale eine Anfrage bedient, ist austauschbar: Sessions sind Datenbankzeilen, Chat-Fortschritt ist eine Generation-Zeile, Hints laufen über eine Outbox, und Schreibzugriffe auf den Config-Store serialisiert ein Lock, das die Datenbank hält. Genau das erlaubt `platform`, `backend-api` und `backend-worker`, in mehr als einem Container zu laufen. Diese Seite ist für den Operator, dessen Queue sich staut oder dessen API sättigt — die Replica-Schalter, was das Hochsetzen tatsächlich kostet, welche Container nie repliziert werden dürfen, und wie du etwas änderst, das die CLI nicht anbietet, ohne Dateien zu forken, die `git pull` überschreibt.

## Eine Rolle skalieren

Die drei App-Rollen lesen je eine Umgebungsvariable aus dem `.env` der Deployment. Default ist eine Replica pro Rolle; Werte außerhalb von `1`–`16` werden mit einer Warnung geklemmt statt abgelehnt.

| Variable                       | Skaliert                                       | Setz sie hoch, wenn                                                                                              |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `TALE_BACKEND_WORKER_REPLICAS` | Den Job-Runner                                 | Ingest, Crawls, Automations oder Agent-Turns sich hintereinander stauen. Die billigste und sicherste Schraube.       |
| `TALE_BACKEND_API_REPLICAS`    | Jede API-Tür, Auth und den Hint-Stream         | Die Latenz unter Nebenläufigkeit steigt oder SSE-Verbindungen die Decke sind.                                        |
| `TALE_PLATFORM_REPLICAS`       | Den Web-Tier, der die App-Shell ausliefert     | Selten — er liefert statische Assets aus und injiziert Env; der Engpass ist fast immer zuerst die API.               |

Setzen und deployen. Die Zahlen greifen beim nächsten `tale deploy`, der die ganze Farbe in der neuen Größe hochbringt:

```bash
# In der .env des Projekts
TALE_BACKEND_WORKER_REPLICAS=3
TALE_BACKEND_API_REPLICAS=2

tale deploy
```

Unter `Blue (active) Services:` listet `tale status` danach eine Zeile pro Replica — `backend-api #1`, `backend-api #2` und so weiter, jede mit eigener Health und Version. Eine Rolle mit einer Replica behält ihren schlichten Namen. Das ist Absicht: Eine Farbe, die zwei von drei hochbekommen hat, steht so sichtbar in der Liste, statt zu einer gesunden Zeile verrechnet zu werden.

<Warning>

Rechne mit dem Deploy-Fenster, nicht mit dem Normalbetrieb. Ein Deploy fährt beide Farben gleichzeitig, `TALE_BACKEND_API_REPLICAS=4` heißt also **acht** API-Container für die Dauer des Drains. Jeder Backend-Container trägt ein 12-GB-Memory-Cap für seine Ingest-Subprozesse; das ist eine Obergrenze, keine Reservierung, aber die Spitze ist echt. Dimensioniere dafür, bevor du auf einer ohnehin knappen Maschine hochsetzt.

</Warning>

## Was Skalieren nicht behebt

Mehr Replicas verschieben einen Engpass; sie beseitigen keinen.

- **Eine gesättigte Datenbank.** Alle Replicas teilen sich ein Postgres. Sind die Queries die Decke, machen mehr Clients es schlimmer. Verschieb zuerst den Knowledge-Korpus von der Maschine — [Datenresidenz](/de/self-hosted/configuration/data-residency) ist dieser Weg.
- **Einen langsamen Model-Provider.** Agent-Turns warten auf den Provider, nicht auf CPU. Zusätzliche Worker warten parallel.
- **Einen einzelnen großen Job.** Replicas teilen eine Queue, keinen Job. Ein 4-Stunden-Crawl braucht weiter 4 Stunden.

## Diese bleiben Singletons

Vier Services lassen sich nicht replizieren, und der Grund ist bei jedem ein anderer.

| Service                     | Warum einer                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `db`, `object-store`        | Sie **sind** der dauerhafte Zustand. Zwei wären zwei Kopien der Wahrheit.                                          |
| `proxy`                     | Ihm gehören die Ports des Hosts und der Zertifikatsspeicher.                                                       |
| `sandbox`, `sandbox-egress` | Der Spawner hält den Docker-Socket und das Session-Verzeichnis auf dem Host-Dateisystem; Sessions hängen an ihm.   |
| `sandbox-llm-gateway`       | Ihm gehört das einzige `llm-gateway-data`-Volume mit den pro Session ausgestellten virtuellen Keys.                |

Einen davon zu skalieren ist keine unterstützte Topologie, und `tale deploy` tut es nicht.

## Etwas überlagern, das die CLI nicht anbietet

Zusätzliche Env, ein zusätzlicher Mount, ein eigener Sidecar — alles, wofür die CLI keinen Schalter hat, kommt in eine Overlay-Datei, damit `git pull` es nie überschreibt. Welche Datei, und ob Compose sie überhaupt liest, hängt an deiner Installationsart.

| Installiert mit             | Overlay-Datei                                | Wird automatisch gelesen        |
| --------------------------- | -------------------------------------------- | ------------------------------- |
| `tale init`, dann `tale dev` | `compose.override.yml` im Projekt-Root       | Ja — `tale dev` legt sie drauf  |
| Einem Clone dieses Repos    | `compose.local.yml`, mit `-f` übergeben      | Nein — du übergibst sie selbst  |
| `tale deploy`               | Keine                                        | Die CLI erzeugt Compose inline  |

<Note>

`tale deploy` baut den Stack aus generierten Dateien und ignoriert beide Overlay-Namen. Auf einer produktiven CLI-Installation sind die unterstützten Schalter die Umgebungsvariablen in `.env` — die Replica-Zahlen oben und die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference). Ein Overlay ist für den Clone und für `tale dev`.

</Note>

Leg die Datei neben die ausgelieferte `compose.yml`. Compose merged Keys nach dem Prinzip letzte-Datei-gewinnt, das hier ist also die einzige Datei, die du nach einem Pull anfasst:

```yaml
# compose.local.yml — mehr Worker-Concurrency, gesprächigere Platform-Logs
services:
  backend-worker:
    environment:
      WORKER_CONCURRENCY: '8'
  platform:
    environment:
      LOG_LEVEL: debug
```

Fahr den Stack mit dem Overlay zuletzt hoch, und prüf den Merge, bevor Container starten:

```bash
docker compose -f compose.yml -f compose.local.yml config --services
docker compose -f compose.yml -f compose.local.yml up -d
```

<Check>

`config --services` listet jeden Service im gemergten Graph. Auf denselben Dateien zeigt `config --format json` `WORKER_CONCURRENCY` als `8` auf `backend-worker` und keinen `container_name` auf `backend-api` oder `backend-worker` — genau das erlaubt Compose, sie dort zu replizieren.

</Check>

Auf einem Clone ist `--scale` das direkte Gegenstück zu den Replica-Variablen — für die zwei Backend-Rollen. Die `platform` des Clones behält einen gepinnten `container_name` (`tale-platform`), weil die Troubleshooting-Runbooks sie unter diesem Namen ansprechen, und bleibt dort ein Singleton; auf einem `tale deploy`-Stack skaliert sie wie der Rest.

```bash
docker compose -f compose.yml -f compose.local.yml up -d --scale backend-worker=3
```

## Was ein Overlay nicht ändern darf

Diese Eingriffe sehen lokal aus und zerlegen den Stack.

| Änderung                                                              | Warum es bricht                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `container_name` auf `backend-api` oder `backend-worker` pinnen        | `--scale` scheitert dann — zwei Container können sich keinen Namen teilen                                                 |
| Irgendeinen Service aus der Singleton-Tabelle oben skalieren           | Jeder hält ein Volume, einen Socket oder einen Host-Port, den der Rest des Stacks fest verdrahtet hat                     |
| Das `config-data`-Volume umbenennen                                   | Docker kann kein Volume umbenennen; der neue Name mountet ein **leeres**, und jede Organisation verliert ihre Konfiguration |
| `compose.yml` direkt bearbeiten                                       | Der nächste `git pull` überschreibt sie                                                                                   |
| `5432` oder `8003` auf einem öffentlichen Host veröffentlichen        | Diese Ports sind für die innere Schleife des Clones, nicht für Produktion                                                 |

## Wo das hingehört

Du hast jetzt eine Größe pro Rolle, eine Datei, die dir gehört, über dem ausgelieferten Graph, und die Liste der Container, die unabhängig von der Last einer bleiben. [Upgrades](/de/self-hosted/operate/upgrades) ist das, was ein Deploy mit diesen Replicas macht — inklusive der Frage, warum der Host kurzzeitig von allem zwei fährt. [Container-Architektur](/de/self-hosted/operate/container-architecture) ist das, was jeder Container tut, wenn einer davon stirbt, und die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) ist jede Variable, die ein Overlay oder eine `.env` setzen könnte. Kapazität, die nicht aus mehr Replicas kommt, ist ein Umzug des Stores: [Datenresidenz](/de/self-hosted/configuration/data-residency) für den Knowledge-Korpus und für den eigenen Bucket einer Organisation unter **Einstellungen > Datenresidenz**.
