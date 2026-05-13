---
title: Mitglieder und Rollen
description: Verwalten, wer Zugriff auf deine Organisation hat und was dort erlaubt ist.
---

Tale nutzt sechs Rollen. Jeder Nutzer hat genau eine Rolle innerhalb einer Organisation. Dieselbe Person kann in verschiedenen Organisationen unterschiedliche Rollen haben.

## Mitglieder verwalten

Die Mitglieder-Tabelle unter **Einstellungen > Mitglieder** listet alle Nutzer der Organisation mit Email, Anzeigename, Rolle und Beitrittsdatum. Admins können:

- **Mitglieder hinzufügen** — Email, optionales Passwort, Anzeigename und Rolle eingeben. Existiert die Email bereits in Tale, wird der Nutzer der Organisation hinzugefügt, ohne dass ein neues Konto entsteht.
- **Mitglieder bearbeiten** — Anzeigename, Rolle oder ein neues Passwort für ein Mitglied setzen.
- **Mitglieder entfernen** — das Mitglied aus der Organisation entfernen. Das Konto wird nicht gelöscht; der Nutzer verliert lediglich den Zugriff.

Für Authentifizierungsoptionen (Passwort, Microsoft Entra ID SSO, Trusted Headers) siehe [Authentifizierung](/de/self-hosted/admin/authentication).

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

Tale unterstützt Email/Passwort, Microsoft Entra ID SSO und Trusted Headers. Alle Methoden lassen sich gleichzeitig nutzen.

Die vollständige Einrichtung beschreibt die [Authentifizierungs-Anleitung](/de/self-hosted/admin/authentication).
