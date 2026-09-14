---
title: Architektur beim Selbsthosting
description: Verstehe Anwendungs-, Speicher- und Sandbox-Dienste, bevor du Bereitstellung und Betrieb von Tale planst.
---

Bei einer selbst gehosteten Tale-Instanz betreibst du Anwendung, Speicher und Sandbox-Dienste auf deiner Infrastruktur. Eine Instanz kann mehrere Organisationen enthalten; Datensätze und Konfiguration bleiben jeweils der zugehörigen Organisation zugeordnet.

Diese Übersicht hilft bei der Kapazitätsplanung und bei der Auswahl der zu sichernden Daten. [Compose selbst betreiben](/de/self-hosted/install/own-compose) beschreibt die erforderlichen Netzwerke, Mounts und Zustandsprüfungen. [Container-Architektur](/de/self-hosted/operate/container-architecture) hilft dir, Fehler im laufenden Betrieb einzugrenzen.

## Zusammenspiel der Dienste

Die mitgelieferte Bereitstellung auf einem Host umfasst zehn Dienste, bevor Replikate und vorübergehende Sandbox-Sitzungen hinzukommen. Der Stack für die Entwicklung kann eine eigene Wissensdatenbank verwenden. Vergleiche daher die Aufgaben der Dienste statt nur die Anzahl der Container.

| Ebene | Dienste | Aufgabe |
| --- | --- | --- |
| Öffentlicher Zugang | `proxy` | Caddy beendet TLS und leitet Browseranfragen an Web-Oberfläche, APIs und Dateispeicher weiter. |
| Anwendung | `platform`, `backend-api`, `backend-worker` | Die Web-Ebene liefert die Oberfläche. Die API authentifiziert Anfragen und führt Anwendungsoperationen aus. Worker bearbeiten Aufgaben, Automatisierungen und Importe aus der Warteschlange. |
| Dauerhafter Speicher | `db`, `object-store` | Postgres speichert Anwendungs- und Wissensdaten; der S3-kompatible Speicher enthält Originaldateien und erzeugte Medien. |
| Sandbox-Ausführung | `sandbox`, `sandbox-egress`, `sandbox-llm-gateway` | Der Spawner erstellt Ausführungssitzungen, der Egress-Proxy kontrolliert ausgehende Anfragen und das Modell-Gateway stellt begrenzten Modellzugriff bereit. |
| Video-Unterstützung | `bgutil-provider` | Liefert Proof-of-Origin-Tokens für den Videoimport. Seine Verfügbarkeit kann den Abruf von Transkripten beeinflussen. |

Der Browser verbindet sich über den öffentlichen Proxy. Datenbank-, Gateway- und Sandbox-Ports sollten nicht öffentlich erreichbar sein. Bei einem externen Bucket können vorsignierte Dateianfragen direkt vom Browser an dessen öffentlichen Endpunkt gehen.

Die Anwendungsrollen verwenden dasselbe Tale-Platform-Image. `TALE_ROLE=api` startet die API, `TALE_ROLE=worker` einen Worker. Worker stellen keinen HTTP-Server bereit. Die Sandbox-Laufzeit ist ein separates Image für vorübergehende Sitzungscontainer und kein zusätzlicher dauerhaft laufender Compose-Dienst.

## Wo dauerhafte Daten liegen

| Speicherort im mitgelieferten Stack | Zu erhaltende Daten |
| --- | --- |
| `db-data` | `tale_app`: Nutzer, Chats, Läufe, Audit-Einträge und verschlüsselte Datenbankgeheimnisse. `tale_knowledge`: extrahierte Inhalte, Embeddings, Suchindizes und abgerufene Webseiten. |
| `config-data` | Konfigurationsdateien der Organisationen, darunter Agenten, Skills, Anbieterdefinitionen, Richtlinien, SSO-Einstellungen und Branding. |
| `object-store-data` | Hochgeladene Dokumente, Anhänge, Audio und erzeugte Dateien. |
| `caddy-data`, `caddy-config` | Zertifikate und Proxy-Zustand. |
| `llm-gateway-data` | Gateway-Konfiguration und Zugangsdaten für Sitzungen. |

Im mitgelieferten Stack liegen beide Datenbanken in einem Postgres-Dienst. Der Netzwerkalias `knowledge-db` führt zur Wissensverbindung. Es bleiben zwei getrennte Datenbanken. Eine Bereitstellung aus dem Quellcode mit eigenem Wissensdienst besitzt zusätzlich `knowledge-db-data`.

Beim Ersetzen eines Containers bleiben Daten nur erhalten, wenn seine dauerhaften Volumes oder externen Speicher weiter eingebunden sind. Sichere auch den Bereitstellungsordner, die Umgebung, Verschlüsselungsschlüssel und Kopien außerhalb des Hosts. Die CLI erfasst nicht jedes oben genannte Volume; prüfe den Umfang unter [Backups und Wiederherstellung](/de/self-hosted/operate/backups-and-restore).

## Geheimnisse und Anmeldung

`ENCRYPTION_SECRET_HEX` schützt Anbieterzugangsdaten und andere verschlüsselte Werte in der Anwendungsdatenbank. SOPS und age schützen unterstützte Begleitdateien mit Geheimnissen, etwa Passwörter für externe Speicher. Sichere die benötigten Schlüssel getrennt von den geschützten Daten. Ein neuer Schlüssel entschlüsselt keine vorhandenen Geheimnisse.

Better Auth läuft im Backend. Lokale Anmeldung, Zwei-Faktor-Authentifizierung, Passkeys, Unternehmens-SSO und die Anmeldung über vertrauenswürdige Header haben unterschiedliche Voraussetzungen. [Authentifizierung](/de/self-hosted/configuration/authentication) erklärt die Einrichtung; [Mitglieder und Rollen](/de/platform/admin/members-and-roles) beschreibt die Organisationsrechte.

## Kapazität und Isolation planen

Anwendungsrollen können mehrere Replikate haben. Die CLI aktualisiert sie als gemeinsame Versionsgruppe. Während eines Upgrades laufen alte und neue Gruppe vorübergehend gleichzeitig; plane diese zusätzliche Kapazität ein. Datenbank, Objektspeicher und Sandbox-Dienste brauchen eine eigene Kapazitäts- und Wiederherstellungsplanung.

Anwendungsdatenbank, Wissensdatenbank und Dateispeicher können auf externe Infrastruktur umziehen. Eine Organisation kann außerdem eine eigene Wissensdatenbank und einen eigenen Bucket wählen. Eine geänderte Verbindung überträgt keine vorhandenen Inhalte. Plane Kopie, Umschaltung, Prüfung und Sicherungsumfang anhand von [Datenresidenz](/de/self-hosted/configuration/data-residency).

Selbsthosting bestimmt, wo Tale läuft. Anbieteraufrufe, Konnektoren, Webabrufe und Netzwerkzugriffe der Sandbox hängen weiterhin von deiner Konfiguration ab. Prüfe diese Ziele zusammen mit den Speicherorten unter [Härtung](/de/self-hosted/operate/security/hardening).
