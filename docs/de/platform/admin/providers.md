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
3. Prüfe das Feld **Name**. Es enthält bereits den Namen des Anbieters. Heißen andere Zugangsdaten dieses Anbieters schon so, hängt Tale eine Zahl an: `OpenRouter`, dann `OpenRouter 2`. Mit einem Namen, der den Zweck erkennen lässt, etwa `Produktionsschlüssel` oder `Finanzteam`, hältst du mehrere Zugangsdaten desselben Anbieters auseinander. Fülle die Pflichtfelder der Methode aus.
4. Prüfe die Liste **Erlaubte Modelle**. Hat der Anbieter einen Katalog, erlaubt eine leere Liste dessen Modelle. Ohne Katalog sind ausdrückliche Modell-IDs erforderlich.
5. Wähle **Hinzufügen**. Prüfe den neuen Eintrag und setze ihn als Standard für den Anbieter, wenn gewöhnliche Anfragen ihn verwenden sollen.

Teste Zugangsdaten vom Typ **API-Schlüssel** oder **Umgebungsvariable** mit einer kurzen Chatnachricht an das gewünschte Modell. Das Modell muss über aktive Zugangsdaten erreichbar und durch die Modellzugriffsregeln der Organisation erlaubt sein. Abonnement-Zugangsdaten prüfst du wie unten beschrieben mit einem Aufgaben- oder Automatisierungsagenten. Gespeicherte Zugangsdaten allein belegen noch keinen funktionierenden Aufruf.

## Die Anmeldemethode wählen

| Methode | Benötigte Angaben | Einsatz |
| --- | --- | --- |
| **API-Schlüssel** | Der geheime Schlüssel des Anbieters | Gewöhnlicher, nutzungsabhängig abgerechneter API-Zugriff. Der gespeicherte Wert ist verschlüsselt und später nur maskiert sichtbar. |
| **Umgebungsvariable** | Der Name einer Bereitstellungsvariable | Ein Betreiber verwaltet das Geheimnis außerhalb der Oberfläche. Der Name muss mit `TALE_PROVIDER_KEY_` beginnen. |
| **Abo-Schlüssel** | Ein unterstütztes Abonnement-Geheimnis des Anbieters | Ausführung über die unterstützte Agent-Laufzeit des Anbieters in Aufgaben und Automatisierungen, nie im Chat. |
| **Abo-Broker** | Broker-Endpunkt und Konfiguration seiner Token-Antwort | Die Bereitstellung bezieht nutzbare Abonnement-Tokens von einem Broker, für die Agent-Laufzeit des Anbieters in Aufgaben und Automatisierungen, nie im Chat. |

Es erscheinen nur Methoden, die der ausgewählte Anbieter unterstützt. Ein Variablenverweis legt die Variable nicht an. Der Betreiber muss sie gemäß der [Anbieterkonfiguration](/de/self-hosted/configuration/providers) bereitstellen.

## Abos in Aufgaben nutzen, nicht im Chat

Zugangsdaten vom Typ **Abo-Schlüssel** oder **Abo-Broker** funktionieren nur in der Agent-Laufzeit, an die sie gebunden sind: Claude Code für ein Anthropic-Abonnement und für die Coding-Pläne von Moonshot und Z.ai, Codex für ein ChatGPT-Abonnement, Gemini CLI für Gemini und Hermes für Nous Portal. Die Anbieter erlauben Abo-Tokens nicht in anderen Anwendungen, und Anthropic weist sie bei jedem Client außer Claude Code ab. Der Chat ruft die API des Anbieters direkt aus Tale auf und kann deshalb keine Abo-Zugangsdaten verwenden.

