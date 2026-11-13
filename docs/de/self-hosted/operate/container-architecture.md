---
title: Den betroffenen Dienst finden
description: Ordne Anfragen, Hintergrundarbeit und Sandbox-Ausführung den richtigen Protokollen zu und erkenne automatische Indexreparaturen.
---

Grenze eine Störung anhand der Dienstzuständigkeit ein, bevor du Container änderst. Der mitgelieferte Stack fasst Anwendungs- und Wissensdatenbank in `db` zusammen; Compose aus dem Quellcode kann `knowledge-db` separat betreiben. Prüfe deinen tatsächlichen Aufbau mit `tale status` oder der Dienstübersicht deines Orchestrators.

## Die ersten Protokolle auswählen

| Symptom | Hier beginnen | Danach prüfen |
| --- | --- | --- |
| Öffentliche URL oder TLS scheitert | `proxy` | DNS, Zertifikatszustand, öffentliche Ports und Erreichbarkeit der Zieldienste. |
| Die Oberfläche lädt nicht | `platform`, dann `proxy` | Web-Zustand, statische Dateien und gewählte Bereitstellungsversion. |
| Oberfläche lädt, Anmeldung oder Datenabfragen scheitern | `backend-api` | API-Zustand, Datenbankzugriff, Anfragefehler und Proxy-Routen. |
| Jobs, geplante Automatisierungen oder Importe kommen nicht weiter | `backend-worker` | Warteschlange, Job-Fehler, Zugangsdaten und benötigte Speicher. |
| Lesen oder Schreiben scheitert an vielen Stellen | `db` oder die externe Anwendungsdatenbank | Verbindung, Plattenplatz, Sperren und Datenbankprotokolle. |
| Dateien lassen sich nicht hoch- oder herunterladen | `backend-api`, danach `object-store` oder externer Bucket | Aufgelöste Organisationsverbindung, Zugangsdaten, öffentlicher Endpunkt und Browser-CORS. |
| Eine Agent-Laufzeit startet nicht oder erreicht ihr Modell nicht | `sandbox`, `sandbox-llm-gateway` | Sitzungserstellung, Gateway-Anmeldung, Modellverfügbarkeit und Laufzeit-Image. |
| Sandbox-Netzzugriff oder Seitenrendering scheitert | `sandbox-egress`, `sandbox` | Zielhost, erlaubte Ports, Egress-Regeln und Sitzungsprotokolle. |
| Videotranskript wird nicht abgerufen | `backend-worker`, `bgutil-provider` | Videozugriff, Extraktionsfehler, konfigurierter Proxy und Browsersitzungsstatus. |

Nutze logische Dienstnamen mit `tale logs <service>`. Für deinen eigenen Compose-Stack gilt `docker compose logs --tail=200 <service>`. Erzeugte Containernamen können Projekt, Farbe und Replikatnummer enthalten.

## Einer interaktiven Chatanfrage folgen

1. Der Browser erreicht `proxy`. Webdateien gehen an `platform`, Anwendungs- und Anmeldeanfragen an `backend-api`.
2. Die API prüft Sitzung und Organisation, ermittelt Modell und Zugangsdaten und führt den interaktiven Turn aus. Fortschritt wird in der Anwendungsdatenbank gespeichert.
3. Der Browser liest Fortschritt über den Stream-Endpunkt des Chats. `/events` liefert Hinweise zum erneuten Laden von Daten und enthält nicht den Token-Stream.
4. Wissenswerkzeuge verwenden die Wissensverbindung der anfragenden Organisation. Originaldateien werden über deren Speicherkonfiguration gelesen.
5. Ein Turn mit einer Agent-Laufzeit benötigt eine Sandbox-Sitzung und das Modell-Gateway. Eingereihte Aufgaben, Workflow-Agent-Jobs und REST-Chat-Turns können außerdem Worker benötigen.

Ein Worker-Ausfall hat daher einen anderen Umfang als ein API-Ausfall. Daraus folgt aber nicht, dass sämtliche Chat- oder Agentenarbeit weiterläuft. Prüfe Einstiegspunkt und Ausführungstyp des betroffenen Ablaufs. Sichere den ursprünglichen Fehler, bevor du einen Turn wiederholst, der Tokens verbrauchen oder externe Aktionen ausführen könnte.

