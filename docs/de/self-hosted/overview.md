---
title: Architektur beim Selbsthosting
description: Verstehe Anwendungs-, Speicher- und Sandbox-Dienste, bevor du Bereitstellung und Betrieb von Tale planst.
---

Bei einer selbst gehosteten Tale-Instanz betreibst du Anwendung, Speicher und Sandbox-Dienste auf deiner Infrastruktur. Eine Instanz kann mehrere Organisationen enthalten; Datensätze und Konfiguration bleiben jeweils der zugehörigen Organisation zugeordnet.

Diese Übersicht hilft bei der Kapazitätsplanung und bei der Auswahl der zu sichernden Daten. [Compose selbst betreiben](/de/self-hosted/install/own-compose) beschreibt die erforderlichen Netzwerke, Mounts und Zustandsprüfungen. [Container-Architektur](/de/self-hosted/operate/container-architecture) hilft dir, Fehler im laufenden Betrieb einzugrenzen.

## Zusammenspiel der Dienste

Die mitgelieferte Bereitstellung auf einem Host umfasst acht Dienste, bevor Replikate und vorübergehende Sandbox-Sitzungen hinzukommen; die Anwendung ist einer davon. Laufen die Anwendungsrollen getrennt, kommen bis zu zwei hinzu, und der Stack für die Entwicklung kann eine eigene Wissensdatenbank verwenden. Vergleiche daher die Aufgaben der Dienste statt nur die Anzahl der Container.

| Ebene | Dienste | Aufgabe |
| --- | --- | --- |
| Öffentlicher Zugang | `proxy` | Caddy beendet TLS und leitet Browseranfragen an Web-Oberfläche, APIs und Dateispeicher weiter. |
| Anwendung | `platform`; dazu `backend-api` und `backend-worker`, wo die Rollen getrennt laufen | Die Web-Ebene liefert die Oberfläche. Die API authentifiziert Anfragen und führt Anwendungsoperationen aus. Worker bearbeiten Aufgaben, Automatisierungen und Importe aus der Warteschlange. Ein `platform`-Prozess ist alle drei zugleich, solange die Rollen nicht getrennt laufen. |
| Dauerhafter Speicher | `db`, `object-store` | Postgres speichert Anwendungs- und Wissensdaten; der S3-kompatible Speicher enthält Originaldateien und erzeugte Medien. |
| Sandbox-Ausführung | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Der Spawner erstellt Ausführungssitzungen, der Egress-Proxy kontrolliert ausgehende Anfragen und das Modell-Gateway stellt begrenzten Modellzugriff bereit. |
| Video-Unterstützung | `bgutil-provider` | Liefert Proof-of-Origin-Tokens für YouTube-Links. `tale deploy` startet ihn nur mit `VIDEO_INGEST_POT_PROVIDER=true`. |

Der Browser verbindet sich über den öffentlichen Proxy. Datenbank-, Gateway- und Sandbox-Ports sollten nicht öffentlich erreichbar sein. Bei einem externen Bucket können vorsignierte Dateianfragen direkt vom Browser an dessen öffentlichen Endpunkt gehen.