Tale führt ein Abo deshalb in Aufgaben und Automatisierungen aus, wo seine Laufzeit in einer Sandbox arbeitet. Der Chat bietet nur Modelle an, die Zugangsdaten vom Typ **API-Schlüssel** oder **Umgebungsvariable** bereitstellen. Die App weist an drei Stellen darauf hin: Das Formular zum Hinzufügen zeigt **Nur für Aufgaben und Automatisierungen**, sobald du eine Abo-Methode wählst, jede Abo-Zeile in der Tabelle der Zugangsdaten trägt denselben Hinweis, und die Modellliste im Chat nennt die Abos, die sie auslässt.

Um mit einem Modell zu chatten, das du über ein Abo erreichst, füge für denselben Anbieter Zugangsdaten per API-Schlüssel oder Umgebungsvariable hinzu oder verbinde einen Anbieter wie OpenRouter, der das Modell bereitstellt.

## Ein Claude-OAuth-Token einfügen

Um ein Anthropic-Abonnement ohne Broker zu nutzen, wähle **Abo-Schlüssel** und füge ein Claude-OAuth-Token ein, etwa eines aus `claude setup-token`. Tale übergibt das Token in Aufgaben und Automatisierungen als `CLAUDE_CODE_OAUTH_TOKEN` an Claude Code.

