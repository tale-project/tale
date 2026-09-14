---
title: Mit Tale entwickeln
description: Verbinde andere Systeme mit Tale, automatisiere einen Ablauf oder arbeite am Quellcode der Anwendung.
---

Diese Anleitungen helfen dir, einen Client zu schreiben, ein externes System anzubinden oder Tale selbst zu ändern. Beginne mit einer kleinen, funktionierenden Anfrage. Ergänze danach Authentifizierung, Geltungsbereich und Fehlerbehandlung für deine Integration.

## Eine Entwicklungsaufgabe wählen

| Dein Vorhaben | Einstieg |
| --- | --- |
| Ein Skript schreiben, das eine Nachricht sendet und die Antwort liest | [Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script) |
| Einen Client für Projekte, Aufgaben, Dateien oder andere Ressourcen bauen | [API-Referenz](/de/develop/api-reference) |
| Einen MCP-Client verbinden | [MCP-Endpunkt](/de/develop/mcp-endpoint) |
| Eine Automatisierung aus einem anderen System auslösen | [Webhooks](/de/develop/webhooks) |
| Über einen Dateisystem-Client auf Dokumente zugreifen | [WebDAV-API](/de/develop/webdav-api) |
| Einen Connector entwickeln | [Connector-Entwicklung](/de/develop/connectors) |
| Den Anwendungscode von Tale ändern | [Entwicklungsumgebung einrichten](/de/develop/contributor-setup) |

## Die erste Anfrage zuverlässig machen

Wähle die Zugangsdaten passend zur Schnittstelle: REST und MCP verwenden API-Schlüssel, WebDAV ein App-Passwort und Webhooks eine geheime Trigger-URL. Diese Zugangsdaten sind nicht austauschbar.

Erstelle für jede Integration einen eigenen API-Schlüssel. Sende ihn nur an die vorgesehene Instanz und speichere ihn nicht in der Versionsverwaltung. [Deine erste API-Anfrage](/de/get-started/developers) erklärt Instanz-URLs und den Organisationskontext. Bei längeren Vorgängen ist eine angenommene Anfrage noch kein fertiges Ergebnis: Frage die Ressource oder den Lauf ab und behandle auch fehlgeschlagene Ergebnisse.

Lies die [Ratenbegrenzungen](/de/develop/rate-limits), bevor du Wiederholungsversuche einbaust. Prüfe bei Verbindungsproblemen die [Verfügbarkeit der Instanz](/de/develop/status-page). Die API-Referenz beschreibt das Fehlerformat und die erzeugte Spezifikation des aktuellen Checkouts.

## Innerhalb der Plattform entwickeln

Für Agenten, Projekte und den Automatisierungseditor nutzt du den [Entwicklerleitfaden](/de/platform/developer/overview). [KI-gestützte Entwicklung](/de/develop/ai-assisted-development) erklärt, wie du Autorenwerkzeuge mit Validierung und Prüfung verbindest.

<Video src="/videos/de/tutorials/ep10-developers/ep10-developers.de.mp4" poster="/videos/de/tutorials/ep10-developers/ep10-developers.de.webp" captions="/videos/de/tutorials/ep10-developers/ep10-developers.de.vtt" lang="de" title="Bonus — Tale für Entwickler" caption="Bonus — Tale für Entwickler (2:38)">

</Video>
