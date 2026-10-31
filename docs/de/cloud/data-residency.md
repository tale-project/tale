---
title: Datenresidenz in der Cloud verstehen
description: Speicherort und Datenflüsse zu Anbietern und Connectors vor der Cloud-Nutzung prüfen.
---

Datenresidenz betrifft den Speicherort und den Ort der Verarbeitung. Mit einer Cloud-Region legst du den Standort des gehosteten Dienstes fest. Daraus folgt nicht automatisch, wo jeder Modellanbieter oder angebundene Dienst deine Daten verarbeitet.

## Das Hosting klären

Kläre vor der Einrichtung die primäre Region, Sicherungsstandorte, Aufbewahrung, Wiederherstellungsziele und den Supportablauf mit Tale. Maßgeblich sind der Dienstleistungsvertrag und die Datenschutzvereinbarungen für deine Installation. Aus einer Regionsbezeichnung im Produkt lässt sich weder ein Sicherungsstandort noch eine Wiederherstellungsgarantie ableiten.

Tale betreibt den Cloud-Dienst. Konfigurationsdateien, Datenbank-Zugangsdaten und Umgebungsvariablen des Hosts liegen beim Betreiber. Die [Referenz für den Eigenbetrieb](/de/self-hosted/configuration/data-residency) erklärt das technische Modell.

## Den Weg einer Anfrage verfolgen

Eine Chatnachricht erreicht deine Tale-Instanz. Nutzt der Assistent Wissen, lädt er passende Inhalte aus dem Wissensspeicher der Organisation. Die Nachricht und der ausgewählte Kontext gehen anschließend an den Modellanbieter dieser Antwort. Ein Werkzeug kann weitere Dienste aufrufen, etwa eine Website oder eine angebundene Anwendung.

| Datenfluss | Was du klären solltest |
| --- | --- |
| Gespeicherte Chats, Dokumente und Konfiguration | Vereinbarte Hosting- und Sicherungsstandorte |
| Wissensindexierung | Welcher Embedding-Anbieter Dokumentinhalte erhält |
| Modellinferenz | Endpunkt, Verarbeitungsbedingungen und Aufbewahrung des gewählten Anbieters |
| Connectors und Webwerkzeuge | Welche externen Systeme Anfragen und Inhalte erhalten |
| Betriebsdaten | Vereinbarter Umgang mit Logs, Sicherungen und Supportzugriff |

Ein Anbieter kann regionale oder lokal betriebene Endpunkte anbieten. Prüfe den tatsächlich konfigurierten Endpunkt. Der Markenname allein belegt keinen Verarbeitungsort.

<Tip>

Prüfe neben dem Chatmodell auch den Embedding-Anbieter. Ein Dokument kann schon während der Indexierung an ihn gesendet werden, bevor jemand eine Frage dazu stellt.

</Tip>

## Prompts auf EU-Endpunkten halten {#eu-processing}

