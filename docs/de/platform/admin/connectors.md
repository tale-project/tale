---
title: Connector-Zugangsdaten
description: Verbinde Dienstkonten, wähle Standards und erneuere ihre Zugriffsberechtigung.
---

Hinterlege Connector-Zugangsdaten, damit Tale Dienste wie Postfächer, Dateiablagen oder Aufgabenverwaltung verwenden kann. Inhaber, Admins und Entwickler verwalten sie unter **Einstellungen > Connectors**. Wähle den benötigten Dienst und das passende Konto. Der [Connector-Katalog](/de/platform/connectors/overview) erklärt die verfügbaren Aktionen.

## Ein Konto verbinden

1. Wähle **Zugangsdaten hinzufügen** und den Connector. Bereits konfigurierte Connectors stehen zuerst und können weitere Zugangsdaten erhalten.
2. Prüfe das Feld **Name**. Es enthält bereits den Namen des Connectors. Heißen andere Zugangsdaten dieses Connectors schon so, hängt Tale eine Zahl an: `GitHub`, dann `GitHub 2`. Ein Name wie `Support-Postfach` oder `EU-Shop` ist beim Erstellen von Automatisierungen leichter zu erkennen. OAuth-Verbindungen verwenden dieses Feld nicht.
3. Fülle die angebotene Authentifizierungsmethode aus. Bei OAuth wählst du **Verbinden** und erteilst den Zugriff beim Anbieter.
4. Schließe das Formular ab und prüfe den neuen Eintrag mit Connector, Konto oder Instanz und Status.

Der Connector bestimmt die Felder. Verwende die tatsächlichen Zugangsdaten des Dienstkontos, keinen Tale-API-Schlüssel.

| Methode | Benötigte Angaben |
| --- | --- |
| API-Schlüssel | Der vom Dienst ausgegebene Schlüssel, etwa für Tavily oder Shopify. |
| Token | Ein Dienst-Token, etwa ein persönlicher GitHub-Zugangstoken oder ein Discord-Bot-Token. |
| Benutzername und Passwort | Das vom Dienst erwartete Paar, etwa Anmeldung und App-Passwort oder eine anbieterspezifische ID mit Token. |
| OAuth | Die Freigabe im Browser beim Anbieter. Tale speichert die zurückgegebene Berechtigung. |

Manche Connectors benötigen zusätzlich die Adresse der Instanz. Für Confluence ist das die Basisadresse der Atlassian-Site. Für Shopify verwendest du die `myshopify.com`-Adresse des Shops, nicht die öffentliche Shop-Domain.

## Einen Standard wählen

Die Tabelle zeigt eine Zeile je Zugangsdaten-Eintrag. **Standard** kennzeichnet den Eintrag für Aktionen ohne ausdrückliche Auswahl. Mit **Zum Standard machen** im Zeilenmenü änderst du ihn. Pro Connector ist ein Standard möglich.

Ein Connector mit mehreren Einträgen, aber ohne Standard funktioniert weiterhin für Aufrufer, die Zugangsdaten benennen. Ohne einen solchen Namen braucht der Aufruf einen Standard. Benenne Konten eindeutig, bevor du sie in Automatisierungen verwendest, damit später erkennbar bleibt, welches Konto gemeint ist.

Postfachsynchronisation und Eingangssichtung können alle aktiven Zugangsdaten eines Postfach-Connectors prüfen. Ein zweites Postfach muss dafür nicht zuerst Standard werden.

## Ein Geheimnis rotieren oder Zugriff pausieren

Nutze die Ersetzen-Aktion der jeweiligen Methode, etwa **API-Schlüssel ersetzen** oder **Token ersetzen**. Der neue Wert ersetzt das gespeicherte Geheimnis. Name, Standardauswahl und Verweise bleiben erhalten. Prüfe anschließend eine passende Dienstaktion.

**Deaktivieren** pausiert den Eintrag und behält seine Konfiguration; **Aktivieren** stellt den Zugriff wieder her. Über **Zugangsdaten bearbeiten** änderst du andere unterstützte Angaben wie Namen oder Instanzadresse.

<Warning>

Das Löschen von Zugangsdaten entzieht abhängigen Automatisierungen und Agenten den Zugriff. Stelle die Aufrufer vorher um und wähle bei Bedarf einen neuen Standard. Ein gelöschter Eintrag lässt sich nicht durch erneutes Öffnen wiederherstellen.

</Warning>

## Eine OAuth-App vorbereiten

Unter **OAuth-Apps** am Seitenende konfigurieren Inhaber und Admins die Anbieter-Apps, über die Mitglieder den Zugriff freigeben. Eine organisationsspezifische App hat Vorrang vor der Bereitstellungs-App. Fehlen beide, kann der Connector keine Anmeldung starten. Die Seite zeigt den fehlenden Einrichtungsstand an.

Wähle **Einrichten**, gib Client-ID und Geheimnis des Anbieters ein und registriere dort exakt die im Dialog gezeigten Weiterleitungsadressen. Microsoft-Apps benötigen gegebenenfalls auch die Verzeichnis- oder Mandanten-ID. Bei späteren Änderungen lässt du ein gespeichertes Geheimnis leer, um es beizubehalten.

Die Google-Drive-App unterstützt auch den Wissensdatenbank-Import. Der OneDrive-/SharePoint-Eintrag dient diesem Import und keinem eigenen Connector. Die Slack-App richtet der Bereitstellungsbetreiber ein. Lies den jeweiligen [Connector-Leitfaden](/de/platform/connectors/overview), bevor du Anbieterrechte vergibst.

Bei OneDrive/SharePoint kann **Entra-ID-App aus SSO übernehmen** eine bestehende SSO-Registrierung in die Importkonfiguration kopieren. Das ist eine einmalige Kopie. Kopiere nach einer Rotation des SSO-Geheimnisses erneut und prüfe Weiterleitungsadresse sowie delegierte Rechte in der Bestätigung.

## Eine Verbindung reparieren

**Neu verbinden nötig** bedeutet, dass die gespeicherte OAuth-Berechtigung nicht mehr erneuert werden kann. Wähle **Neu verbinden** und gib das Konto erneut frei. Name und Verweise bleiben erhalten. Bewusst deaktivierte Zugangsdaten brauchen stattdessen **Aktivieren**.

Kann die Verbindung nicht starten, prüfe die OAuth-App. Lehnt der Anbieter die Rückkehr zu Tale ab, vergleiche die registrierte Weiterleitungsadresse mit der exakt in Tale gezeigten Adresse. Scheitert nach der Verbindung eine Aktion, prüfe die Kontorechte und den benötigten Berechtigungsumfang.

Für Dienste ohne mitgelieferten Connector siehe [MCP und eigene Integrationen](/de/platform/connectors/mcp-servers). Beliebige ausgehende MCP-Server werden nicht auf dieser Zugangsdaten-Seite registriert.
