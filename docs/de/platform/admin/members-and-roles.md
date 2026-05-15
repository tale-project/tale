---
title: Mitglieder und Rollen
description: Verwalten, wer Zugriff auf deine Organisation hat und was dort erlaubt ist.
---

Tale nutzt sechs Rollen. Jeder Nutzer hat genau eine Rolle innerhalb einer Organisation. Dieselbe Person kann in verschiedenen Organisationen unterschiedliche Rollen haben.

## Mitglieder verwalten

Die Mitglieder-Tabelle unter **Einstellungen > Mitglieder** listet alle Nutzer der Organisation mit E-Mail, Anzeigename, Rolle und Beitrittsdatum. Admins können:

- **Mitglieder hinzufügen** — E-Mail, optionales Passwort, Anzeigename und Rolle eingeben. Existiert die E-Mail bereits in Tale, wird der Nutzer der Organisation hinzugefügt, ohne dass ein neues Konto entsteht.
- **Mitglieder bearbeiten** — Anzeigename, Rolle oder ein neues Passwort für ein Mitglied setzen.
- **Mitglieder entfernen** — das Mitglied aus der Organisation entfernen. Das Konto wird nicht gelöscht; der Nutzer verliert lediglich den Zugriff.

Für Authentifizierungsoptionen (Passwort, Microsoft Entra ID SSO, Trusted Kopfzeilen) siehe [Authentifizierung](/de/self-hosted/admin/authentication).

## Rollen-Übersicht

| Rolle       | Wen sie adressiert                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Inhaber     | Ersteller der Organisation. Gleiche Berechtigungen wie Admin plus Eigentums-Übertragung.                                                |
| Admin       | Vollständige Kontrolle über die Organisation. Verwaltet Mitglieder, Einstellungen, Integrationen und sämtliche Inhalte.                 |
| Entwickler  | Für Engineers und Integrationen-Builder. Vollzugriff auf Daten, aber keine Verwaltung von Mitgliedern oder Organisations-Einstellungen. |
| Redakteur   | Für Content- und Support-Teams. Legt Wissensbasis-Inhalte an, bearbeitet Konversationen, verwaltet Agents und bestätigt Aktionen.       |
| Mitglied    | Nur-Lese-Zugriff. Kann den KI-Chat zum Erkunden von Daten nutzen, aber keinen Content anlegen oder bearbeiten.                          |
| Deaktiviert | Gesperrtes Konto. Kein Zugriff auf Funktionen.                                                                                          |

## Berechtigungs-Matrix

### KI-Chat

| Funktion                         | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------- | -------- | --------- | ---------- | ----- |
| Nachrichten erstellen und senden | ✓        | ✓         | ✓          | ✓     |
| Eigenen Chat-Verlauf sehen       | ✓        | ✓         | ✓          | ✓     |
| Agent auswählen                  | ✓        | ✓         | ✓          | ✓     |

### Wissensdatenbank

| Funktion                                   | Mitglied | Redakteur | Entwickler | Admin |
| ------------------------------------------ | -------- | --------- | ---------- | ----- |
| Alle Wissens-Einträge sehen                | ✓        | ✓         | ✓          | ✓     |
| Dokumente hochladen / bearbeiten / löschen | —        | ✓         | ✓          | ✓     |
| Produkte, Kunden, Lieferanten verwalten    | —        | ✓         | ✓          | ✓     |
| Website-Crawling konfigurieren             | —        | ✓         | ✓          | ✓     |

### Konversationen

| Funktion                                | Mitglied | Redakteur | Entwickler | Admin |
| --------------------------------------- | -------- | --------- | ---------- | ----- |
| Konversationen sehen                    | ✓        | ✓         | ✓          | ✓     |
| Kunden antworten                        | —        | ✓         | ✓          | ✓     |
| Schließen / wieder öffnen / archivieren | —        | ✓         | ✓          | ✓     |
| Als Spam markieren                      | —        | ✓         | ✓          | ✓     |

### Freigaben

| Funktion                         | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------- | -------- | --------- | ---------- | ----- |
| Offene Freigaben sehen           | ✓        | ✓         | ✓          | ✓     |
| Aktionen freigeben oder ablehnen | —        | ✓         | ✓          | ✓     |

### Agents

| Funktion                        | Mitglied | Redakteur | Entwickler | Admin |
| ------------------------------- | -------- | --------- | ---------- | ----- |
| Agent-Liste sehen               | —        | ✓         | ✓          | ✓     |
| Agents erstellen und bearbeiten | —        | ✓         | ✓          | ✓     |

### Automatisierungen

| Funktion                                     | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------------------- | -------- | --------- | ---------- | ----- |
| Automatisierungs-Liste sehen                 | —        | —         | ✓          | ✓     |
| Automatisierungen erstellen und bearbeiten   | —        | —         | ✓          | ✓     |
| Automatisierungen publizieren und aktivieren | —        | —         | ✓          | ✓     |
| Ausführungslogs sehen                        | —        | —         | ✓          | ✓     |

### Integrationen und API

| Funktion                               | Mitglied | Redakteur | Entwickler | Admin |
| -------------------------------------- | -------- | --------- | ---------- | ----- |
| Integrationen sehen                    | —        | —         | ✓          | ✓     |
| Integrationen konfigurieren            | —        | —         | ✓          | ✓     |
| API-Schlüssel erstellen und widerrufen | —        | —         | ✓          | ✓     |

### Organisations-Administration

| Funktion                                  | Mitglied | Redakteur | Entwickler | Admin |
| ----------------------------------------- | -------- | --------- | ---------- | ----- |
| Organisations-Einstellungen sehen         | —        | —         | —          | ✓     |
| Organisationsname und Branding bearbeiten | —        | —         | —          | ✓     |
| Mitglieder hinzufügen und entfernen       | —        | —         | —          | ✓     |
| Rollen der Mitglieder ändern              | —        | —         | —          | ✓     |

## Authentifizierung

Tale unterstützt E-Mail/Passwort, Microsoft Entra ID SSO und Trusted Kopfzeilen. Alle Methoden lassen sich gleichzeitig nutzen.

Die vollständige Einrichtung beschreibt die [Authentifizierungs-Anleitung](/de/self-hosted/admin/authentication).

## Wo das hingehört

Mitglieder und Rollen ist die Seite, die jede andere Admin-Seite voraussetzt. Authentifizierung beantwortet _wer sich überhaupt anmelden darf_; Anbieter beantworten _welche Modelle die Organisation auf Kosten bringt_; Governance beantwortet _welche Regeln für ihr Tun gelten_ — aber keine dieser Fragen hat eine sinnvolle Antwort, solange nicht entschieden ist, wer was darf. Das passiert hier.

Der natürliche nächste Schritt hängt davon ab, mit welcher Frage du gekommen bist. Für den Login jenseits von E-Mail/Passwort deckt [Authentifizierung](/de/self-hosted/admin/authentication) SSO und Trusted Kopfzeilen ab. Um Mitglieder für geteilten Zugriff zu gruppieren, ist [Teams](/de/platform/admin/teams) die Seite. Um nachzuvollziehen, wer was getan hat, deckt [Governance](/de/platform/admin/governance) das Audit-Log ab.