## Abhängigkeiten der Sandbox verstehen

`sandbox` ist ein Spawner mit Zugriff auf den Docker-Daemon des Hosts. Er erstellt vorübergehende Container aus dem festgelegten Sandbox-Runtime-Image und bindet deren Arbeitsverzeichnisse ein. Diese Sitzungen verwenden ein isoliertes Netzwerk: Webanfragen laufen über `sandbox-egress`, Modellaufrufe über den begrenzten Sitzungszugriff des Gateways.

Die Laufzeit stellt auch Chromium und Playwright für Seitenrendering und Dokumenterzeugung bereit. Eine funktionierende Weboberfläche beweist daher nicht, dass die Ausführungsebene funktioniert. Prüfe Image-Verfügbarkeit, Workspace-Mounts, gemeinsames Sandbox-Token und Gateway-Zugangsdaten, bevor du ein einzelnes Skript untersuchst.

Der Egress-Dienst blockiert private Adressen und Metadatenziele und kann eine Hostnamen-Freigabeliste erzwingen. Ein ausgefallener Ausgang kann Verweigerungen oder Netzwerkfehler verursachen; die genaue Meldung hängt von der Operation ab. [Härtung](/de/self-hosted/operate/security/hardening) beschreibt die Regeln, [Compose selbst betreiben](/de/self-hosted/install/own-compose) die nötigen Rechte und Mounts.

## Sitzungen über einen Docker-Neustart erhalten

Sandbox-Sitzungen und der Spawner laufen als Container des Docker-Daemons auf dem Host. Ohne Live Restore des Daemons stoppt ein Neustart, etwa für ein Paket-Upgrade oder eine Änderung an `/etc/docker/daemon.json`, alle diese Container: Laufende Agent-Turns, Builds und Seitenrenderings brechen ab, ihre Arbeitsverzeichnisse bleiben erhalten. Tale ändert die Daemon-Konfiguration des Hosts nicht; der Spawner protokolliert beim Start eine Warnung, solange Live Restore ausgeschaltet ist.

Zum Einschalten ergänzt du die Einstellung in `/etc/docker/daemon.json` und behältst die übrigen Einträge der Datei:

```json
{
  "live-restore": true
}
```

