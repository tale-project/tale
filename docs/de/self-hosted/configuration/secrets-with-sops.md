---
title: Konfigurationsgeheimnisse mit SOPS schützen
description: Unterscheide Datei- und Datenbankverschlüsselung und rotiere age-Schlüssel, ohne den Zugriff zu verlieren.
---
Tale verwendet SOPS und age für unterstützte Geheimnisdateien der Konfiguration, unter anderem für Verbindungen zur Wissensdatenbank und zum Objektspeicher. Aktuelle Zugangsdaten für AI-Anbieter liegen dagegen in der Anwendungsdatenbank und verwenden `ENCRYPTION_SECRET_HEX`. Eine age-Schlüsselrotation ändert diese Datenbankzugangsdaten nicht.

## Das betroffene Geheimnis zuordnen

Die Speicherart bestimmt den passenden Schlüssel:

| Speicherung | Verschlüsselung | Folge für den Betrieb |
| --- | --- | --- |
| SOPS-fähige Konfigurationsdatei `*.secrets.json` | `SOPS_AGE_KEY` oder `SOPS_AGE_KEY_FILE` | Bewahre einen Schlüssel auf, der alle erhaltenen Dateien und Backups entschlüsselt. |
| Anbieterzugangsdaten und weitere Secret-Box-Werte in der Datenbank | `ENCRYPTION_SECRET_HEX` | Ein Austausch macht vorhandene Geheimnisse unlesbar; eine age-Rotation migriert sie nicht. |
| Anbieterzugangsdaten aus einer Umgebungsvariablen | `TALE_PROVIDER_KEY_*` | Rotiere den Wert im Secret-Manager und starte die verwendenden Prozesse neu. |

In alten Konfigurationsverzeichnissen kann noch `providers/<name>.secrets.json` liegen. Das bedeutet nicht, dass aktuelle Anbieterzugangsdaten diese Datei verwenden. Das heutige Modell beschreibt [Anbieter](/de/self-hosted/configuration/providers).

## Eine Quelle für den age-Schlüssel wählen

Ein direkt gesetztes `SOPS_AGE_KEY` hat Vorrang vor `SOPS_AGE_KEY_FILE`. Wähle bewusst eine Quelle. Die Dateivariante akzeptiert einen privaten age-Schlüssel pro Zeile und ignoriert Leerzeilen sowie `#`-Kommentare. Beim Schreiben neuer SOPS-Geheimnisse berücksichtigt Tale alle konfigurierten Empfänger.

Der Pfad gilt innerhalb des lesenden Prozesses. Ein Hostpfad in `.env` reicht nicht aus: Binde die Datei in jeden benötigten Container ein, verwende den Pfad im Container und beschränke den Dateizugriff. Erstelle betroffene Container nach einer Umgebungsänderung neu; `docker compose restart` übernimmt keine geänderten Umgebungsdefinitionen.

Sind beide Variablen leer, schreibt der SOPS-Helfer unterstützte Geheimnisdateien als Klartext-JSON mit Modus `0600`. Vorhandene verschlüsselte Dateien erkennt er weiterhin und verweigert den Zugriff ohne Schlüssel. Das Entfernen der Variablen entschlüsselt keine vorhandenen Dateien.

## Eine Rotation vorbereiten

Erfasse vor dem Schlüsseltausch alle SOPS-verschlüsselten Dateien und ihre Backups. Bewahre den alten Schlüssel geschützt auf und prüfe, ob sich eine repräsentative Datei entschlüsseln lässt, ohne ihren Inhalt auszugeben oder zu protokollieren.

Erzeuge einen neuen age-Schlüssel mit deinem vorhandenen Werkzeug zur Geheimnisverwaltung. Erstelle eine geschützte Schlüsseldatei mit **dem bisherigen und dem neuen privaten Schlüssel**. Überschreibe die alte Datei nicht mit einem Befehl, der nur einen neuen Schlüssel erzeugt.

Binde diese Datei in der Bereitstellung ein und setze `SOPS_AGE_KEY_FILE`. Entferne den direkten Wert aus der Umgebung der betroffenen Prozesse, sonst behält er Vorrang. Rolle die Änderung aus und prüfe, ob vorhandene Verbindungen weiter funktionieren.

## Neu verschlüsseln und prüfen

Schreibe jede betroffene Geheimnisdatei über ihren unterstützten Speicherweg oder ein kontrolliertes SOPS-Verfahren neu. Tale verschlüsselt neue Dateien für alle aktuell konfigurierten Empfänger. Ein zusätzlicher Schlüssel allein ändert vorhandene Dateien nicht.

<Warning>

Entferne den alten Schlüssel erst, wenn jede aktive verschlüsselte Datei mit dem neuen Schlüssel allein geprüft wurde. Bewahre den alten Schlüssel weiterhin geschützt für historische Backups auf, die ihn noch benötigen.

</Warning>

Stelle danach eine Schlüsseldatei bereit, die nur den neuen Schlüssel enthält. Starte die betroffenen Prozesse neu, um entschlüsselte Zwischenspeicher zu leeren, und teste jede Verbindung. Ein gelungener Prozessstart beweist nicht, dass jede Datei lesbar ist.

## Entschlüsselungsfehler beheben

| Symptom | Prüfung |
| --- | --- |
| Verschlüsselte Datei ohne Schlüssel gefunden | Stelle die passende Schlüsselquelle wieder her; ausgeschaltete Verschlüsselung konvertiert die Datei nicht. |
| Schlüsseldatei nicht lesbar | Prüfe Einbindung, Containerpfad, Eigentümer und Rechte. |
| Alter Schlüssel wird weiter gewählt | Entferne das nicht leere `SOPS_AGE_KEY`, bevor du die Datei verwendest. |
| Neuer Schlüssel kann eine Datei nicht lesen | Behalte den alten Schlüssel und verschlüssele die Datei vor Abschluss der Rotation neu. |
| Anbieterzugangsdaten scheitern nach Änderung von `ENCRYPTION_SECRET_HEX` | Stelle den Zugriff auf Datenbankgeheimnisse wieder her; age-Schlüssel helfen hier nicht. |

Für Geheimnisse aus Vault, Kubernetes oder einem anderen externen Speicher bevorzuge, soweit unterstützt, die [Schlüsselquelle aus Umgebungsvariablen](/de/self-hosted/configuration/providers#umgebungsvariable-als-schlüsselquelle). Bewahre Verschlüsselungsschlüssel mit deinem Wiederherstellungsplan auf, getrennt geschützt von den Backups, die sie entschlüsseln.
