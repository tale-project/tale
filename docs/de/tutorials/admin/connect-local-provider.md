---
title: Einen lokalen Modellserver verbinden
description: Den Endpunkt mit dem Betreiber abstimmen, Zugangsdaten einrichten und eine Modellanfrage prüfen.
---
Verbinde einen lokalen Modellserver, wenn deine Organisation ein Modell auf eigener Infrastruktur verwenden möchte. Du brauchst einen laufenden Inferenzendpunkt, die genaue Modell-ID, Zugriff auf **Einstellungen > KI-Anbieter** und einen Betreiber, der die Netzwerkrichtlinie der Installation konfigurieren kann. Tale installiert oder lädt den Modellserver nicht für dich.

Ein lokaler Chatanbieter bestimmt das Ziel dieser Modellanfrage. Embeddings, Sprache, Werkzeuge und andere Anbieter haben eigene Wege. Diese Verbindung hält deshalb nicht automatisch den gesamten Organisationsverkehr lokal.

## Den Endpunkt mit dem Betreiber abstimmen

Lass dir Anbietername, kompatibles API-Format, Basis-URL, Modell-IDs und Anmeldemethode geben. Die Adresse muss aus den Backend-Prozessen erreichbar sein, nicht nur aus deinem Browser. Innerhalb eines Containers bezeichnet `localhost` diesen Container.

Für eine selbst gehostete Installation folgt der Betreiber [Lokale Anbieterendpunkte](/de/self-hosted/configuration/providers#lokale-anbieterendpunkte). Den Anbieter kannst du auch selbst unter **Einstellungen > KI-Anbieter** über **Zugangsdaten hinzufügen** > **Eigener Anbieter** anlegen ([Einen eigenen Anbieter definieren](/de/platform/admin/providers#einen-eigenen-anbieter-definieren)); die Schritte des Betreibers für Netzwerkzugriff und Richtlinie bleiben. Private Hosts brauchen eine ausdrückliche Freigabe in der Bereitstellung. Öffentliche Endpunkte erfordern HTTPS; unterstützte private Adressen dürfen HTTP verwenden, wenn der Betreiber diese Netzwerkkonfiguration freigibt. Ein Proxyhostname umgeht die Richtlinie für private Hosts nicht.

Ollama, LM Studio und vLLM können kompatible APIs anbieten. Entscheidend sind aber die aktivierten Serverfunktionen und das Modell. Prüfe die tatsächliche Modellliste und eine unterstützte Chatanfrage, bevor du Tale einrichtest.

## Zugangsdaten für die Organisation hinzufügen

1. Öffne **Einstellungen > KI-Anbieter** und wähle **Zugangsdaten hinzufügen**.
2. Wähle die vom Betreiber vorbereitete Anbieterdefinition oder **Eigener Anbieter**, um selbst eine anzulegen; ein von dir angelegter Anbieter trägt die Kennzeichnung **Eigener**.
3. Gib den Zugangsdaten einen passenden Namen und wähle eine unterstützte Anmeldemethode.
4. Trage den echten Servertoken oder die vom Betreiber genannte Umgebungsvariablenreferenz ein. Ignoriert der Inferenzserver die Anmeldung, stimme den nötigen Platzhalter mit seinem Betreiber ab; verwende kein fremdes Geheimnis dafür.
5. Prüfe die **Modell-Freigabeliste** und speichere. Lege die Zugangsdaten als Standard des Anbieters fest, wenn normale Aufrufe sie verwenden sollen.

<Frame caption="Anbieterzugangsdaten gehören zur Organisation; Standardauswahl und Modell-Freigabeliste beeinflussen die Modellauswahl.">

![Die Seite KI-Anbieter zeigt Zugangsdaten eines Anbieters mit Standardkennzeichnung.](/images/get-started/settings-providers.webp)

</Frame>

Bei vorhandenem Modellkatalog erlaubt eine leere Freigabeliste dessen Modelle. Ohne Katalog sind konkrete Modell-IDs nötig. Nutze **Kataloge aktualisieren**, wenn sich die auf dem Server verfügbaren Modelle ändern. Die Modellzugriffsrichtlinie der Organisation gilt zusätzlich.

## Eine Anfrage auf dem Server nachweisen

Beginne einen Chat und wähle das lokale Modell ausdrücklich aus. Verwende **Auto** erst später: Für diesen Test müssen Anbieter und Modell feststehen. Sende eine kurze, harmlose Anfrage, etwa „Antworte mit bereit.“

Lass den Betreiber die Anfrage im Protokoll des gewünschten Inferenzservers bestätigen. Prüfe, ob Tale eine vollständige Antwort zeigt. Gespeicherte Zugangsdaten oder eine gefüllte Modellliste beweisen weniger als eine abgeschlossene Generierung. Die Dauer hängt von Modellgröße, Hardware und Auslastung ab.

Sollen Coding-Agenten den Anbieter nutzen, wiederhole die Prüfung in einer neuen Sandbox-Sitzung mit dem gewünschten Modell und einer kompatiblen Laufzeit. Lass den Betreiber DNS, Erreichbarkeit und TLS-Vertrauen des Gateways ebenso prüfen wie beim Backend. Allgemeine Webzugriffsregeln der Sandbox richten den Modellzugriff nicht ein. Eine Chatantwort und eine Agentenantwort prüfen unterschiedliche Verbindungen.

## Einen fehlgeschlagenen Test eingrenzen

| Symptom | Prüfen |
| --- | --- |
| Anbieter fehlt in der Auswahl | Speicherort und Validierung der Definition sowie Organisationszuordnung. |
| Privater Host wird abgewiesen | Ausdrückliche Freigabe privater Anbieter in der Bereitstellung; ein DNS-Name allein ändert die Regel nicht. |
| Leere Modellliste | Modellerkennung des Servers, geladene Modelle, Freigabeliste und Modellrichtlinie. |
| Verbindungs- oder Zertifikatsfehler | Erreichbarkeit aus dem Backend, Containerhostname und TLS-Vertrauen. |
| Modell abgewiesen oder keine Antwort | Genaue Modell-ID, Anmeldung, API-Kompatibilität und Serverkapazität. |
| Chat funktioniert, aber der Agent erreicht sein Modell nicht | DNS, Erreichbarkeit und TLS-Vertrauen des Gateways, Freigabe privater Anbieter und Laufzeitkompatibilität. |

[KI-Anbieter](/de/platform/admin/providers) erklärt Austausch und Standardauswahl der Zugangsdaten. Halte Endpunkt und Modell-ID in der Betriebsübergabe fest, damit ein anderer Admin diesen Test nach einer Serveränderung wiederholen kann.
