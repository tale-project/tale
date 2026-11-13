---
title: Tale auf Incus betreiben
description: Betreibe ein verwaltetes Tale-Deployment als Incus-Instanzen statt als Docker-Compose-Container, vom Knotenvertrag und seiner Prüfung bis zu den Grenzen, die du einplanen musst.
---

Ein verwaltetes Deployment kann statt auf Docker Compose auf [Incus](https://linuxcontainers.org/incus/) laufen: Jeder Dienst des Stacks wird zu einer Incus-Instanz in einem eingeschränkten Projekt eines Linux-Hosts, und die Sandbox-Sessions laufen daneben in einem eigenen Projekt. Die Tale-CLI kompiliert dafür die `compose.yml` des Releases selbst, sodass Dienste, Images und Einstellungen dieselben sind wie unter der Docker-Laufzeit. Diese Seite führt dich von einem Incus-Host zu einem laufenden Deployment und nennt die Grenzen, die du einplanen musst.

<Warning>

Die Incus-Laufzeit ist in Tale 0.5.x **experimentell**. Docker Compose bleibt der Standard und die unterstützte Laufzeit. Auf Incus läuft nur der Weg der [verwalteten Deployments](/de/self-hosted/install/cli-install#managed-deployments): Einen Workspace, der die Incus-Laufzeit festlegt, lehnen `tale deploy`, `tale status` und die anderen Stack-Befehle ab, und ein Upgrade eines laufenden Deployments auf Incus wird abgelehnt, bis die CLI dort ihren Wiederherstellungs-Snapshot anlegen kann.

</Warning>

## Die Incus-Laufzeit wählen {#choose-incus}

Wähle Incus, wenn ein Host Incus bereits für andere Workloads betreibt oder wenn du den Stack und seine Sessions ohne Docker-Daemon in eingeschränkten Incus-Projekten haben willst. Die CLI spricht über die REST-API mit Incus, mit einem Client-Zertifikat, das auf das Projekt des Stacks beschränkt ist, und braucht Administratorrechte auf dem Host nur für den einmaligen Bootstrap. Bleib bei Docker Compose, wenn du einen Workspace mit `tale deploy` betreibst, lokal mit `tale dev` entwickelst, das nur auf Docker läuft, oder verbundene Sandbox-Geräte brauchst.

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

Weder der Host noch die Maschine, die das Bundle vorbereitet, braucht Docker. Läuft Docker trotzdem auf demselben Host, lies [Einen Host mit Docker teilen](#docker-coexistence).

## Die Laufzeit festlegen {#declare}

Die Deployment-Spezifikation nennt die Laufzeit in `runtime.engine` und beschreibt den Knoten in `runtime.incus`. Die Felder sind dieselben wie bei einem Workspace und stehen unter [Die Container-Laufzeit festlegen](/de/self-hosted/install/cli-install#container-runtime); [Die Incus-Laufzeit festlegen](/de/self-hosted/install/cli-install#managed-incus-runtime) ergänzt, was ein verwaltetes Deployment verlangt. Ein verwaltetes Deployment ersetzt jeden Dienst an Ort und Stelle und hat keine blauen und grünen Farben, deshalb ist sein Adressblock `block` ein /25 innerhalb des Bridge-Subnetzes.

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

Der Knotenvertrag beschreibt, was der Incus-Server enthalten muss, bevor der Stack laufen kann: das Projekt mit seinen Einschränkungen und Limits, das Profil des Stacks, die Bridge, die Netzwerk-ACLs, Pool und Volume-Größen, die Registry-Hosts, das zu vertrauende Zertifikat und die Stopp-Prioritäten. Drei Befehle arbeiten damit, jeweils mit `--spec <datei> --compose <datei>`, wobei `--compose` die `runtime/compose.yml` des Bundles ist. Bereite also zuerst das Bundle vor.

<Steps>

<Step title="Den Vertrag ausgeben">

`tale incus contract` gibt ihn als versioniertes JSON aus (`schemaVersion` 1, `kind` `tale.incus.node-contract`). Der Befehl liest keinen Knoten und braucht keine Zugangsdaten, sodass deine eigenen Werkzeuge die Objekte daraus anlegen können. Eine neuere CLI ergänzt Version 1 nur um Felder.

```bash
tale incus contract --spec "$TALE_DEPLOY_SPEC" \
  --compose "$TALE_DEPLOY_BUNDLE/runtime/compose.yml"
```

</Step>

<Step title="Einen einzelnen Host bootstrappen">

Auf einem Host, den nur du verwaltest, setzt `tale incus bootstrap` den Vertrag über den lokalen Socket um (`/var/lib/incus/unix.socket`; `--socket` nennt einen anderen). Der Befehl zeigt seinen Plan und fragt, bevor er etwas ändert (`--yes` überspringt die Frage). Er legt das Projekt des Stacks an, sein Profil `tale-stack`, die Bridge und ihre ACL, Projekt, Bridge, ACL und Profil `sandbox` der Sessions sowie zwei auf ihre Projekte beschränkte Client-Zertifikate: das der CLI in `<stateDirectory>/incus/` und das des Spawners in `<stateDirectory>/sandbox-incus/`, jeweils neben dem gepinnten `server.crt`. Ein zweiter Lauf ändert nichts, und `--remove` entfernt, was der Bootstrap angelegt hat, und sonst nichts. Lässt sich das eigene Zertifikat des Servers nicht pinnen, bricht der Bootstrap ab; `--replace-server-certificate` schreibt ein pinnbares, behält das alte als `server.crt.tale-bootstrap` und bittet dich, Incus neu zu starten, bevor du den Bootstrap erneut ausführst.

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

Das sind Obergrenzen, keine Reservierungen. Der Vertrag addiert sie für die Spitzenlast des Stacks: jede Instanz einmal, weil ein verwaltetes Deployment an Ort und Stelle ersetzt, dazu zwei Hilfsinstanzen (ein einmaliger Job und die Probe von `check`). Der Root-Datenträger jeder Instanz ist `runtime.incus.rootSize` groß (standardmäßig `10GiB`). Lege für jedes Daten-Volume in `runtime.incus.volumes` eine `size` fest: Nur wenn jedes Volume eine hat, begrenzt der Vertrag auch, wie viel vom Pool das Projekt nutzen darf (`limits.disk.pool.<pool>`). Sessions werden getrennt bemessen, über `SANDBOX_MAX_SESSIONS` und die Session-Limits in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure); lass auf dem Host Platz für beides.

## Ausrollen {#deploy}

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

Incus bewahrt die Konsolenausgabe jeder Instanz auf und gibt jede Zeile nur einmal heraus: Ein Lesen nimmt die Zeilen, die es zeigt, sodass ein späteres Lesen der laufenden Instanz sie nicht mehr hat. Lies einen Dienst als Administrator mit dem Incus-Client, etwa `incus console db --show-log --project tale-example`, und nur, wenn du es brauchst. Was die Konsole nach vielen Lesevorgängen oder nach einem langen Lauf noch enthält, ist nicht gemessen: Verlass dich für einen ganzen Lauf nicht darauf, und leite Logs anderswohin, wenn du sie aufbewahren musst.

Incus startet eine Instanz, die unerwartet endet, innerhalb einer Minute bis zu zehnmal neu und lässt sie danach gestoppt, wo Docker es weiter versucht. `incus list --project <projekt>` zeigt eine solche Instanz als gestoppt. Ihre Konsole enthält noch die Zeilen, die kein Lesen genommen hat; starte sie mit `incus start <instanz> --project <projekt>` wieder, sobald du die Ursache behoben hast.

## Das Herunterfahren des Hosts einplanen {#host-shutdown}

Fährt der Host herunter, stoppt Incus eine `boot.stop.priority`-Gruppe nach der anderen und gibt jeder Gruppe bis zu 30 Sekunden. Tale nutzt drei Gruppen:

| Priorität | Dienste | Gestoppt |
| --- | --- | --- |
| 90 | `proxy`, `switch`, `platform`, `backend-api`, `backend-worker` | Zuerst |
| 50 | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway`, `bgutil-provider` | Als Zweites |
| 10 | `db`, `knowledge-db`, `object-store`, `names`, `names-sessions` | Zuletzt |

Auf einem Host, der nur Tale betreibt, erhalten die Datenbanken ihr Stoppsignal innerhalb von etwa 60 Sekunden. Die Prioritäten 10 bis 90 sind Tales reservierter Bereich: Jede andere Instanz auf dem Host, die darin stoppt, kostet bis zu 30 Sekunden pro Gruppe, und die Datenbanken können beendet werden, bevor ihr Signal kommt. Der Bootstrap warnt, wenn ein anderes Projekt eine Priorität in diesem Bereich nutzt. Die Grenze von 30 Sekunden verkürzt auch das Abarbeiten eines Workers (`SHUTDOWN_DRAIN_MS`, standardmäßig 90 Sekunden).

Auf einem geteilten Host, oder immer wenn die Worker ihre Arbeit abschließen müssen, stoppst du den Stack selbst, bevor der Host herunterfährt, Gruppe für Gruppe wie in der Tabelle und mit einem Timeout über der Schonfrist der Dienste, etwa `incus stop proxy switch platform-1 backend-api-1 backend-worker-1 --project tale-example --timeout 150`, dann die mittlere Gruppe, dann die Datengruppe. Incus stellt beim Start des Hosts den letzten Zustand jeder Instanz wieder her, von Hand gestoppte Instanzen bleiben also gestoppt: Starte sie selbst wieder, zuerst Priorität 10, dann 50, dann 90.

## Einen Host mit Docker teilen {#docker-coexistence}

Läuft Docker auf demselben Host, verwirft dessen `FORWARD`-Richtlinie den Verkehr der Incus-Bridges. `tale incus check` zeigt das als Proben, die in ein Timeout laufen. Der Bootstrap liest die Richtlinie und schlägt `DOCKER-USER`-Regeln vor, die die beiden Bridges zulassen. Er fragt immer, bevor er sie hinzufügt, und ohne Terminal gibt er sie aus, damit du sie selbst ausführst. Sie halten bis zum nächsten Neustart des Hosts, es sei denn, deine Firewall-Einrichtung bewahrt sie; `"ip-forward-no-drop": true` in `/etc/docker/daemon.json` ist die dauerhafte Abhilfe nach einem Neustart. Mit dem Eingang `proxy-device` darf Docker die Ports 80 und 443 nicht zusätzlich veröffentlichen.

## Die aktuellen Grenzen kennen {#limits}

- Ein geändertes bestehendes Deployment wird abgelehnt: Ein Upgrade braucht einen Wiederherstellungs-Snapshot, den die CLI auf Incus noch nicht anlegen kann. Backups und Wiederherstellungen eines Deployments auf Incus gibt es ebenfalls noch nicht.
- `observe` bleibt bei seiner Dateisystem-Inventur stehen, und `accept` hat auf Incus keinen privaten Ursprung, den es anwählen kann.
- Ein verwalteter nativer Client wird beim ersten Deployment angelegt, aber der Aufruf meldet einen Fehler, und das nächste Deployment lehnt den Client ab.
- Für Incus gibt es noch kein `tale stop` oder `tale start` und für ein verwaltetes Deployment kein `tale logs`.
- Ein Stack läuft auf einem Incus-Server; Incus-Cluster werden abgelehnt.

## Verifizierter Umfang {#verified-scope}

Die End-to-End-Suites der CLI für Incus führen die kompilierte CLI, aus der Änderung gebaut, gegen einen echten Incus-7.6-Knoten mit ZFS-Pool, dem Eingang `routed` und `tlsMode: "external"` aus, mit den Images des Stacks aus demselben Checkout: den Bootstrap, einen zweiten Bootstrap, der nichts ändert, und die Prüfung mit ihren Proben; `deploy prepare` ohne Docker, den Plan des ersten Deployments und das Deployment selbst, wobei der Stack über seinen Edge antwortet; einen leeren Plan und ein zweites Deployment, das nichts ändert; die Ablehnung eines Upgrades ohne Wiederherstellungs-Snapshot; Logs, die einmal gelesen werden, Absturzschleifen, die mit ihrer Konsole gemeldet werden, einen sauberen Stopp von Postgres und einen abarbeitenden Stopp des Workers; eine Session, die die Backend-API und das Modell-Gateway erreicht und sonst nichts; und kein Geheimnis in irgendeiner Ausgabe. Der Eingang `proxy-device`, Zertifikate von Let's Encrypt, `accept` und `observe`, die Länge des Ersetzungsfensters, ein Neustart oder Herunterfahren des Hosts, ein mit Docker oder anderen Projekten geteilter Host und mehr als eine Replik pro Rolle waren nicht Teil dieser Läufe.
