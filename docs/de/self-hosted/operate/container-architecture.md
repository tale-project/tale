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
| Ein Harness startet nicht oder erreicht sein Modell nicht | `sandbox`, `sandbox-llm-gateway` | Sitzungserstellung, Gateway-Anmeldung, Modellverfügbarkeit und Laufzeit-Image. |
| Sandbox-Netzzugriff oder Seitenrendering scheitert | `sandbox-egress`, `sandbox` | Zielhost, erlaubte Ports, Egress-Regeln und Sitzungsprotokolle. |
| Videotranskript wird nicht abgerufen | `backend-worker`, `bgutil-provider` | Videozugriff, Extraktionsfehler, konfigurierter Proxy und Browsersitzungsstatus. |

Nutze logische Dienstnamen mit `tale logs <service>`. Für deinen eigenen Compose-Stack gilt `docker compose logs --tail=200 <service>`. Erzeugte Containernamen können Projekt, Farbe und Replikatnummer enthalten.

## Einer interaktiven Chatanfrage folgen

1. Der Browser erreicht `proxy`. Webdateien gehen an `platform`, Anwendungs- und Anmeldeanfragen an `backend-api`.
2. Die API prüft Sitzung und Organisation, ermittelt Modell und Zugangsdaten und führt den interaktiven Turn aus. Fortschritt wird in der Anwendungsdatenbank gespeichert.
3. Der Browser liest Fortschritt über den Stream-Endpunkt des Chats. `/events` liefert Hinweise zum erneuten Laden von Daten und enthält nicht den Token-Stream.
4. Wissenswerkzeuge verwenden die Wissensverbindung der anfragenden Organisation. Originaldateien werden über deren Speicherkonfiguration gelesen.
5. Ein Turn mit Coding-Harness benötigt eine Sandbox-Sitzung und das Modell-Gateway. Eingereihte Aufgaben, Workflow-Agent-Jobs und REST-Chat-Turns können außerdem Worker benötigen.

Ein Worker-Ausfall hat daher einen anderen Umfang als ein API-Ausfall. Daraus folgt aber nicht, dass sämtliche Chat- oder Agentenarbeit weiterläuft. Prüfe Einstiegspunkt und Ausführungstyp des betroffenen Ablaufs. Sichere den ursprünglichen Fehler, bevor du einen Turn wiederholst, der Tokens verbrauchen oder externe Aktionen ausführen könnte.

## Abhängigkeiten der Sandbox verstehen

`sandbox` ist ein Spawner mit Zugriff auf den Docker-Daemon des Hosts. Er erstellt vorübergehende Container aus dem festgelegten Sandbox-Runtime-Image und bindet deren Arbeitsverzeichnisse ein. Diese Sitzungen verwenden ein isoliertes Netzwerk: Webanfragen laufen über `sandbox-egress`, Modellaufrufe über den begrenzten Sitzungszugriff des Gateways.

Die Laufzeit stellt auch Chromium und Playwright für Seitenrendering und Dokumenterzeugung bereit. Eine funktionierende Weboberfläche beweist daher nicht, dass die Ausführungsebene funktioniert. Prüfe Image-Verfügbarkeit, Workspace-Mounts, gemeinsames Sandbox-Token und Gateway-Zugangsdaten, bevor du ein einzelnes Skript untersuchst.

Der Egress-Dienst blockiert private Adressen und Metadatenziele und kann eine Hostnamen-Freigabeliste erzwingen. Ein ausgefallener Ausgang kann Verweigerungen oder Netzwerkfehler verursachen; die genaue Meldung hängt von der Operation ab. [Härtung](/de/self-hosted/operate/security/hardening) beschreibt die Regeln, [Compose selbst betreiben](/de/self-hosted/install/own-compose) die nötigen Rechte und Mounts.

## Reparaturen des Wissensindex erkennen

Ein beschädigter BM25-Index kann Importe scheitern lassen, obwohl die Dokumenttabellen noch lesbar sind. Das Backend prüft Wissensindizes mit `pdb.verify_index`. Ein Advisory Lock koordiniert Reparaturversuche pro Datenbank. Organisationsspezifische Datenbanken werden bei ihrer ersten Verwendung geprüft.

| Ergebnis | Verhalten des Backends | Deine Reaktion |
| --- | --- | --- |
| Fehlerfrei | Normal weiterarbeiten. | Keine Reparatur nötig. |
| Beschädigter Index bis `KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES` | Direkt neu aufbauen und erneut prüfen; die Standardgrenze beträgt 1 GiB. | Mit längerem Start rechnen und das Endergebnis prüfen. |
| Größerer beschädigter Index | Gleichzeitigen Neuaufbau im Hintergrund einplanen; betroffene Indexierung kann mit entsprechendem Grund warten. | Worker-Fortschritt und abschließende Prüfung beobachten. |
| Reparatur scheitert oder Zustand bleibt ungeklärt | Fehler festhalten; betroffene Korpusoperationen können unverfügbar bleiben. | Ursache, Datenbankrechte und Speicherzustand vor einer manuellen Reparatur prüfen. |

Reparaturen können die Audit-Aktionen `knowledge_index_repaired`, `knowledge_index_rebuild_scheduled` oder `knowledge_index_repair_failed` und Admin-Benachrichtigungen auslösen. Ein fehlgeschlagener Neuaufbau beweist keinen Verlust der Quelldokumente. Ein erfolgreicher Neuaufbau ersetzt kein Datenbank-Backup.

`KNOWLEDGE_INDEX_REPAIR_DISABLED=1` schaltet die automatische Prüfung ab und behebt keine Beschädigung. Wiederkehrende Schäden nach Neustarts erfordern eine Untersuchung des Herunterfahrens und des Speichers. Bevorzuge reguläres Stoppen mit der eingestellten Wartezeit statt erzwungenem Beenden. [Fehlerbehebung](/de/self-hosted/operate/observability/troubleshooting) enthält die lesende Indexprüfung und Hinweise zur Wiederherstellung.
