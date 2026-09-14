---
title: KI-Anbieter
description: Verbinde Anbieter-Zugangsdaten, stelle Modelle bereit und prüfe fehlende Auswahlmöglichkeiten.
---

Verbinde einen KI-Anbieter, bevor Tale Chats oder Agenten ausführen soll. Unter **Einstellungen > KI-Anbieter** verwalten Inhaber, Admins und Entwickler die Zugangsdaten ihrer Organisation. Der Anbieter bestimmt Verbindung und unterstützte Anmeldung; ein Zugangsdaten-Eintrag stellt den Zugriff deiner Organisation darauf bereit.

<Frame caption="Jede Zeile steht für einen Zugangsdaten-Eintrag. Standard kennzeichnet den Eintrag für Aufrufe ohne ausdrückliche Auswahl.">

![Die Seite für KI-Anbieter zeigt einen Zugangsdaten-Eintrag mit Anbieter, Authentifizierungsmethode und Standard-Kennzeichnung.](/images/get-started/settings-providers.webp)

</Frame>

## Die ersten Zugangsdaten hinzufügen

1. Wähle **Zugangsdaten hinzufügen** und den Anbieter. Bereits konfigurierte Anbieter stehen zuerst. Du kannst sie erneut wählen, um weitere Zugangsdaten anzulegen.
2. Wähle eine **Authentifizierungsmethode**, falls der Anbieter mehrere unterstützt.
3. Gib unter **Name** einen Namen an, der den Zweck erkennen lässt, etwa `Produktionsschlüssel` oder `Finanzteam`. Fülle die Pflichtfelder der Methode aus.
4. Prüfe die Liste **Erlaubte Modelle**. Hat der Anbieter einen Katalog, erlaubt eine leere Liste dessen Modelle. Ohne Katalog sind ausdrückliche Modell-IDs erforderlich.
5. Wähle **Hinzufügen**. Prüfe den neuen Eintrag und setze ihn als Standard für den Anbieter, wenn gewöhnliche Anfragen ihn verwenden sollen.

Öffne einen Chat und prüfe die Modellauswahl. Ein Modell muss über aktive Zugangsdaten erreichbar und durch die Modellzugriffsregeln der Organisation erlaubt sein. Gespeicherte Zugangsdaten allein belegen noch keinen funktionierenden Aufruf. Sende eine kurze Testnachricht mit dem gewünschten Modell.

## Die Anmeldemethode wählen

| Methode | Benötigte Angaben | Einsatz |
| --- | --- | --- |
| **API-Schlüssel** | Der geheime Schlüssel des Anbieters | Gewöhnlicher, nutzungsabhängig abgerechneter API-Zugriff. Der gespeicherte Wert ist verschlüsselt und später nur maskiert sichtbar. |
| **Umgebungsvariable** | Der Name einer Bereitstellungsvariable | Ein Betreiber verwaltet das Geheimnis außerhalb der Oberfläche. Der Name muss mit `TALE_PROVIDER_KEY_` beginnen. |
| **Abo-Schlüssel** | Ein unterstütztes Abonnement-Geheimnis des Anbieters | Ausführung über die unterstützte Agent-Laufzeit des Anbieters statt eines direkten API-Aufrufs. |
| **Abo-Broker** | Broker-Endpunkt und Konfiguration seiner Token-Antwort | Die Bereitstellung bezieht nutzbare Abonnement-Tokens von einem Broker. |

Es erscheinen nur Methoden, die der ausgewählte Anbieter unterstützt. Ein Variablenverweis legt die Variable nicht an. Der Betreiber muss sie gemäß der [Anbieterkonfiguration](/de/self-hosted/configuration/providers) bereitstellen.

Bei einem Abonnement-Broker legst du fest, wie Tale sich dort anmeldet, wo die Antwort die Token-Liste und den Token-Wert enthält und welche Zielvariable den Token erhält. Wähle die Auswahlstrategie und prüfe Zeitlimit, Antwortgröße, Ablauf und Aktivstatus unter **Erweitert**. Verwende Werte aus dem tatsächlichen Antwortformat des Brokers. Sie sind nicht durch einen Anbieter-API-Schlüssel ersetzbar.

## Azure oder einen eigenen Endpunkt einrichten

Azure OpenAI benötigt eine **Endpoint-URL**, gewöhnlich `https://<resource>.openai.azure.com/openai/v1`. Jeder Zugangsdaten-Eintrag gehört zu dieser Ressource. Azure verwendet die dort konfigurierten Bereitstellungsnamen als Modell-IDs. Trage diese Namen in die Liste **Erlaubte Modelle** ein. Ohne Katalog stellt eine leere Liste keine Modelle bereit.

Verwende dokumentierte Endpunkte und Modellkennungen des Anbieters. Ein Anzeigename auf einer Produktseite muss nicht der von der API akzeptierten Kennung entsprechen.

## Standard und Modellzugriff festlegen

Wähle **Zum Standard machen** im Zeilenmenü. Pro Anbieter gibt es einen Standard. Die Auswahl eines anderen Eintrags verschiebt die Kennzeichnung. Deaktivierte Zugangsdaten können kein Standard sein. Ohne Standard muss ein Aufrufer den gewünschten Eintrag ausdrücklich benennen.

Die Liste **Erlaubte Modelle** eines Eintrags begrenzt nur diese Zugangsdaten. Unter [Modelle](/de/platform/admin/governance/content-models) legst du anbieterübergreifend Standardmodelle und Zugriffsregeln für Personen, Teams und Rollen fest. Beide Einschränkungen gelten. Eine erweiterte Liste umgeht die andere nicht.

**Agent-Laufzeiten** unter der Tabelle ist schreibgeschützt. Dort siehst du verfügbare Modelle und Abonnements je Laufzeit. Um diese Konfiguration zu ändern, bearbeitest du die Zugangsdaten darüber.

## Fehlende oder nicht funktionierende Modelle prüfen

- Fehlt ein Anbieterstandard, wähle die vorgesehenen aktiven Zugangsdaten und setze sie als Standard.
- Konnte der Katalog nicht geladen werden, nutze **Kataloge aktualisieren** und prüfe das Ergebnis für den Anbieter. Live-Kataloge werden zwischengespeichert; mitgelieferte Kataloge ändern sich mit der Plattform.
- Fehlt ein Modell, prüfe die Allowlist und die Modellzugriffsregeln der Organisation. Ohne Katalog müssen die Modell-IDs exakt stimmen.
- Wird eine Anfrage abgelehnt, prüfe Aktivierung, Anbieterzugriff, Endpunkt und Kontingent beim Anbieter, bevor du Modellregeln änderst.

## Zugangsdaten rotieren oder stilllegen

Nutze die Ersetzen-Aktion im Zeilenmenü, um ein Geheimnis zu rotieren und Namen sowie Verweise zu behalten. **Deaktivieren** pausiert den Eintrag, ohne seine Konfiguration zu entfernen; **Aktivieren** schaltet ihn wieder frei. Prüfe den Ersatz mit dem vorgesehenen Modell.

<Warning>

Das Löschen eines Eintrags entzieht abhängigen Aufrufern den Zugriff. Stelle sie vorher um. Wenn du den Standard löschst, wähle einen neuen, damit Aufrufe ohne ausdrückliche Auswahl weiterhin Zugangsdaten finden.

</Warning>
