---
title: Integrationen – Überblick
description: Tale mit REST-APIs, SQL-Datenbanken, E-Mail und Cloud-Storage verbinden.
---

Integrationen erlauben Tale, mit externen Systemen zu sprechen. Developer konfigurieren sie einmal; Agents, Automatisierungen und der Chat-Assistent nutzen sie dann, um Daten in diesen Systemen zu lesen und zu schreiben. Die Konfiguration lebt unter **Einstellungen > Integrationen** und erfordert die Developer-Rolle oder höher.

## Integrationen-Typen

### REST-API

Verbinde jede HTTP-basierte API, indem du Base-URL und Credentials eingibst. Unterstützte Authentifizierungsmethoden:

| Methode           | So funktioniert sie                                               |
| ----------------- | ----------------------------------------------------------------- |
| **API-Schlüssel** | Einen Schlüssel in einem Header oder Query-Parameter mitschicken. |
| **Bearer-Token**  | `Authorization: Bearer <token>`-Header bei jedem Request.         |
| **Basic Auth**    | Benutzername und Passwort, base64-kodiert.                        |
| **OAuth 2.0**     | Authorization-Code-Flow mit automatischem Token-Refresh.          |

Einmal hinzugefügt, bietet die Integration jeden konfigurierten Endpoint als Tool an, das der KI-Agent aufrufen kann. Siehe [Agent erstellen](/de/platform/agents/create) für die Tool-Freigabe.

### SQL

Verbinde eine PostgreSQL-, MySQL- oder Microsoft-SQL-Server-Datenbank. Der KI-Agent und Automatisierungen können sie in natürlicher Sprache abfragen, die gegen das registrierte Schema nach SQL übersetzt wird.

Nur-Lese-Credentials sind dringend empfohlen — die vom KI generierten Abfragen werden wie sie sind gegen die Datenbank ausgeführt.

### E-Mail (Conversations)

Verbinde ein IMAP- und SMTP-Postfach, um das [Conversations](/de/platform/workspace/conversations)-Inbox zu versorgen. Eingehende E-Mails werden zu Konversations-Threads. Antworten aus der Plattform werden als normale E-Mails zugestellt.

### Microsoft OneDrive

Verbinde ein Microsoft-365-Konto, um OneDrive-Dokumenten-Sync zu aktivieren. Nutzer können dann Dateien direkt aus OneDrive in die Wissensdatenbank importieren, ohne sie vorher auf ihr Gerät zu laden. Siehe [Wissensdatenbank](/de/platform/workspace/knowledge-base).

## API-Schlüssel

Erzeuge API-Schlüssel für den programmatischen Zugriff auf die Tale-API. Schlüssel erben die Berechtigungen des Nutzers, der sie erstellt hat, gebunden an dessen Rolle. Schlüssel lassen sich jederzeit unter **Einstellungen > Integrationen > API-Schlüssel** widerrufen.

Für Endpoint-Details siehe die [API-Referenz](/de/develop/api-reference).

## Freigaben

Integrationen können vor jeder Operation eine Freigabe erfordern. Wenn ein Agent oder eine Automatisierung einen Integrationen-Aufruf auslöst, erscheint eine Freigabe-Karte im Chat — siehe [Freigaben](/de/platform/workspace/approvals). Das ist nützlich bei destruktiven oder teuren Operationen (Billing-Aktionen, Massen-Mails, Änderungen an Produktionsdaten).