Wo ein Modell einen Prompt verarbeitet, hängt vom Endpunkt ab, den sein Anbieter aufruft, nicht davon, wo Tale läuft. Ist **Prompts nur in der EU/im EWR verarbeiten** unter **Einstellungen > Richtlinien > Modelle** aktiv, sendet Tale einen Modellaufruf nur an den EU-Endpunkt eines Anbieters oder an einen Host, den deine Organisation bestätigt hat. Jeden anderen Aufruf lehnt Tale ab, bevor der Prompt Tale verlässt. [Prompts nur in der EU/im EWR verarbeiten](/de/platform/admin/governance/content-models#eu-processing) beschreibt den Schalter und die Aufrufe, die er abdeckt.

| Endpunkt | Wo ein Prompt verarbeitet wird | Mit aktivem Schalter |
| --- | --- | --- |
| `eu.openrouter.ai` | In Europa, wie OpenRouter es abgrenzt: in der EU/im EWR, im Vereinigten Königreich und in der Schweiz | Erlaubt |
| `eu.api.openai.com` | In der Region Europa von OpenAI: im EWR und in der Schweiz | Erlaubt |
| `api.eu.mistral.ai` | In den Rechenzentren von Mistral in EU- und EFTA-Staaten: im EWR und in der Schweiz | Erlaubt |
| Ein anderer Host von OpenRouter, OpenAI oder Mistral, etwa `openrouter.ai`, `api.openai.com` oder `us.api.openai.com` | Dort, wohin der Anbieter die Anfrage leitet, bei einem US-Endpunkt in den Vereinigten Staaten | Abgelehnt, lässt sich nicht bestätigen |
| Azure OpenAI, eine Bereitstellung vom Typ Standard oder Regional Provisioned in einer Region der EU/des EWR | In der Azure-Geografie ihrer Region, etwa in Schweden für Sweden Central | Erlaubt, sobald du den Host ihrer Ressource bestätigst |
| Azure OpenAI, eine Datenzonen-Bereitstellung für die EU | Innerhalb der EU-Datengrenze: in der EU und den EFTA-Staaten, die Schweiz eingeschlossen | Erlaubt, sobald du den Host ihrer Ressource bestätigst |
| Azure OpenAI, eine Bereitstellung vom Typ Global oder Developer | In jeder Azure-Region | Abgelehnt, außer ihre Ressource ist bestätigt |
| Jeder andere Endpunkt, etwa der Server eines eigenen Anbieters oder ein Modellserver, den du betreibst | Dort, wo dieser Server das Modell ausführt. Ein Proxy oder Router reicht den Prompt weiter, verarbeitet wird er also dort, wo das Ziel der Weiterleitung läuft | Erlaubt, sobald du seinen Host bestätigst |

Jeder Anbieter grenzt sein Europa selbst ab: Keiner der drei EU-Endpunkte beschränkt sich auf die EU/den EWR, und Datenzonen-Bereitstellungen für die EU ebenso wenig. Schließt eine Vorgabe die Schweiz oder das Vereinigte Königreich aus, nutze eine Azure-OpenAI-Bereitstellung vom Typ Standard oder Regional Provisioned in einer Region der EU/des EWR oder einen Server, der in der EU/im EWR läuft. Die Azure-Regionen Switzerland North, Switzerland West, UK South und UK West liegen außerhalb der EU/des EWR.

Bestätigt wird ein Host, keine Bereitstellung: Bestätigst du eine Azure-Ressource, gilt das für jede ihrer Bereitstellungen, auch für eine vom Typ Global. Lege Bereitstellungen vom Typ Global und Developer deshalb in eine Ressource, die du nicht bestätigst.

Jeder Anbieter knüpft seinen EU-Endpunkt an eigene Bedingungen, etwa einen Tarif oder eine Freigabe, kann Konto-, Abrechnungs- und andere Betriebsdaten außerhalb der Region halten und bedient dort nur die Modelle, die er dort anbietet. Prüfe die Bedingungen von [OpenRouter](https://openrouter.ai/docs/guides/features/sovereign-ai), [OpenAI](https://developers.openai.com/api/docs/guides/your-data), [Mistral](https://docs.mistral.ai/inference/regional-inference) und [Azure OpenAI](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types), bevor du dich auf einen von ihnen verlässt.

### Die Organisation auf EU-Endpunkte umstellen

1. Gib jedem Anbieter, den die Organisation nutzt, einen Endpunkt aus der Tabelle. Für OpenRouter, OpenAI oder Mistral definierst du einen [eigenen Anbieter](/de/platform/admin/providers#einen-eigenen-anbieter-definieren), dessen Basis-URL der EU-Endpunkt des Anbieters ist, etwa `https://eu.openrouter.ai/api/v1`.
2. Bestätige unter **Endpunkte mit bestätigter Verarbeitung in der EU/im EWR** die Hosts deiner Azure-Ressourcen und deiner eigenen Server und aktiviere danach **Prompts nur in der EU/im EWR verarbeiten**, wie es [Prompts nur in der EU/im EWR verarbeiten](/de/platform/admin/governance/content-models#eu-processing) beschreibt.
3. Sende eine Chatnachricht und wähle unter der Antwort **Info anzeigen**. **Region** in **Nachrichteninformation** zeigt **Europa** für den EU-Endpunkt eines Anbieters oder die Region, die Azure OpenAI gemeldet hat, etwa Sweden Central. Ein eigener Server meldet meist keine, dann steht dort **Nicht gemeldet**: Der Schalter entscheidet vor dem Aufruf nach dem Endpunkt, unabhängig von dieser Zeile. [Sehen, wie eine Antwort entstanden ist](/de/platform/chat/basics#reply-details) erklärt die Zeile.

### Eine Ablehnung erkennen

Solange der Schalter aktiv ist, bieten die Modellauswahlen nur Modelle an, deren Endpunkt er zulässt, und eine Auswahl, die Modelle auslässt, sagt dir, warum. Ein Aufruf an jeden anderen Endpunkt, etwa an ein Modell, das vor dem Einschalten gewählt wurde, wird abgelehnt, bevor etwas gesendet wird. Die Ablehnung nennt den Grund und was ein Admin ändern kann. Wo sie erscheint, hängt davon ab, was den Aufruf ausgelöst hat:

- **Chat**: Die Antwort wird nicht erzeugt, und der Chat zeigt den Grund. Dieselbe Regel gilt für Chattitel, **Mit KI verbessern**, die Antworten eines Agenten in einer Aufgabe und die Bildgenerierung.
- **Automatisierungen**: Der `llm`-Schritt schlägt mit **Die Modellzugriffsrichtlinie hat den Schritt gestoppt** fehl.
- **Transkription und Sprachausgabe**: Diktat und Audio-Uploads im Chat melden, dass vom Modell für Audiotranskription nicht bekannt ist, dass es in der EU/im EWR verarbeitet. Die Sprachausgabe meldet, dass der Sprach-Anbieter nicht erlaubt ist.
- **Wissen**: Das Indexieren von Dokumenten, E-Mails und Websites wird abgelehnt, ebenso die Suche darin. Ein fehlgeschlagenes Dokument zeigt den Grund. Ist sein Endpunkt korrigiert oder bestätigt, wähle **Indexierung erneut versuchen**: Eine Änderung der Richtlinie stellt das Dokument nicht wieder in die Warteschlange, das Speichern des Embedding-Modells oder seiner Zugangsdaten dagegen schon.
- **API**: Die [Modell-Endpunkte für API-Schlüssel](/de/platform/admin/governance/content-models#model-endpoints) führen nur die Modelle auf, die der Schalter zulässt, und ein Aufruf, der ein anderes nennt, erhält `403` mit `MODEL_API_MODEL_FORBIDDEN` und dem Grund. Ein Modell eines Anbieters aus dem mitgelieferten Katalog wird dort auch auf einem EU-Endpunkt abgelehnt, weil das Modell-Gateway dafür den eigenen Endpunkt des Anbieters aufruft.
- **Guardrails**: Der [Moderations-Anbieter](/de/platform/admin/governance/guardrails#moderation) erhält keinen Text, und seine Prüfung scheitert mit der Fehlerklasse `eu_processing`, als wäre der Anbieter nicht erreichbar. Fail-open lässt die Nachricht durch, Fail-closed lehnt sie ab: Ein Aufruf der Modell-Endpunkte für API-Schlüssel erhält dann `503` mit `MODEL_API_GUARDRAIL_UNAVAILABLE`. Das Speichern des Anbieters mit einem solchen Endpunkt wird abgelehnt, und die Meldung sagt, was zu ändern ist.

Auf der Seite Modelle warnen außerdem die Einstellungen für Bildgenerierung und Audiotranskription, wenn vom Endpunkt ihres Modells nicht bekannt ist, dass er in der EU/im EWR verarbeitet. Eine Ablehnung erscheint in den [Audit-Logs](/de/platform/admin/governance/audit-logs) unter **Einstellungen > Richtlinien > Protokolle** als **Modellzugriff abgelehnt**, mit dem auslösenden Bereich, dem Anbieter, dem Modell und dem Host.

Zwei Teile folgen dem Schalter noch nicht: Die Auswahl des Modells, das Bilder liest, bietet weiterhin jedes Modell an, und der Modellverkehr von Agent-Laufzeiten wie Claude Code oder Codex in einer Sandbox ist nicht daran gebunden.

## Eine neue Integration prüfen

Bestimme vor dem Anbinden, welche Daten die geplante Aufgabe sendet und welches Konto der Connector nutzt. Prüfe die Verarbeitungsbedingungen, begrenze den Zugriff und teste mit unkritischen Beispieldaten. Halte die Entscheidung in deiner [Sicherheitsprüfung](/de/cloud/trust-and-compliance) fest.

## Die Region wechseln

Stimme einen Regionswechsel mit Tale ab. Der Migrationsplan muss gespeicherte Daten, Sicherungen, externe Endpunkte, Unterbrechungen und die Abnahme berücksichtigen. Eine zweite Organisation verschiebt die Daten der ersten nicht.

Die [Migrationsplanung](/de/cloud/migrate-to-self-hosted) enthält Fragen und Prüfschritte, die auch beim Wechsel zwischen Cloud-Regionen gelten.