Die Anwendungsrollen verwenden dasselbe Tale-Platform-Image, und `TALE_ROLE` bestimmt, welche davon ein Container ausführt. Ein Workspace, den du mit `tale deploy` bereitstellst, startet `platform` mit `TALE_ROLE=all`: Ein Prozess ist Web-Ebene, API und Worker zugleich. Setzt du eine Replikatzahl für das Backend, laufen die Worker getrennt als `backend-worker` (`TALE_ROLE=worker`) neben einem `platform`, das Web-Ebene und API ist (`TALE_ROLE=api`); [Bereitstellung aktualisieren](/de/self-hosted/operate/upgrades#one-process) nennt die Variablen. Die Compose-Datei im Repository, die Kubernetes-Manifeste und die Incus-Laufzeit führen drei Dienste aus: `platform` nur als Web-Ebene, `backend-api` und `backend-worker`. Worker stellen keinen HTTP-Server bereit. Die Sandbox-Laufzeit ist ein separates Image für vorübergehende Sitzungscontainer und kein zusätzlicher dauerhaft laufender Compose-Dienst.

## Wo dauerhafte Daten liegen

| Speicherort im mitgelieferten Stack | Zu erhaltende Daten |
| --- | --- |
| `db-data` | `tale_app`: Nutzer, Chats, Läufe, Audit-Einträge und verschlüsselte Datenbankgeheimnisse. `tale_knowledge`: extrahierte Inhalte, Embeddings, Suchindizes und abgerufene Webseiten. |
| `config-data` | Konfigurationsdateien der Organisationen, darunter Agenten, Skills, Anbieterdefinitionen, Richtlinien, SSO-Einstellungen und Branding. |
| `blob-data` | Hochgeladene Dokumente, Anhänge, Audio und erzeugte Dateien. Eine Instanz, die vor versitygw installiert wurde, hält sie bis zu ihrem [Umzug](/de/self-hosted/operate/upgrades#blob-store) in `object-store-data`. |
| `caddy-data`, `caddy-config` | Zertifikate und Proxy-Zustand. |
| `llm-gateway-data` | Gateway-Konfiguration, Zugangsdaten für Sitzungen und das Anfrageprotokoll des Gateways mit Modell, Tokens und Dauer, ohne Prompts oder Antworten, standardmäßig drei Tage lang aufbewahrt. |

Im mitgelieferten Stack liegen beide Datenbanken in einem Postgres-Dienst. Der Netzwerkalias `knowledge-db` führt zur Wissensverbindung. Es bleiben zwei getrennte Datenbanken. Eine Bereitstellung aus dem Quellcode mit eigenem Wissensdienst besitzt zusätzlich `knowledge-db-data`.

Beim Ersetzen eines Containers bleiben Daten nur erhalten, wenn seine dauerhaften Volumes oder externen Speicher weiter eingebunden sind. Sichere auch den Bereitstellungsordner, die Umgebung, Verschlüsselungsschlüssel und Kopien außerhalb des Hosts. Die Snapshots der CLI erfassen diese Volumes, aber keine externen Speicher, und lassen das Datei-Volume aus, wenn der Bereitstellungsstandard auf einen externen Bucket zeigt; prüfe den Umfang unter [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore).

## Geheimnisse und Anmeldung

`ENCRYPTION_SECRET_HEX` schützt Anbieterzugangsdaten und andere verschlüsselte Werte in der Anwendungsdatenbank. SOPS und age schützen unterstützte Begleitdateien mit Geheimnissen, etwa Passwörter für externe Speicher. Sichere die benötigten Schlüssel getrennt von den geschützten Daten. Ein neuer Schlüssel entschlüsselt keine vorhandenen Geheimnisse.

Better Auth läuft im Backend. Lokale Anmeldung, Zwei-Faktor-Authentifizierung, Passkeys, Unternehmens-SSO und die Anmeldung über vertrauenswürdige Header haben unterschiedliche Voraussetzungen. [Authentifizierung](/de/self-hosted/configuration/authentication) erklärt die Einrichtung; [Mitglieder und Rollen](/de/platform/admin/members-and-roles) beschreibt die Organisationsrechte.

## Kapazität und Isolation planen

Anwendungsrollen können mehrere Replikate haben. Die CLI aktualisiert sie als gemeinsame Versionsgruppe. Während eines Upgrades laufen alte und neue Gruppe vorübergehend gleichzeitig; plane diese zusätzliche Kapazität ein. Datenbank, Objektspeicher und Sandbox-Dienste brauchen eine eigene Kapazitäts- und Wiederherstellungsplanung.

Anwendungsdatenbank, Wissensdatenbank und Dateispeicher können auf externe Infrastruktur umziehen. Eine Organisation kann außerdem eine eigene Wissensdatenbank und einen eigenen Bucket wählen. Eine geänderte Verbindung überträgt keine vorhandenen Inhalte. Plane Kopie, Umschaltung, Prüfung und Sicherungsumfang anhand von [Datenresidenz](/de/self-hosted/configuration/data-residency).

Selbsthosting bestimmt, wo Tale läuft. Anbieteraufrufe, Connectors, Webabrufe und Netzwerkzugriffe der Sandbox hängen weiterhin von deiner Konfiguration ab. Prüfe diese Ziele zusammen mit den Speicherorten unter [Härtung](/de/self-hosted/operate/security/hardening).