Lade den Daemon danach mit `sudo systemctl reload docker` neu, oder sende auf einem Host ohne systemd `SIGHUP` an `dockerd`. Das Neuladen übernimmt die Einstellung, ohne Container zu stoppen. Live Restore hält Container über einen Daemon-Neustart und ein Patch-Release-Upgrade hinweg am Laufen; ein Upgrade auf eine neue Docker-Release-Linie kann sie trotzdem stoppen, plane es deshalb wie ein Wartungsfenster. Live Restore ist mit dem Swarm-Modus nicht vereinbar: Plane Daemon-Neustarts auf einem Swarm-Knoten stattdessen als Wartung ein. [Dockers Anleitung zu Live Restore](https://docs.docker.com/engine/daemon/live-restore/) nennt die übrigen Grenzen.

## Den Stack unter der Incus-Laufzeit verfolgen {#incus-layout}

Unter der experimentellen [Incus-Laufzeit](/de/self-hosted/install/incus) laufen dieselben Dienste als Incus-Instanzen in einem eingeschränkten Projekt, und einige Instanzen, die Docker nicht braucht, übernehmen die Aufgaben des Docker-Netzwerks:

| Instanz | Was sie unter Incus tut | Wo Docker das erledigt |
| --- | --- | --- |
| `names` | Der Resolver des Stacks: Er beantwortet die Namen der Dienste mit ihren festen Adressen auf der Bridge und leitet jeden anderen Namen an das eigene DNS der Bridge weiter. Jede Instanz des Stacks fragt ihn. | Das eingebaute DNS von Docker |
| `names-sessions` | Der Resolver der Sessions: Er beantwortet nur die Namen, die eine Session erreichen darf. | Das DNS des Sandbox-Netzes |
| `switch` | Eine zweite Instanz des Proxy-Images (`TALE_PROXY_ROLE=switch`). Die Namen `platform` und `backend-api` zeigen auf sie, und sie verteilt jeden über seine Repliken, die sie über eine eigene Probe zulässt (`/api/admission` auf der Plattform, `/admission` auf der Backend-API). Ein Ersetzen ändert deshalb nie eine Adresse. | Netzwerk-Aliasse, denen Repliken beitreten und die sie verlassen |

Eine Anfrage nimmt denselben Weg wie oben, mit dem Switch zwischen `proxy` und den Anwendungsrollen: Der Browser erreicht `proxy`, der Web-Assets an `platform` und Anwendungsanfragen an `backend-api` sendet, beide über `switch`. Den Dienst hinter einem Fehler findest du auf dieselbe Weise. Instanzen tragen den Namen ihres Dienstes, mit einer Replik-Nummer bei `platform-1`, `backend-api-1` und `backend-worker-1`, und ihre Konsolenausgabe liegt in Incus, nicht in Docker: [Logs und Abstürze lesen](/de/self-hosted/install/incus#logs).

Die Vertrauensgrenze wandert vom Docker-Socket zu zwei eingeschränkten Zertifikaten. Das der CLI erreicht nur das Projekt des Stacks, das des Spawners nur das Projekt der Sessions; keines kann ein Projekt anlegen oder ein anderes berühren, und eine Session hält keines. Das Projekt lässt keine privilegierten, verschachtelten oder Low-Level-Container und keine Host-Datenträger zu, und Netzwerk-ACLs auf beiden Bridges verwerfen, was keine Regel erlaubt. Sessions erreichen die Backend-API über `switch`, das Modell-Gateway, den Egress-Proxy und `names-sessions` und sonst nichts. Die [Netzwerk-ACLs](/de/self-hosted/install/incus#network-acls) nennen jede Regel.

## Reparaturen des Wissensindex erkennen

Ein beschädigter BM25-Index kann Importe scheitern lassen, obwohl die Dokumenttabellen noch lesbar sind. Das Backend prüft Wissensindizes mit `pdb.verify_index`. Ein Advisory Lock koordiniert Reparaturversuche pro Datenbank. Die Wissensdatenbank des Deployments prüft jeder Backend-Prozess bei seinem Start; organisationsspezifische Datenbanken werden bei ihrer ersten Verwendung geprüft.

| Ergebnis | Verhalten des Backends | Deine Reaktion |
| --- | --- | --- |
| Fehlerfrei | Normal weiterarbeiten. | Keine Reparatur nötig. |
| Beschädigter Index bis `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | Direkt neu aufbauen und erneut prüfen; die Standardgrenze beträgt 1 GiB. | Mit längerem Start rechnen und das Endergebnis prüfen. |
| Größerer beschädigter Index | Gleichzeitigen Neuaufbau im Hintergrund einplanen; betroffene Indexierung kann mit entsprechendem Grund warten. | Worker-Fortschritt und abschließende Prüfung beobachten. |
| Reparatur scheitert oder Zustand bleibt ungeklärt | Fehler festhalten; betroffene Korpusoperationen können unverfügbar bleiben. | Ursache, Datenbankrechte und Speicherzustand vor einer manuellen Reparatur prüfen. |
| Wissensdatenbank beim Start nicht erreichbar | Bis zu etwa einer Minute auf sie warten; danach ohne die Prüfung starten, eine Warnung protokollieren und einen Fehler melden. | Backend neu starten, sobald die Wissensdatenbank antwortet, damit die Prüfung läuft. |

Reparaturen können die Audit-Aktionen `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled` oder `knowledge_index_repair_failed` und Admin-Benachrichtigungen auslösen. Ein fehlgeschlagener Neuaufbau beweist keinen Verlust der Quelldokumente. Ein erfolgreicher Neuaufbau ersetzt kein Datenbank-Backup.

`KNOWLEDGE_INDEX_REPAIR_DISABLED=1` schaltet die automatische Prüfung ab und behebt keine Beschädigung. Wiederkehrende Schäden nach Neustarts erfordern eine Untersuchung des Herunterfahrens und des Speichers. Bevorzuge reguläres Stoppen mit der eingestellten Wartezeit statt erzwungenem Beenden. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) enthält die lesende Indexprüfung und Hinweise zur Wiederherstellung.
