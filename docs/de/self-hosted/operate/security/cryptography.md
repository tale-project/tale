---
title: Kryptografie und Schlüsselverantwortung
description: Ordne Verschlüsselungs-, Passwort- und Audit-Schlüssel zu und plane ihre Wiederherstellung.
---
Diese Übersicht zeigt, welcher Schlüssel welche Daten schützt und was ein Schlüsseltausch bewirkt. Anwendungsgeheimnisse, Datenbankvolumes, Netzwerkverkehr und Audit-Nachweise haben getrennte Schutzmechanismen. Unterscheide sie bei Backups und bei der Prüfung einer Bereitstellung.

## Verschlüsselte Daten zuordnen

Aktuelle Anbieterzugangsdaten verwenden die Secret Box der Datenbank: AES-256-GCM mit einem zweckgebundenen Schlüssel, den HKDF-SHA256 aus `ENCRYPTION_SECRET_HEX` ableitet. Andere Datenbankzugangsdaten, darunter OAuth-Token von Connectors, können den JWE-Pfad `dir`/`A256GCM` mit demselben Bereitstellungsschlüssel verwenden. Die Formate sind nicht austauschbar.

Unterstützte Geheimnisdateien der Konfiguration verwenden SOPS mit age-Empfängern. Dazu gehören Zugangsdaten für externe Wissensdatenbanken und Objektspeicher. `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` aktiviert die Verschlüsselung; ohne beide unterstützt der Helfer Klartextdateien mit eingeschränkten Rechten. Lies [Geheimnisse mit SOPS](/de/self-hosted/configuration/secrets-with-sops) vor einer Änderung.

Namen, Adressen, Gespräche und Dokumentinhalte werden durch diese Verfahren nicht pauschal auf Feldebene verschlüsselt. Schütze Datenbank, Objektspeicher und Backups mit der für deine Bereitstellung erforderlichen Speicherverschlüsselung und Zugriffskontrolle. TLS schützt den Transport, keine von der Festplatte kopierte Datenbankdatei.

## Netzwerkverkehr schützen

Der öffentliche Reverse Proxy beendet HTTPS-Verbindungen. Richte Domain und Zertifikat gemäß [TLS und Domains](/de/self-hosted/configuration/tls-and-domains) ein und prüfe danach Zertifikat und akzeptierte TLS-Versionen am bereitgestellten Endpunkt.

Ein internes Docker-Netz trennt Dienste, verschlüsselt sie aber nicht selbst mit TLS. Überschreiten Datenbank-, Speicher- oder andere Verbindungen Host- oder Vertrauensgrenzen, richte auch für diese Verbindungen einen passenden Transportschutz ein und prüfe ihn.

## Passwort- und Sitzungsschutz erhalten

Lokale Passwörter werden mit bcrypt gehasht. `BETTER_AUTH_SECRET` schützt den Authentifizierungszustand. Halte es stabil und über alle Backend-Replikate hinweg gleich. Eine Änderung kann Sitzungen ungültig machen und laufende Anmeldungen unterbrechen.

Ein Identitätsanbieter besitzt eigene Signaturschlüssel und einen eigenen Rotationsablauf. Hinterlege aktuelle Metadaten und Zertifikate über [Unternehmens-SSO](/de/platform/admin/enterprise-sso). Der Austausch eines Tale-Sitzungsgeheimnisses rotiert keinen IdP-Schlüssel.

## Audit-Nachweise prüfen

Audit-Einträge bilden eine SHA-256-Kette. Das aktuelle PostgreSQL-Backend prüft erhaltene Zeilen und ihre Verknüpfungen ab der ersten noch vorhandenen gespeicherten Verbindung. Es berücksichtigt die Aufbewahrung und gleicht bereinigte Zeilen mit Löschanträgen ab. Signierte Prüfpunkte werden nicht geprüft; `TALE_AUDIT_SIGNING_KEY` dient hier nicht als unabhängiger Vertrauensanker.

Die Kette macht Manipulationen erkennbar; sie verhindert keine Änderungen am Speicher. Schütze den Datenbankzugriff, bewahre Nachweise bei Bedarf unabhängig auf und untersuche Alarme gemäß [Audit-Protokollintegrität](/de/self-hosted/operate/security/audit-log-integrity). Das getrennte `TALE_AUDIT_PEPPER` pseudonymisiert sensible Kennungen fehlgeschlagener Anmeldungen. Seine Rotation verändert die Vergleichbarkeit über diesen Zeitpunkt hinweg.

## Schlüsselwiederherstellung planen

Verwende diese Tabelle für deinen Wiederherstellungsplan:

| Schutzmechanismus | Benötigte Wiederherstellungsdaten | Folge bei Änderung oder Verlust |
| --- | --- | --- |
| Verschlüsselung von Datenbankgeheimnissen | Zum Snapshot passendes `ENCRYPTION_SECRET_HEX` | Vorhandene Zugangsdaten lassen sich möglicherweise nicht entschlüsseln. |
| SOPS-Geheimnisdateien | Passende private age-Schlüssel, auch für ältere Backups | Nur an einen verlorenen Empfänger verschlüsselte Dateien sind nicht lesbar. |
| Authentifizierung | `BETTER_AUTH_SECRET` und konsistente Bereitstellungskonfiguration | Sitzungen und laufende Anmeldungen können ausfallen. |
| Audit-Prüfung | Erhaltene Audit-Zeilen, Löschvorgänge und unabhängige Nachweise | Verlorene oder neu geschriebene Historie lässt sich aus der aktuellen Kette allein nicht belegen. |
| Verschlüsselung von Host und verwaltetem Speicher | Wiederherstellungsdaten und Zugriff des Speicheranbieters | Anwendungsschlüssel allein entsperren kein Volume und keinen Bucket. |

Bewahre Schlüssel in einem Secret-Manager oder geschützten Wiederherstellungsspeicher auf, getrennt von öffentlich zugänglichem Quellcode und Build-Artefakten. Behalte alte Entschlüsselungsschlüssel für alte Backups auch nach einer Rotation. Teste eine Wiederherstellung mit dem tatsächlichen Schlüsselmaterial in einer isolierten Umgebung.

Zertifizierungen und Nachweise findest du unter [Vertrauen und Compliance](/de/cloud/trust-and-compliance). Diese Übersicht erklärt die technischen Schutzmechanismen. Beziehe bei deiner Bewertung auch die konkrete Konfiguration deiner Installation ein.
