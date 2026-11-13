---
title: Tale auf Incus betreiben
description: Betreibe einen Tale-Workspace oder ein verwaltetes Deployment als Incus-Instanzen statt als Docker-Compose-Container, vom Knotenvertrag und seiner Prüfung über den Umzug eines bestehenden Deployments bis zu den Grenzen, die du einplanen musst.
---

Ein Workspace, den du mit `tale deploy` ausrollst, oder ein verwaltetes Deployment kann statt auf Docker Compose auf [Incus](https://linuxcontainers.org/incus/) laufen: Jeder Dienst des Stacks wird zu einer Incus-Instanz in einem eingeschränkten Projekt eines Linux-Hosts, und die Sandbox-Sessions laufen daneben in einem eigenen Projekt. Die Tale-CLI kompiliert dafür dieselben Compose-Definitionen, die auch die Docker-Laufzeit ausführt, sodass Dienste, Images und Einstellungen dieselben sind. Diese Seite führt dich von einem Incus-Host zu einem laufenden Deployment, zieht ein bestehendes Docker-Deployment um und nennt die Grenzen, die du einplanen musst.

<Warning>

Die Incus-Laufzeit ist in Tale 0.5.x **experimentell**. Docker Compose bleibt der Standard und die unterstützte Laufzeit. Ein Workspace läuft auf Incus mit `tale deploy`, seinen Blue-Green-Upgrades, Backups und Wiederherstellungen. Ein [verwaltetes Deployment](/de/self-hosted/install/cli-install#managed-deployments) bekommt auf Incus sein erstes Deployment, ein Upgrade dort wird aber noch abgelehnt, weil sein Wiederherstellungs-Snapshot auf Incus noch nicht angelegt wird.

</Warning>

## Die Incus-Laufzeit wählen {#choose-incus}

Wähle Incus, wenn ein Host Incus bereits für andere Workloads betreibt oder wenn du den Stack und seine Sessions ohne Docker-Daemon in eingeschränkten Incus-Projekten haben willst. Die CLI spricht über die REST-API mit Incus, mit einem Client-Zertifikat, das auf das Projekt des Stacks beschränkt ist, und braucht Administratorrechte auf dem Host nur für den einmaligen Bootstrap. Bleib bei Docker Compose, wenn du lokal mit `tale dev` entwickelst, das nur auf Docker läuft, wenn du verbundene Sandbox-Geräte brauchst oder wenn der Host die folgenden Voraussetzungen nicht erfüllt.

## Voraussetzungen prüfen {#prerequisites}

| Voraussetzung | Warum sie zählt |
| --- | --- |
| Ein Linux-Host mit Incus 7.2 oder neuer, der kein Cluster-Mitglied ist | Die CLI braucht die API-Erweiterungen `instance_oci`, `instance_oci_entrypoint`, `oci_network_config`, `storage_shifted`, `storage_initial_owner`, `file_storage_volume`, `projects_restricted_backups_and_snapshots`, `projects_restricted_image_servers` und `instance_auto_restart` und lehnt einen Server ab, dem eine fehlt oder der in einem Cluster läuft. |
| Linux 5.12 oder neuer mit idmapped Mounts | Jedes Volume des Stacks wird verschoben eingehängt (`security.shifted`), und das braucht idmapped Mounts. |
| Ein Storage-Pool mit `zfs`, `btrfs` oder `lvm` | Diese Treiber setzen die Größe eines Volumes durch. Ein ZFS-Pool braucht OpenZFS 2.2 oder neuer, dessen Datasets idmapped Mounts können. Der Bootstrap nutzt den Pool, den du bei der Installation von Incus angelegt hast, und legt keinen an. |
| Ein `x86_64`-Host | Verwaltete Bundles brauchen native Images für ihre festgelegte Plattform, und den mitgelieferten Objektspeicher gibt es nur als `linux/amd64`-Image. |
| Die Incus-API auf einer Adresse, die das Bridge-Netz des Stacks erreicht | Die CLI und der Sandbox-Spawner wählen sie an (`runtime.incus.endpoint`, standardmäßig das Gateway der Bridge auf Port 8443), etwa nach `incus config set core.https_address <gateway>:8443`. Ihr Serverzertifikat muss sich pinnen lassen: ein eigener Vertrauensanker (`CA:TRUE`), der die Adresse des Endpunkts nennt. |
| Zugriff vom Host auf die Image-Registries | Incus lädt jedes Image per Digest von `ghcr.io` und Docker Hub oder von den Spiegeln, die die Festlegung nennt. |
| Einmal root oder Mitglied von `incus-admin` | Nur `tale incus bootstrap` nutzt den lokalen Administrator-Socket. Jeder spätere Befehl nutzt das eingeschränkte Zertifikat. |
| Die CLI unter Linux oder macOS | Die CLI hält die Incus-Zugangsdaten, den Planschlüssel und das Journal als Dateien, die anderen Konten verschlossen sind. Das kann Windows nicht, deshalb lehnt sie dort `tale incus check`, `tale incus bootstrap`, Deployments und die anderen Stack-Befehle auf Incus ab. `tale incus contract` läuft überall. |

Weder der Host noch die Maschine des Workspace noch die Maschine, die ein Bundle vorbereitet, braucht Docker. Läuft Docker trotzdem auf demselben Host, lies [Einen Host mit Docker teilen](#docker-coexistence).

## Die Laufzeit festlegen {#declare}

Die `tale.json` eines Workspace oder eine Deployment-Spezifikation nennt die Laufzeit in `runtime.engine` und beschreibt den Knoten in `runtime.incus`. Die Felder stehen unter [Die Container-Laufzeit festlegen](/de/self-hosted/install/cli-install#container-runtime). Ein Workspace betreibt während eines Upgrades zwei Farben nebeneinander, deshalb ist sein Adressblock `block` ein /24. Ein verwaltetes Deployment ersetzt jeden Dienst an Ort und Stelle und hat keine blauen und grünen Farben, deshalb ist sein `block` ein /25 innerhalb des Bridge-Subnetzes.

Für einen neuen Workspace schreibt `tale init` den Block aus seinen Optionen:

```bash
tale init my-project --runtime incus \
  --incus-project tale-acme --incus-pool tank \
  --incus-network tale-acme --incus-subnet 10.30.0.0/24 \
  --incus-sessions-subnet 10.31.0.0/24
```

Das Gateway ist standardmäßig der erste Host des Subnetzes, der Block das Subnetz selbst, wenn es ein /24 ist, und der Eingang `proxy-device`. Setze `runtime.engine` nur in einem Workspace von Hand auf `incus`, der noch nie ausgerollt wurde. Ein Workspace, der schon auf Docker läuft, legt die Incus-Laufzeit in `runtime.next` fest und [zieht um](#migrate), damit seine Daten mitkommen. Ein verwaltetes Deployment legt sie in seiner Spezifikation fest, mit dem, was [Die Incus-Laufzeit festlegen](/de/self-hosted/install/cli-install#managed-incus-runtime) ergänzt:

```json
{
  "schemaVersion": 1,
  "name": "example-incus",
  "stateDirectory": "/opt/tale-example",
  "composeProject": "tale-example",
  "runtime": {
    "revision": { "env": "TALE_RUNTIME_REF" },
    "platform": "linux/amd64",
    "engine": "incus",
    "incus": {
      "endpoint": "https://10.30.0.1:8443",
      "project": "tale-example",
      "pool": "tank",
      "network": {
        "name": "tale-example",
        "subnet": "10.30.0.0/22",
        "gateway": "10.30.0.1",
        "block": "10.30.1.0/25"
      },
      "sessions": { "subnet": "10.31.0.0/24" },
      "ingress": { "mode": "proxy-device" },
      "volumes": { "db-data": { "size": "100GiB" } }
    }
  },
  "sandbox": { "backend": "incus" },
  "environment": {
    "SANDBOX_INCUS_PROJECT": { "env": "TALE_SANDBOX_INCUS_PROJECT" },
    "SANDBOX_INCUS_PROFILE": { "env": "TALE_SANDBOX_INCUS_PROFILE" },
    "SANDBOX_INCUS_NETWORK": { "env": "TALE_SANDBOX_INCUS_NETWORK" },
    "SANDBOX_INCUS_STORAGE_POOL": { "env": "TALE_SANDBOX_INCUS_STORAGE_POOL" }
  }
}
```

Das Beispiel lässt `origin`, `tlsMode`, `identity` und `configs` weg, die wie unter Docker bleiben. `sandbox` ist als `{ "backend": "incus" }` erforderlich: Der Sandbox-Spawner ist eine der Instanzen des Stacks. Die vier `SANDBOX_INCUS_*`-Werte nennen Projekt, Profil, Bridge und Pool der Sessions. Der Bootstrap vergibt dafür `<project>-sessions`, `sandbox`, die ersten 13 Zeichen des Bridge-Namens gefolgt von `-s` und den Pool des Stacks. Ohne sie startet der Spawner nicht, und nichts lehnt ihr Fehlen ab, bevor das Deployment ihn erreicht, also lege alle vier fest. [Die Sandbox unter jeder Laufzeit](/de/self-hosted/install/cli-install#managed-incus-sandbox) nennt, was die CLI selbst setzt.

## Den Knoten vorbereiten {#node-contract}

Der Knotenvertrag beschreibt, was der Incus-Server enthalten muss, bevor der Stack laufen kann: das Projekt mit seinen Einschränkungen und Limits, das Profil des Stacks, die Bridge, die Netzwerk-ACLs, Pool und Volume-Größen, die Registry-Hosts, das zu vertrauende Zertifikat und die Stopp-Prioritäten. Drei Befehle arbeiten damit. In einem Workspace lesen sie die `tale.json` (`--workspace <verzeichnis>` nennt einen anderen als das aktuelle Verzeichnis). Für ein verwaltetes Deployment übergibst du `--spec <datei> --compose <datei>`, wobei `--compose` die `runtime/compose.yml` des Bundles ist; bereite also zuerst das Bundle vor. Die Beispiele unten zeigen die Form für verwaltete Deployments.

<Steps>

<Step title="Den Vertrag ausgeben">

`tale incus contract` gibt ihn als versioniertes JSON aus (`schemaVersion` 1, `kind` `tale.incus.node-contract`). Der Befehl liest keinen Knoten und braucht keine Zugangsdaten, sodass deine eigenen Werkzeuge die Objekte daraus anlegen können. Eine neuere CLI ergänzt Version 1 nur um Felder.

```bash
tale incus contract --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Einen einzelnen Host bootstrappen">

Auf einem Host, den nur du verwaltest, setzt `tale incus bootstrap` den Vertrag über den lokalen Socket um (`/var/lib/incus/unix.socket`; `--socket` nennt einen anderen). Der Befehl zeigt seinen Plan und fragt, bevor er etwas ändert (`--yes` überspringt die Frage). Er legt das Projekt des Stacks an, sein Profil `tale-stack`, die Bridge und ihre ACL, Projekt, Bridge, ACL und Profil `sandbox` der Sessions sowie zwei auf ihre Projekte beschränkte Client-Zertifikate: das der CLI in `<stateDirectory>/incus/` und das des Spawners in `<stateDirectory>/sandbox-incus/`, jeweils neben dem gepinnten `server.crt`. In einem Workspace sind die beiden Verzeichnisse `.tale/incus/` und `.tale/sandbox-incus/`, und ein Bootstrap als root übergibt sie dem Eigentümer des Workspace. Ein zweiter Lauf ändert nichts, und `--remove` entfernt, was der Bootstrap angelegt hat, und sonst nichts. Lässt sich das eigene Zertifikat des Servers nicht pinnen, bricht der Bootstrap ab; `--replace-server-certificate` schreibt ein pinnbares, behält das alte als `server.crt.tale-bootstrap` und bittet dich, Incus neu zu starten, bevor du den Bootstrap erneut ausführst.

```bash
sudo tale incus bootstrap --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Den Knoten prüfen">

`tale incus check` liest den Knoten mit dem eingeschränkten Zertifikat des Stacks zurück und lehnt ab, was vom Vertrag abweicht, mit einem Satz pro Befund. Die Einstellungen der Bridge, ihre ACLs und die Firewall des Hosts sieht dieses Zertifikat nicht, also beurteilt `check` sie an ihrer Wirkung: Eine Hilfsinstanz im Bridge-Netz des Stacks öffnet die Verbindungen, die die geprüften Regeln erlauben, und eine Verbindung, die in ein Timeout läuft, wird mit ihrer Abhilfe abgelehnt. Die Hilfsinstanz läuft mit dem `tale-proxy`-Image des Projekts oder, solange das Projekt noch keines hat, mit dem Image, das `--probe-image` nennt (standardmäßig das Release dieser CLI); `--probe-public` und `--probe-name` wählen die öffentliche Adresse und den Namen, die sie versucht. Mit `--no-probes` startet `check` keine Hilfsinstanz und lehnt ab. Der Befehl endet mit `3`, solange eine Ablehnung besteht.

```bash
tale incus check --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

</Steps>

Auf einem Host, den andere Teams verwalten, legst du die Objekte mit deinen eigenen Werkzeugen aus dem Vertrag an, legst die beiden Zertifikatsverzeichnisse selbst ab und führst `tale incus check` als letzten Schritt aus. Die Verzeichnisse enthalten `client.crt`, `client.key` und `server.crt` und sind für Gruppe und andere geschlossen (0700 für das Verzeichnis, 0600 für jede Datei).

### Das eingeschränkte Modell {#restricted-model}

Das Projekt des Stacks ist eingeschränkt: Es lässt keine privilegierten, verschachtelten oder Low-Level-Container-Schlüssel zu (`raw.lxc` wäre root auf dem Host), keine Host-Datenträger und nur die Bridge und den Pool, die der Vertrag nennt, keine virtuellen Maschinen, und es lädt nur von den Registry-Hosts, die der Vertrag aufführt, jeder genau so geschrieben, wie die Remote-URL ihn trägt. `limits.instances`, `limits.memory` und `limits.processes` des Projekts sind für die Spitzenlast des Stacks berechnet. Das Zertifikat der CLI erreicht nur dieses Projekt und kann kein weiteres anlegen; das Zertifikat des Spawners erreicht nur das Projekt der Sessions. Eine Session hält nie ein Zertifikat.

### Die Netzwerk-ACLs {#network-acls}

Beide Bridges verwerfen in beide Richtungen, was keine Regel erlaubt, sodass eine fehlende Regel in ein Timeout läuft, statt wie ein geschlossener Port auszusehen. Incus übersetzt zwischen seinen eigenen Bridges keine Adressen, deshalb nennen die Regeln das echte Subnetz der Sessions.

| Regel | Was sie erlaubt | Wie `check` sie beurteilt |
| --- | --- | --- |
| `stack-to-stack`, `stack-from-stack` | Verkehr zwischen den Instanzen des Stacks auf seiner Bridge | Aufgeführt: Er passiert eine Incus-Bridge-ACL ohne Regel, also erwartet `check` dort kein Verwerfen |
| `names-to-gateway-udp`, `names-to-gateway-tcp` | Der Resolver des Stacks leitet jeden Namen, den er nicht kennt, an das eigene DNS der Bridge auf Port 53 weiter | Er passiert ebenfalls ohne Regel: `check` fragt nach einem öffentlichen Namen und beurteilt die Antwort |
| `spawner-to-incus` | Der Spawner erreicht die Incus-API unter `runtime.incus.endpoint` | Geprüft |
| `spawner-to-sessions` | Der Spawner ruft den Runner jeder Session auf Port 8200 auf | Geprüft |
| `public-egress` | Backend, Plattform, der Egress-Proxy der Sessions, das Modell-Gateway, der Proxy (für ACME) und der bgutil-Provider erreichen das Internet | Geprüft |
| `operator-reach-1`, … | Jedes Ziel, das die Festlegung in `runtime.incus.operatorReach` nennt, etwa ein Inferenz-Router | Für TCP geprüft, für UDP aufgeführt |
| `public-to-proxy` | Die Öffentlichkeit erreicht den Proxy über den gewählten Eingang | Aufgeführt |
| `sessions-to-*`, `stack-from-sessions-*`, `sessions-from-spawner` | Eine Session erreicht die Backend-API über den Switch, das Modell-Gateway, den Egress-Proxy und ihren Resolver und sonst nichts; der Spawner erreicht die Sessions | Aufgeführt: Von der Seite des Stacks lässt sich kein Verkehr aus den Sessions senden |

## Den Eingang wählen {#ingress}

`runtime.incus.ingress.mode`, das die Spezifikation nennen muss, entscheidet, wie die Öffentlichkeit die Instanz `proxy` des Stacks erreicht.

| Modus | Was geschieht | Wann du ihn nutzt |
| --- | --- | --- |
| `proxy-device` | Incus veröffentlicht die Ports 80 und 443 auf dem Host über NAT-Proxy-Geräte, die die Adresse des Clients erhalten, auf `listen` oder auf jeder Adresse. | Der Host steht im öffentlichen Netz, oder ein Load Balancer leitet an ihn weiter. |
| `routed` | Nichts wird veröffentlicht. Deine eigene Weiterleitung oder dein Reverse Proxy erreicht die Instanz `proxy` unter ihrer Adresse auf der Bridge. | Ein anderer Edge nimmt den Verkehr für den Host bereits an, meist mit `tlsMode: "external"`. |

TLS funktioniert wie unter Docker: Der Proxy bezieht Zertifikate im Modus `selfsigned` und `letsencrypt`, und `external` überlässt TLS dem Edge davor. Die Einstellungen unter [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) gelten unverändert.

## Den Knoten bemessen {#sizing}

Jede Instanz trägt `limits.memory` und `limits.processes`: ihren Compose-Wert, sonst den Wert der CLI für den Dienst, sonst den Standard des Profils `tale-stack` von `2GiB` und 2048 Prozessen.

| Dienst | Arbeitsspeicher | Prozesse |
| --- | --- | --- |
| `backend-api`, `backend-worker` (je Replik) | 12 GiB | 4096 |
| `db`, `knowledge-db` | 8 GiB | 4096 |
| `platform` (je Replik) | 4 GiB | Profilstandard |
| `proxy`, `switch` | 1 GiB | Profilstandard |
| `bgutil-provider` | 512 MiB | 512 |
| `names`, `names-sessions` | 256 MiB | 256 |
| Jeder andere Dienst | Profilstandard | Profilstandard |

Das sind Obergrenzen, keine Reservierungen. Der Vertrag addiert sie für die Spitzenlast des Stacks, dazu zwei Hilfsinstanzen (ein einmaliger Job und die Probe von `check`): bei einem Workspace die zustandsbehafteten Dienste einmal und die Anwendungsfarbe zweimal, weil während eines Upgrades beide Farben laufen; bei einem verwalteten Deployment jede Instanz einmal, weil es an Ort und Stelle ersetzt. Führe nach dem Erhöhen einer Replikzahl `tale incus bootstrap` erneut aus: `tale deploy` lehnt ein Projekt, dessen Limits nicht mehr passen, ab, bevor es etwas ändert. Der Root-Datenträger jeder Instanz ist `runtime.incus.rootSize` groß (standardmäßig `10GiB`). Lege für jedes Daten-Volume in `runtime.incus.volumes` eine `size` fest: Nur wenn jedes Volume eine hat, begrenzt der Vertrag auch, wie viel vom Pool das Projekt nutzen darf (`limits.disk.pool.<pool>`). Sessions werden getrennt bemessen, über `SANDBOX_MAX_SESSIONS` und die Session-Limits in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure); lass auf dem Host Platz für beides.

## Ausrollen {#deploy}

Ein Workspace wird wie unter Docker mit `tale deploy` ausgerollt; ein verwaltetes Deployment wendet ein vorbereitetes Bundle an.

### Einen Workspace ausrollen {#deploy-workspace}

In einem Workspace arbeitet `tale deploy` wie unter Docker, nach den Prüfungen, die Incus hinzufügt. Es liest die Zertifikate aus `.tale/incus/` und prüft den Knoten gegen den Vertrag des Stacks, wie `tale incus check` es ohne seine Proben tut. Dann bringt es den Stack Bereich für Bereich in den Sollzustand: die Volumes, die Resolver und den Traffic-Switch, die zustandsbehafteten Dienste und dann die freie Farbe, deren Repliken Verkehr bekommen, sobald der Switch sie zulässt. Prüfe zuerst den Plan jedes Bereichs:

```bash
tale --json deploy --plan-only > plan.json
tale deploy --plan plan.json
tale status
```

`--plan` wendet den geprüften Plan nur an, solange der Knoten noch genau ihn braucht. Das erste Deployment legt alles an. Spätere Deployments wechseln die Farbe, wie [Upgrades](/de/self-hosted/operate/upgrades#incus) es beschreibt, und `tale status` zeigt jede Replik, ob der Switch sie zulässt, und einen unterbrochenen Farbwechsel. Instanzen heißen wie ihre Dienste, bei den Anwendungsrollen mit Farbe und Replik-Nummer (`platform-blue-1`).

### Ein verwaltetes Bundle ausrollen {#deploy-managed}

Bereite das Bundle vor, prüfe es und wende es an wie unter [Bundle vorbereiten, prüfen und anwenden](/de/self-hosted/install/cli-install#bundle-vorbereiten-pruefen-und-anwenden). Auf Incus liest `deploy prepare` jedes Image aus seiner Registry und braucht keinen Docker-Daemon. `deploy --bundle` prüft den Knoten gegen den Vertrag, kompiliert den Stack erneut aus der eigenen `.env` des Deployments und lehnt einen ab, der vom vorbereiteten Stack abweicht, und plant, wendet an und liest dann jede Instanz zurück. Prüfe den Plan vor dem ersten Anwenden:

```bash
tale --json deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan-only > plan.json

tale --json --yes deploy --bundle "$TALE_DEPLOY_BUNDLE" \
  --cli-ref "$TALE_CLI_COMMIT" --plan plan.json
```

`--plan` wendet den geprüften Plan nur an, solange der Knoten noch genau ihn braucht, und `--stop` nimmt die Ausfallzeit an, die ein Plan nennt. Instanzen heißen wie ihre Dienste (`db`, `proxy`, `switch`), bei den Anwendungsrollen mit einer Replik-Nummer (`platform-1`, `backend-api-1`, `backend-worker-1`).

Eine Rolle mit einer einzigen Replik hat bei jedem Ersetzen eine Lücke: Vom Stopp der alten Instanz, bis die neue zugelassen ist, hat der Switch keine Replik, an die er senden kann, und der Edge liefert seine Wartungsseite aus, wie beim Neuerstellen durch Docker Compose. Der Plan nennt dieses Fenster für jede Rolle, die er mit einer einzigen Replik ersetzt.

## Logs und Abstürze lesen {#logs}

Incus bewahrt die Konsolenausgabe jeder Instanz auf und gibt jede Zeile nur einmal heraus: Ein Lesen nimmt die Zeilen, die es zeigt, sodass ein späteres Lesen der laufenden Instanz sie nicht mehr hat. In einem Workspace liest `tale logs <dienst>` einen gestoppten Dienst; für einen laufenden braucht es `--consume` und sagt vorher, dass das Lesen die Zeilen nimmt. Bei einem verwalteten Deployment liest du einen Dienst als Administrator mit dem Incus-Client, etwa `incus console db --show-log --project tale-example`, und nur, wenn du es brauchst. Was die Konsole nach vielen Lesevorgängen oder nach einem langen Lauf noch enthält, ist nicht gemessen: Verlass dich für einen ganzen Lauf nicht darauf, und leite Logs anderswohin, wenn du sie aufbewahren musst.

Incus startet eine Instanz, die unerwartet endet, innerhalb einer Minute bis zu zehnmal neu und lässt sie danach gestoppt, wo Docker es weiter versucht. `tale status` meldet einen solchen Dienst als `stopped after repeated crashes`, mit den letzten Konsolenzeilen, die Incus behalten hat, und `incus list --project <projekt>` zeigt ihn als gestoppt. Sobald du die Ursache behoben hast, startest du ihn in einem Workspace mit `tale start` wieder, sonst mit `incus start <instanz> --project <projekt>`.

## Das Herunterfahren des Hosts einplanen {#host-shutdown}

Fährt der Host herunter, stoppt Incus eine `boot.stop.priority`-Gruppe nach der anderen und gibt jeder Gruppe bis zu 30 Sekunden. Tale nutzt drei Gruppen:

| Priorität | Dienste | Gestoppt |
| --- | --- | --- |
| 90 | `proxy`, `switch`, `platform`, `backend-api`, `backend-worker` | Zuerst |
| 50 | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` | Als Zweites |
| 10 | `db`, `knowledge-db`, `object-store`, `names`, `names-sessions` | Zuletzt |

Auf einem Host, der nur Tale betreibt, erhalten die Datenbanken ihr Stoppsignal innerhalb von etwa 60 Sekunden. Die Prioritäten 10 bis 90 sind Tales reservierter Bereich: Jede andere Instanz auf dem Host, die darin stoppt, kostet bis zu 30 Sekunden pro Gruppe, und die Datenbanken können beendet werden, bevor ihr Signal kommt. Der Bootstrap warnt, wenn ein anderes Projekt eine Priorität in diesem Bereich nutzt. Die Grenze von 30 Sekunden verkürzt auch das Abarbeiten eines Workers (`SHUTDOWN_DRAIN_MS`, standardmäßig 90 Sekunden).

Auf einem geteilten Host, oder immer wenn die Worker ihre Arbeit abschließen müssen, stoppst du den Stack selbst, bevor der Host herunterfährt. In einem Workspace erledigt das `tale stop` Gruppe für Gruppe wie in der Tabelle, jeden Dienst innerhalb seiner eigenen Schonfrist, und `tale start` startet die Gruppen in umgekehrter Reihenfolge, sobald der Host wieder läuft, jede gesund vor der nächsten. Ein verwaltetes Deployment stoppst du mit dem Incus-Client, Gruppe für Gruppe und mit einem Timeout über der Schonfrist der Dienste, etwa `incus stop proxy switch platform-1 backend-api-1 backend-worker-1 --project tale-example --timeout 150`, dann die mittlere Gruppe, dann die Datengruppe. Incus stellt beim Start des Hosts den letzten Zustand jeder Instanz wieder her, gestoppte Instanzen bleiben also gestoppt, bis du sie startest: mit `tale start` oder von Hand, zuerst Priorität 10, dann 50, dann 90.

## Einen Host mit Docker teilen {#docker-coexistence}

Läuft Docker auf demselben Host, setzt es die `FORWARD`-Richtlinie des Hosts auf Verwerfen, und damit verwirft der Host auch den Verkehr der Incus-Bridges. `tale incus check` kann die Firewall des Hosts mit seinem eingeschränkten Zertifikat nicht lesen, zeigt den Verlust deshalb als Proben, die in ein Timeout laufen, und nennt zwei Abhilfen:

- **`DOCKER-USER`-Regeln**, die die beiden Bridges zulassen, wirken sofort. Der Bootstrap liest die Richtlinie und schlägt sie vor. Er fragt immer, bevor er sie hinzufügt, und ohne Terminal gibt er sie aus, damit du sie selbst ausführst. Sie halten bis zum nächsten Neustart des Hosts, es sei denn, deine Firewall-Einrichtung bewahrt sie.
- **`"ip-forward-no-drop": true`** in `/etc/docker/daemon.json` hält Docker davon ab, die Richtlinie auf Verwerfen zu setzen, aber erst nach einem Neustart des Hosts: Ein Neustart von Docker lässt die Richtlinie, wie sie ist.

Füge zuerst die `DOCKER-USER`-Regeln hinzu und bewahre sie in deiner Firewall-Einrichtung, oder setze `ip-forward-no-drop` für den nächsten Neustart.

Mit dem Eingang `proxy-device` darf Docker die Ports 80 und 443 nicht zusätzlich veröffentlichen. Incus nimmt die Proxy-Geräte auch an, während ein Docker-Container dieselben Ports veröffentlicht, und sie übernehmen den Verkehr von außen sofort, ohne dass ein Fehler dich warnt. Auch `tale incus check` sieht Docker nicht; [`tale runtime migrate`](#migrate) prüft die veröffentlichten Ports von Docker, bevor es die Proxy-Geräte hinzufügt.

## Einen Workspace zwischen Docker und Incus umziehen {#migrate}

`tale runtime migrate` zieht das laufende Docker-Deployment eines Workspace auf Incus um, in derselben Version und mit derselben `.env`, und lässt den Docker-Stack gestoppt stehen, damit du zurückkannst. Für die Nutzer fällt der Dienst aus, sobald der Docker-Stack stoppt, bis der Stack auf Incus ausgerollt ist; die meiste Zeit kostet das Archivieren und Wiederherstellen der Daten, allen voran des Objektspeichers. Plane dafür ein Wartungsfenster ein und halte ein Backup außerhalb des Hosts bereit, wie [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore) es beschreibt.

<Steps>

<Step title="Das Ziel festlegen">

Lass `runtime.engine`, wie es ist, und füge die Incus-Laufzeit als `runtime.next` hinzu, mit denselben Feldern wie ein Incus-Workspace (ein /24 als `block`). Führe den Umzug mit der CLI der Version aus, die der Workspace betreibt: Er zieht eine Version so um, wie sie ist, und lehnt eine CLI ab, die eine andere ausrollen würde.

```json
{
  "runtime": {
    "next": {
      "engine": "incus",
      "incus": {
        "project": "tale-acme",
        "pool": "tank",
        "network": { "name": "tale-acme", "subnet": "10.30.0.0/24", "gateway": "10.30.0.1", "block": "10.30.0.0/24" },
        "sessions": { "subnet": "10.31.0.0/24" },
        "ingress": { "mode": "proxy-device" }
      }
    }
  }
}
```

</Step>

<Step title="Den Knoten vorbereiten">

`tale incus bootstrap`, `check` und `contract` lesen `runtime.next`, solange der Workspace noch auf Docker läuft. Füge auf demselben Host die `DOCKER-USER`-Regeln hinzu, die der Bootstrap vorschlägt, wie unter [Einen Host mit Docker teilen](#docker-coexistence) beschrieben, und führe die Prüfung aus, bis sie besteht:

```bash
sudo tale incus bootstrap
tale incus check
```

</Step>

<Step title="Umziehen">

```bash
tale runtime migrate --to incus
```

Der Umzug prüft den Knoten erneut, mit den Weiterleitungsproben, und bricht auf einem Host ab, auf dem die Firewall von Docker den Verkehr der Bridges noch verwirft. Dann arbeitet er Backend und Sandbox ab und stoppt jeden Container des Docker-Stacks, auch den Proxy. Er archiviert die Docker-Volumes, exportiert den Snapshot und importiert ihn in das `backups`-Volume des Incus-Stacks, wobei er jedes Archiv per SHA-256 prüft. Er stellt den Snapshot in frische Incus-Volumes wieder her und rollt dieselbe Version auf Incus aus. Vor diesem Ausrollen liest er die Ports jedes laufenden Docker-Containers und bricht ab, solange einer noch Port 80 oder 443 veröffentlicht. Danach führt er die öffentlichen Smoke-Checks gegen den neuen Edge aus und setzt `runtime.engine` auf `incus`.

Jeder Schritt wird in `.tale/migration.json` festgehalten. Bricht ein Lauf ab, behebst du die gemeldete Ursache und führst denselben Befehl erneut aus: Er macht nach dem letzten abgeschlossenen Schritt weiter. Solange ein Umzug läuft, lehnen `tale deploy`, `tale start` und `tale rollback` ab.

</Step>

<Step title="Annehmen oder zurückrollen">

Melde dich an, öffne eine bekannte Unterhaltung und lade eine alte Datei unter der Adresse der Seite herunter. Die Docker-Container bleiben gestoppt, auch nach einem Neustart von Docker oder des Hosts: Ihre Neustart-Richtlinie `unless-stopped` lässt einen ausdrücklich gestoppten Container unten. Dann entscheidest du:

- `tale runtime migrate --to docker` rollt zurück: Es löscht die Incus-Instanzen (ihre Volumes bleiben), setzt `runtime.engine` wieder auf `docker` und startet den gestoppten Docker-Stack auf den Daten, die er hatte. Was Nutzer seit dem Umzug auf Incus geändert haben, kommt nicht zu Docker zurück.
- `tale runtime migrate --finish` entfernt den gestoppten Docker-Stack, seine Container und Daten-Volumes, und behält sein `backups`-Volume. Es fragt vorher (`--yes` überspringt die Frage); danach kannst du nicht mehr zurückrollen.

</Step>

</Steps>

Die Smoke-Checks erreichen den neuen Edge unter `SITE_URL`. NAT-Proxy-Geräte nehmen keinen Verkehr an, den der Host an seine eigene Loopback-Adresse schickt, deshalb wird eine Seite unter einem Loopback-Namen (`http://localhost`) an der eigenen Adresse des Incus-Edge geprüft. Für einen Umzug auf **einen anderen Host** nennst du die Incus-API des neuen Hosts in `runtime.next.incus.endpoint`, bereitest diesen Knoten vor, wie unter [Den Knoten vorbereiten](#node-contract) beschrieben, und legst die beiden Zertifikatsverzeichnisse in `.tale/` des Workspace ab. Übergib `--smoke-url` mit einer Adresse, die den Edge des neuen Hosts erreicht, bevor DNS umzieht, und ändere DNS nach dem Umzug. Die Schritte zu Firewall und Ports auf demselben Host entfallen dort.

**Nach `--finish` von Incus zurück zu Docker.** Dann hält dir nichts mehr einen Docker-Stack bereit, also trägst du die Daten in einem Snapshot hinüber: Lege auf Incus einen Snapshot an und exportiere ihn, importiere und stelle ihn dann in einem Docker-Workspace mit derselben `.env` und derselben Version wieder her und rolle diese Version dort aus. [Einen Snapshot auf einen anderen Host oder eine andere Laufzeit bringen](/de/self-hosted/operate/backups-and-restore#export-import) beschreibt die Befehle.

## Die aktuellen Grenzen kennen {#limits}

- Ein geändertes verwaltetes Deployment wird auf Incus abgelehnt: Sein Upgrade braucht einen Wiederherstellungs-Snapshot, den der verwaltete Weg auf Incus noch nicht anlegen kann. Ein Workspace legt vor jedem Upgrade seinen nativen Snapshot an.
- `observe` bleibt bei seiner Dateisystem-Inventur stehen, und `accept` hat auf Incus keinen privaten Ursprung, den es anwählen kann.
- Ein verwalteter nativer Client wird beim ersten Deployment angelegt, aber der Aufruf meldet einen Fehler, und das nächste Deployment lehnt den Client ab.
- `tale stop`, `tale start` und `tale logs` funktionieren in einem Workspace; ein verwaltetes Deployment hat auf Incus keinen davon.
- Ein Stack läuft auf einem Incus-Server; Incus-Cluster werden abgelehnt.
- `tale dev` und verbundene Sandbox-Geräte laufen nur auf Docker.

## Verifizierter Umfang {#verified-scope}

Die End-to-End-Suites der CLI für Incus führen die kompilierte CLI, aus der Änderung gebaut, gegen einen echten Incus-7.6-Knoten mit ZFS-Pool, dem Eingang `routed` und `tlsMode: "external"` aus, mit den Images des Stacks aus demselben Checkout.

Für ein verwaltetes Deployment decken sie ab: den Bootstrap, einen zweiten Bootstrap, der nichts ändert, und die Prüfung mit ihren Proben; `deploy prepare` ohne Docker, den Plan des ersten Deployments und das Deployment selbst, wobei der Stack über seinen Edge antwortet; einen leeren Plan und ein zweites Deployment, das nichts ändert; die Ablehnung eines Upgrades ohne Wiederherstellungs-Snapshot; Logs, die einmal gelesen werden, Absturzschleifen, die mit ihrer Konsole gemeldet werden, einen sauberen Stopp von Postgres und einen abarbeitenden Stopp des Workers; eine Session, die die Backend-API und das Modell-Gateway erreicht und sonst nichts; und kein Geheimnis in irgendeiner Ausgabe.

Für einen Workspace mit zwei Repliken von `platform` und `backend-api` decken sie ab: 20 Farbwechsel zwischen zwei Releases unter stetigem Verkehr über den Edge, ohne eine fehlgeschlagene Anfrage; offene Event-Streams, die durch das Zurückziehen offen bleiben und sich mit der neuen Farbe neu verbinden; Switch und Resolver des älteren Releases, die weiterlaufen, bis `--stop` sie ersetzt; ein rollierendes Ersetzen mit `--services` und ein Rollback; einen unterbrochenen Farbwechsel, den das nächste Deployment abschließt; einen nativen Snapshot, sein Archiv, Export und Import, eine Wiederherstellung und ihre Historie; eine an jedem Schritt unterbrochene Wiederherstellung, die `tale deploy` und `tale start` ablehnen, bis `--resume` oder `--abort` sie abschließt; ein `reset --all`, das die Snapshots behält; und eine Replik, die neu startet, während sie zurückgezogen ist.

Ein Umzug von Docker auf demselben Host lief auf einem Lab-Host mit Docker 29 neben Incus 7.6 und dem Eingang `proxy-device`, mit seinem Zurückrollen, einem zweiten Umzug und `--finish`. Der Eingang `proxy-device` in den Suites, Zertifikate von Let's Encrypt, `accept` und `observe`, die Länge des Ersetzungsfensters eines verwalteten Deployments, ein Neustart oder Herunterfahren des Hosts, ein Neustart von Docker nach einem Umzug, ein Umzug auf einen anderen Host und ein mit anderen Projekten geteilter Host waren nicht Teil dieser Läufe.