Tale erneuert ein eingefügtes Token nicht. Läuft es ab oder wechselst du zu einem anderen Claude-Konto, füge über die Ersetzen-Aktion der Zeile ein neues ein und starte die Aufgabe danach erneut. [Zugangsdaten rotieren oder stilllegen](#zugangsdaten-rotieren-oder-stilllegen) beschreibt diese Aktion.

## Einen OpenAI-ChatGPT-Abonnement-Token einfügen

Wähle **Abo-Schlüssel**, füge den Zugriffstoken ein und trage die ChatGPT-**Konto-ID** aus dem Anspruch `chatgpt_account_id` ein. Tale übergibt beide Werte als `TALE_SUBSCRIPTION_TOKEN` und `TALE_SUBSCRIPTION_ACCOUNT_ID` an Codex. Beschränke die Modelle auf dein ChatGPT-Abo; die Zugangsdaten funktionieren nur in Aufgaben und Automatisierungen.

## Einen Abo-Broker verbinden

Abo-Broker unterstützen Anthropic-Abonnements über Claude Code und OpenAI-ChatGPT-Abonnements über Codex. Diese Zugangsdaten dienen Agenten für Aufgaben und Automatisierungen. Chats benötigen Zugangsdaten für den direkten API-Zugriff, aus den [oben genannten Gründen](#abos-in-aufgaben-nutzen-nicht-im-chat).

| Anbieter und Laufzeit | Zielvariable |
| --- | --- |
| Anthropic · Claude Code | `CLAUDE_CODE_OAUTH_TOKEN` |
| OpenAI · Codex | `TALE_SUBSCRIPTION_TOKEN` |

Wähle beim Hinzufügen der Zugangsdaten **Abo-Broker** und lass dir Endpunkt und Anmeldeangaben vom Betreiber geben. Der Endpunkt muss ausschließlich Tokens des gewählten Anbieters liefern. Beim Tale AI Gateway ist das `/api/tokens/anthropic` oder `/api/tokens/openai`.

Trage unter **Pfad zum Token-Array** den Wert `$.tokens` ein, unter **Token-Feld** den Wert `access_token` und unter **Ziel-Umgebungsvariable** den Wert aus der Tabelle. Verwende unter **Erweitert** das **Status-Feld** `status`, den **Wert für aktiv** `active` und das **Ablauf-Feld** `expires_at`, und lass **Sicherheitsabstand zum Ablauf (ms)** beim Standardwert. Das Gateway hält ein Konto, dessen Token bald erneuert wird, selbst zurück, solange ein anderes Konto die Arbeit übernehmen kann; Tale nutzt es trotzdem, wenn kein anderes verfügbares Konto den Durchlauf übernehmen kann, etwa während die anderen nach Erreichen eines Rate-Limits pausieren. Bei anderen Brokern können die Pfade abweichen. OpenAI-Pools müssen zusätzlich für jedes nutzbare Token die `account_id` des Anbieters liefern. Die brokerinterne `id` ist eine separate Kontokennung.

Begrenze bei OpenAI **Erlaubte Modelle** auf Modell-IDs, die dein ChatGPT-Abonnement unterstützt. Der OpenAI-API-Katalog kann Modelle enthalten, die dieses Abonnement nicht nutzen kann.

Um ein GPT-6-Modell über das ChatGPT-Abonnement zu nutzen, speicherst du zuerst die OpenAI-Broker-Zugangsdaten. Wähle dann bei einem [Projektagenten](/de/platform/projects/project-agents) unter **Agent-Laufzeit** den Eintrag **Codex**. Suche unter **Modell** nach der Modell-ID, etwa `gpt-6.1-sol`, und wähle den Eintrag mit **OpenAI · Abo**. [Die GPT-6-Modelle nutzen](#die-gpt-6-modelle-nutzen) erklärt, wo jedes Modell sonst läuft.

Mit **Token-Auswahl** bestimmst du, wie neue Agentendurchläufe verteilt werden:

- **Zufällig** ist vorausgewählt. Bei jeder Auswahl haben alle nutzbaren Konten die gleiche Wahrscheinlichkeit.
- **Erstes nutzbares** nimmt immer das erste nutzbare Konto in der Reihenfolge des Brokers. Damit legst du eine bevorzugte Reihenfolge fest; die Arbeit wird dadurch nicht verteilt.
- **Round-Robin** wählt das nutzbare Konto, dessen letzte Auswahl am längsten zurückliegt. Alle Backend-Prozesse teilen sich den Auswahlverlauf für diese Organisation und diese Zugangsdaten, auch bei gleichzeitigen Anfragen. Eine andere Antwortreihenfolge und Backend-Neustarts erhalten diesen Verlauf. Stabile Kontokennungen des Brokers erhalten ihn auch bei Tokenwechseln. So werden Auswahlen verteilt, nicht zwingend der Tokenverbrauch oder die Anzahl laufender Agenten.

Speichere die Zugangsdaten und starte eine kurze Aufgabe oder Automatisierung mit dem passenden Anbieter und der passenden Agent-Laufzeit. Prüfe, ob der Agent eine Antwort abschließt. Ist kein Konto nutzbar, sollte der Betreiber Autorisierung, Token-Ablauf und geplante Token-Erneuerungen sowie das gemeldete Kontingent prüfen. Die [Broker-Konfigurationsreferenz](/de/self-hosted/configuration/providers#einen-abo-broker-verbinden) erklärt optionale Kontometadaten, Standardwerte und Abhilfe.

## Die GPT-6-Modelle nutzen

Der OpenAI-Katalog enthält GPT-6 Astra (`gpt-6-astra`), GPT-6 Sol (`gpt-6-sol`), GPT-6 Luna (`gpt-6-luna`) und GPT-6.1 Sol (`gpt-6.1-sol`).

- Der **Chat** bietet alle vier über OpenAI-Zugangsdaten vom Typ **API-Schlüssel** oder **Umgebungsvariable** an, auch in der automatischen Modellauswahl. Astra und GPT-6.1 Sol rufen Tools nur über die Responses-API von OpenAI auf, deshalb spricht Tale sie über diese API an. GPT-6 Sol und Luna nehmen die Tools des Chats nur mit ausgeschaltetem Reasoning an, deshalb bietet die Auswahl für sie keine Stufen für **Denkaufwand** an.
- **Projektagenten und Automatisierungen** führen Astra und GPT-6.1 Sol nur auf **Codex** aus, der Laufzeit, die die Responses-API spricht, mit Zugangsdaten per API-Schlüssel, Umgebungsvariable oder ChatGPT-Abo. Für andere Laufzeiten bietet die Modellauswahl sie nicht an.

## Azure oder einen eigenen Endpunkt einrichten

Azure OpenAI benötigt eine **Endpoint-URL**, gewöhnlich `https://<resource>.openai.azure.com/openai/v1`. Jeder Zugangsdaten-Eintrag gehört zu dieser Ressource. Azure verwendet die dort konfigurierten Bereitstellungsnamen als Modell-IDs. Trage diese Namen in die Liste **Erlaubte Modelle** ein. Ohne Katalog stellt eine leere Liste keine Modelle bereit.

Verwende dokumentierte Endpunkte und Modellkennungen des Anbieters. Ein Anzeigename auf einer Produktseite muss nicht der von der API akzeptierten Kennung entsprechen.

## Einen eigenen Anbieter definieren

Eine Organisation kann einen Endpunkt anbinden, den der mitgelieferte Katalog nicht kennt: einen eigenen Modellserver wie vLLM oder Ollama oder ein internes Gateway, das die OpenAI- oder Anthropic-API spricht. Wähle **Zugangsdaten hinzufügen** und dann **Eigener Anbieter**, den Eintrag unterhalb des Katalogs:

1. Gib einen **Anbietername** ein. Er benennt den Anbieter und diese Zugangsdaten; die Kennung des Anbieters wird daraus abgeleitet.
2. Wähle das **API-Format**, das der Endpunkt spricht, und trage seine **Basis-URL** ein, also die API-Wurzel, an die die Plattform ihre Pfade anhängt. Ein öffentlicher Host braucht `https`.
3. Behalte unter **Modelle** die Option **Vom Endpunkt ermitteln**, damit die `/models`-Liste des Servers mit diesem Schlüssel gelesen wird, oder wähle **Modell-IDs eingeben** und trage die genauen IDs unter **Erlaubte Modelle** ein, wenn der Endpunkt seine Modelle nicht auflisten kann.
4. Trage den **API-Schlüssel** (oder die Umgebungsvariable) ein und wähle **Hinzufügen**.

Die Zeile der Zugangsdaten zeigt den Anbieter jetzt mit der Kennzeichnung **Eigener**, und der Anbieter erscheint mit derselben Kennzeichnung im Katalog von **Zugangsdaten hinzufügen**; wählst du ihn dort, legst du weitere Zugangsdaten für ihn an. Eine private oder Loopback-Adresse braucht zusätzlich die Freigabe privater Hosts in der Bereitstellung; die setzt ein Betreiber, das Speichern der Zugangsdaten allein gibt sie nicht frei. Lass den Betreiber Erreichbarkeit und Netzwerkrichtlinie vorbereiten und folge dann [Einen lokalen Modellserver verbinden](/de/tutorials/admin/connect-local-provider). Sollen Coding-Agenten den Anbieter nutzen, prüfe zusätzlich eine Agentensitzung: Deren Modellverkehr läuft über ein eigenes Gateway, das ebenfalls Netzwerkzugriff und Zertifikatsvertrauen braucht.

Im Menü der Zeile liest **Modelle prüfen** die Modellliste des Endpunkts erneut mit diesem Schlüssel, **Zugangsdaten bearbeiten** ändert neben dem Namen auch Basis-URL, API-Format und Modellquelle, und **Löschen** entfernt die Zugangsdaten. Beim Bearbeiten ändert **Speichern** Anbieter und Zugangsdaten gemeinsam: Ein bereits vergebener Name oder ein veralteter Stand wird abgelehnt, bevor sich eines davon ändert. Hat jemand den Anbieter oder diese Zugangsdaten gespeichert, nachdem du den Dialog geöffnet hast, wird dein Speichern abgelehnt, statt die andere Änderung zu überschreiben; öffne den Dialog erneut, um den aktuellen Stand zu laden. Mit den letzten Zugangsdaten eines Anbieters verschwindet auch der Anbieter selbst; der Dialog sagt das vorher. Jede gespeicherte Version der Definition bleibt im Konfigurationsverlauf der Organisation erhalten. Was das Formular nicht abdeckt, etwa ein Endpunkt für Coding-Agenten, wird in der Definitionsdatei gesetzt, die der [Leitfaden zur Anbieterkonfiguration](/de/self-hosted/configuration/providers) beschreibt.

Bricht die Verbindung beim **Speichern** ab, kann das Ergebnis unklar sein. Lade die Seite neu und prüfe Anbieter und Zugangsdaten, bevor du es erneut versuchst. Ein Verbindungsfehler bedeutet nicht, dass die Änderungen zurückgenommen wurden.

## Standard und Modellzugriff festlegen

Wähle **Zum Standard machen** im Zeilenmenü. Pro Anbieter gibt es einen Standard. Die Auswahl eines anderen Eintrags verschiebt die Kennzeichnung. Deaktivierte Zugangsdaten können kein Standard sein. Ohne Standard muss ein Aufrufer den gewünschten Eintrag ausdrücklich benennen.

Die Liste **Erlaubte Modelle** eines Eintrags begrenzt nur diese Zugangsdaten. Unter [Modelle](/de/platform/admin/governance/content-models) legst du anbieterübergreifend Standardmodelle und Zugriffsregeln für Personen, Teams und Rollen fest. Beide Einschränkungen gelten. Eine erweiterte Liste umgeht die andere nicht.

**Agent-Laufzeiten** unter der Tabelle ist schreibgeschützt. Dort siehst du verfügbare Modelle und Abonnements je Laufzeit. Um diese Konfiguration zu ändern, bearbeitest du die Zugangsdaten darüber. Eine Laufzeit ist als **Zuletzt fehlerhaft** markiert, wenn in den letzten 30 Minuten mindestens die Hälfte ihrer Läufe fehlgeschlagen ist, ab drei Läufen. Kann Tale das nicht prüfen, weist ein Hinweis über der Liste darauf hin, mit **Erneut versuchen**.

## Fehlende oder nicht funktionierende Modelle prüfen

- Fehlt ein Anbieterstandard, wähle die vorgesehenen aktiven Zugangsdaten und setze sie als Standard.
- Konnte der Katalog nicht geladen werden, nutze **Kataloge aktualisieren** und prüfe das Ergebnis für den Anbieter. Live-Kataloge werden zwischengespeichert; mitgelieferte Kataloge ändern sich mit der Plattform.
- Fehlt ein Modell, prüfe die Allowlist und die Modellzugriffsregeln der Organisation. Ohne Katalog müssen die Modell-IDs exakt stimmen.
- Wird eine Anfrage abgelehnt, prüfe Aktivierung, Anbieterzugriff, Endpunkt und Kontingent beim Anbieter, bevor du Modellregeln änderst.

## Zugangsdaten rotieren oder stilllegen

Nutze die Ersetzen-Aktion im Zeilenmenü, um ein Geheimnis zu rotieren und Namen sowie Verweise zu behalten. **Deaktivieren** pausiert den Eintrag, ohne seine Konfiguration zu entfernen; **Aktivieren** schaltet ihn wieder frei. Prüfe den Ersatz mit dem vorgesehenen Modell.

<Warning>

Das Löschen eines Eintrags entzieht abhängigen Aufrufern den Zugriff. Stelle sie vorher um. Wenn du den Standard löschst, wähle einen neuen, damit Aufrufe ohne ausdrückliche Auswahl weiterhin Zugangsdaten finden. Zugangsdaten, die das Embedding-Modell der Wissenssuche verwendet — die unter **Einstellungen > Datenresidenz > Embedding-Modell** gewählten oder der letzte aktive Standard dieses Anbieters — lassen sich nicht löschen: Der Löschdialog nennt die Abhängigkeit, und Tale lehnt das Löschen ab. Wähle zuerst andere Zugangsdaten für das Embedding-Modell.

</Warning>
