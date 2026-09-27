---
title: Personalisierung — Datenschutzhinweis
description: Wie die Personalisierungsschicht von Tale (benutzerdefinierte Anweisungen) mit deinen Daten umgeht, was wir durchsetzen und welche Einschränkungen sich nicht vermeiden lassen.
noindex: true
---

**Letzte Aktualisierung:** 27.09.2026

## 1. Die Zusage

Die Personalisierungsschicht von Tale — deine benutzerdefinierten Anweisungen — basiert auf einer einzigen Zusage:

> **Innerhalb von Tale kann kein anderer Nutzer — auch nicht die Admins deiner Organisation — deine benutzerdefinierten Anweisungen über eine Oberfläche oder API einsehen. Benutzerdefinierte Anweisungen sind standardmäßig AUS und gelten erst, wenn du sie unter Einstellungen › Personalisierung einschaltest oder wenn ein Admin sie für deine Organisation standardmäßig einschaltet und du sie nicht selbst ausgeschaltet hast.**

Diese Seite dokumentiert, was diese Zusage abdeckt und was nicht. Fünf Einschränkungen sind dem Betrieb eines KI-Dienstes auf einem fremden Modell und auf einer Datenbank, die jemand betreiben muss, inhärent und können durch Tales Code allein nicht beseitigt werden.

## 2. Einschränkungen aus dem LLM-Stack

### 2.1 Deine benutzerdefinierten Anweisungen gehen bei jedem Chat-Turn an deinen konfigurierten LLM-Anbieter

Wenn du eine Chat-Nachricht sendest und benutzerdefinierte Anweisungen für dich gelten, werden sie in den System-Prompt aufgenommen, der an das von deiner Organisation konfigurierte Upstream-LLM geht (OpenAI, Anthropic, Google, Azure, dein selbst gehostetes Modell usw.). Damit unterliegen sie den Aufbewahrungs- und Missbrauchskontrollbedingungen dieses Anbieters.

Die meisten großen Hosted-Anbieter speichern Ein- und Ausgaben zur Missbrauchskontrolle für einen begrenzten Zeitraum (üblicherweise 7–30 Tage, Stand Mitte 2026) und bieten Zero-Data-Retention oder vergleichbare Programme für qualifizierte Enterprise-Kunden an. Dauern und Voraussetzungen ändern sich häufig — maßgeblich ist der Vertrag, den deine Organisation mit dem Anbieter hat, sowie die jeweils veröffentlichte Anbieter-Richtlinie:

- Anthropic — [Datenschutzerklärung](https://www.anthropic.com/legal/privacy) · [FAQ zur Datenaufbewahrung](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API Data Usage Policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Data Governance für generative KI](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Daten, Datenschutz & Sicherheit](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Missbrauchskontrolle](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

Für selbst gehostete Modelle oder benutzerdefinierte OpenAI-kompatible Endpunkte (Ollama, vLLM, interne Gateways usw.) gilt keine Drittanbieter-Aufbewahrung — die Aufbewahrung wird vollständig vom Betreiber dieses Endpunkts bestimmt.

Sobald deine Anweisungen gesendet wurden, **kann Tale sie nicht zurückholen**. Wenn du sie änderst oder entfernst, enthalten künftige Anfragen den neuen Stand, aber bereits gesendete Kopien beim Anbieter unterliegen dessen Aufbewahrungsplan.

### 2.2 Self-Hosting: Der Betreiber des Deployments kann Rohdaten lesen

Tale speichert deine benutzerdefinierten Anweisungen in der Postgres-Datenbank deines Deployments, in der Tabelle `app.user_preferences`. Wer in deinem Deployment Zugriff auf die Datenbank oder ihre Backups hat, kann diese Zeilen direkt lesen — Tales rollenbasierte Admin-Sperre („Admins können keine Inhalte sehen“) **gilt nicht auf Datenbankebene**. Beim Self-Hosting solltest du davon ausgehen, dass deine Datenbankbetreiber Zugriff auf alle Personalisierungsinhalte haben. SOC-2- und ISO-Kontrollen für DB-Zugriff liegen in deiner Verantwortung.

### 2.3 Assistenten-Antworten können deine benutzerdefinierten Anweisungen zitieren oder paraphrasieren

Die Antwort des Modells kann deine benutzerdefinierten Anweisungen wörtlich oder paraphrasiert wiedergeben. Diese Antwort wird dann in deinem Chat gespeichert und folgt den **Sichtbarkeitsregeln des Chats**, nicht den Regeln, die deine Anweisungen schützen: Teilst du den Chat, enthält die geteilte Kopie auch diese Antwort. Wenn du deine Anweisungen änderst oder entfernst, werden vergangene Antworten nicht rückwirkend geschwärzt.

### 2.4 Datenbank- und Server-Logs

Tales Anwendungscode hält deine benutzerdefinierten Anweisungen aus den eigenen Logs und Fehlerberichten heraus. Der Datenbankserver und die Infrastruktur drumherum führen jedoch eigene Logs: Schaltet dein Betreiber in Postgres das Statement-Logging ein, kann der gespeicherte Text dort landen. Diese Logs kann Tale nicht schwärzen.

### 2.5 Missbrauchskontrolle der Anbieter

Große LLM-Anbieter führen automatische Missbrauchserkennung über die empfangenen Eingaben durch. Als verdächtig markierte Inhalte können vom Missbrauchsteam des Anbieters überprüft werden. Sofern verfügbar, kann mit Zero-Data-Retention-Endpunkten (ZDR) ausgestiegen werden. Personalisierungs-Anfragen unterscheiden sich diesbezüglich nicht von anderen Anfragen.

## 3. Was Tale durchsetzt

- **Standardmäßig aus.** Ohne Organisations-Standard und ohne eigene Wahl werden benutzerdefinierte Anweisungen nie an das Modell gesendet. Leere Anweisungen gelten als nicht vorhanden, auch wenn die Funktion eingeschaltet ist.
- **Zwei Ebenen.** Ob deine benutzerdefinierten Anweisungen gelten, entscheiden zwei Einstellungen:
  - **Organisations-Standard** — von Admins gesteuert unter Einstellungen › Richtlinien › Richtlinien & Limits. Ist er eingeschaltet, sind die Anweisungen für Mitglieder standardmäßig eingeschaltet, sonst ausgeschaltet.
  - **Deine Wahl** — schaltest du sie unter Einstellungen › Personalisierung selbst ein oder aus, hat deine Wahl in beide Richtungen Vorrang vor dem Organisations-Standard. Die Seite zeigt dir, ob du dem Organisations-Standard folgst oder ihn überschreibst.
- **Kein Admin-Bypass.** Auch die Admin-Rolle verschafft keinen Zugriff auf die Zeile eines anderen Nutzers. Jeder Lese- und Schreibzugriff erreicht nur die eigene Zeile der angemeldeten Person und prüft die Mitgliedschaft bei jeder Anfrage neu, damit ein bereits entfernter Nutzer mit noch gültiger Sitzung diese Zeile nicht mehr lesen kann.
- **Ausschalten löscht nichts.** Schaltest du benutzerdefinierte Anweisungen aus, werden sie nicht mehr gesendet, der Text bleibt aber gespeichert und ist wieder da, sobald du sie einschaltest. Um ihn zu entfernen, leere das Feld und speichere; frühere Fassungen bewahrt Tale nicht auf.
- **Endgültige Löschung per Kaskade.** Das Entfernen eines Nutzers aus einer Organisation, das Löschen der Organisation oder die Ausführung einer Löschungsanfrage für diesen Nutzer (von einem Admin eingereicht unter Einstellungen › Richtlinien › Anfragen betroffener Personen) löscht im selben Vorgang die Präferenzen des Nutzers in dieser Organisation endgültig, benutzerdefinierte Anweisungen eingeschlossen. Ein aktiver Legal Hold auf dem Nutzer oder auf der ganzen Organisation blockiert alle drei Vorgänge, bis er aufgehoben ist. Das Audit-Log hält jeden dieser Vorgänge fest, aber nie den Text der Anweisungen. Das eigene Konto zu löschen ist noch nicht möglich; sobald es geht, löscht das diese Zeilen ebenfalls.

## 4. AVV-Anhang (Entwurf)

Kunden, die eine Erweiterung ihrer Auftragsverarbeitungsvereinbarung (AVV) für Personalisierungsinhalte benötigen, sollten den **Personalization Processor Annex** anfordern, der Folgendes abdeckt:

- Kategorien personenbezogener Daten: freitextliche, vom Nutzer verfasste Anweisungen; Audit-Metadaten ohne Inhalt der Anweisungen.
- Zwecke: ausschließlich Personalisierung der Chat-Antworten pro Nutzer.
- Unterauftragsverarbeiter: der pro Organisation konfigurierte LLM-Anbieter (siehe „Deine benutzerdefinierten Anweisungen gehen…“ oben).
- Aufbewahrung: unbefristet, solange der Nutzer Mitglied der Organisation ist, auch bei ausgeschalteter Funktion; sofortige Löschung, wenn der Nutzer das Feld leert, beim Entfernen des Mitglieds, beim Löschen der Organisation oder bei Ausführung einer Löschungsanfrage.
- Grenzüberschreitende Übermittlung: richtet sich nach der Datenresidenz des LLM-Anbieters und der vom Kunden gewählten Anbieterregion.
- Betroffenenrechte: Löschung der Inhalte (Art. 17 per Kaskade beim Entfernen des Mitglieds und beim Löschen der Organisation sowie per Löschungsanfrage). Audit-Log-Metadaten (ohne Inhalt) werden zur Compliance aufbewahrt. Ein vom Betreiber ausführbarer Export (Art. 15/20) steht gegen die zugrunde liegenden Tabellen zur Verfügung; produktinterner Self-Service-Export ist für v2 geplant.
