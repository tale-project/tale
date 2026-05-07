---
title: Personalisierung & Memory — Datenschutzhinweis
description: Wie die Personalisierungsschicht von Tale (Custom Instructions und Memories) mit deinen Daten umgeht, was wir durchsetzen und welche Einschränkungen sich nicht vermeiden lassen.
noindex: true
---

**Letzte Aktualisierung:** 03.05.2026

## 1. Die Zusage

Die Personalisierungsschicht von Tale (Custom Instructions und Memories) basiert auf einer einzigen Zusage:

> **Innerhalb von Tale kann kein anderer Nutzer — auch nicht die Admins deiner Organisation — deine Custom Instructions oder Memory-Inhalte über eine Oberfläche oder API einsehen. Personalisierung ist standardmäßig AUS; du musst sie unter `/settings/personalization` explizit aktivieren.**

Diese Seite dokumentiert, was diese Zusage abdeckt und was nicht. Fünf Einschränkungen sind dem Betrieb eines KI-Dienstes auf einem fremden Modell inhärent und können durch Tales Code allein nicht beseitigt werden.

## 2. Einschränkungen aus dem LLM-Stack

### 2.1 Memory-Inhalte gehen bei jedem Chat-Turn an deinen konfigurierten LLM-Anbieter

Wenn du eine Chat-Nachricht sendest und Personalisierung aktiv ist, werden deine Custom Instructions und freigegebenen Memories in den System-Prompt aufgenommen, der an das von deiner Organisation konfigurierte Upstream-LLM geht (OpenAI, Anthropic, Google, Azure, dein selbst gehostetes Modell usw.). Memory-Inhalte unterliegen dann den Aufbewahrungs- und Missbrauchskontrollbedingungen dieses Anbieters.

Die meisten großen Hosted-Anbieter speichern Ein- und Ausgaben zur Missbrauchskontrolle für einen begrenzten Zeitraum (üblicherweise 7–30 Tage, Stand Mitte 2026) und bieten Zero-Data-Retention oder vergleichbare Programme für qualifizierte Enterprise-Kunden an. Dauern und Voraussetzungen ändern sich häufig — maßgeblich ist der Vertrag, den deine Organisation mit dem Anbieter hat, sowie die jeweils veröffentlichte Anbieter-Richtlinie:

- Anthropic — [Datenschutzerklärung](https://www.anthropic.com/legal/privacy) · [FAQ zur Datenaufbewahrung](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- OpenAI — [API Data Usage Policies](https://openai.com/policies/api-data-usage-policies/)
- Google Vertex AI / Gemini — [Data Governance für generative KI](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)
- Azure OpenAI / Microsoft Foundry — [Daten, Datenschutz & Sicherheit](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/openai/data-privacy) · [Missbrauchskontrolle](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/abuse-monitoring)

Für selbst gehostete Modelle oder benutzerdefinierte OpenAI-kompatible Endpunkte (Ollama, vLLM, interne Gateways usw.) gilt keine Drittanbieter-Aufbewahrung — die Aufbewahrung wird vollständig vom Betreiber dieses Endpunkts bestimmt.

Sobald Memory-Inhalte gesendet wurden, **kann Tale sie nicht zurückrufen**. Wenn du ein Memory löschst, entfällt es aus zukünftigen Anfragen, aber bereits gesendete Kopien beim Anbieter unterliegen dessen Aufbewahrungsplan.

### 2.2 Self-Hosting: Der Betreiber des Deployments kann Rohdaten lesen

Tale unterstützt Self-Hosting auf Basis von Convex. Wer Datenbank- oder Convex-Dashboard-Zugriff in deinem Deployment hat, kann die Rohzeilen von `userPreferences` und `userMemories` lesen — Tales rollenbasierte Admin-Sperre („Admins können keine Inhalte sehen“) **gilt nicht auf Datenbankebene**. Beim Self-Hosting solltest du davon ausgehen, dass deine Convex-Betreiber Zugriff auf alle Personalisierungsinhalte haben. SOC-2- und ISO-Kontrollen für DB-Zugriff liegen in deiner Verantwortung.

### 2.3 Assistenten-Antworten können deine Memories zitieren oder paraphrasieren

Die Antwort des Modells kann ein Memory wörtlich oder paraphrasiert wiedergeben, wenn es zur Generierung verwendet wurde. Diese Antwort wird dann in deinem Thread gespeichert und folgt den **Sichtbarkeitsregeln des Threads**, nicht denen des Memory. Wenn du einen Thread teilst, wird die Personalisierung für alle weiteren Turns des Eigentümers automatisch abgeschaltet — bereits zuvor unter Personalisierung erzeugte Antworten verbleiben jedoch im geteilten Thread; das Löschen eines Memory redigiert vergangene Antworten nicht rückwirkend.

### 2.4 Convex-Plattform-Logs

Die plattforminternen Function-Call-Logs von Convex können Mutationsargumente enthalten. Argumente von Memory-Schreib-Mutationen können in diesen Logs landen. Tale redigiert Pre-LLM-Call-Debug-Logs und vermeidet das Loggen von Memory-Inhalten aus dem Anwendungscode, doch die strukturellen Logs der Plattform liegen außerhalb von Tales Redaktionsoberfläche.

### 2.5 Missbrauchskontrolle der Anbieter

Große LLM-Anbieter führen automatische Missbrauchserkennung über die empfangenen Eingaben durch. Als verdächtig markierte Inhalte können vom Missbrauchsteam des Anbieters überprüft werden. Sofern verfügbar, kann mit Zero-Data-Retention-Endpunkten (ZDR) ausgestiegen werden. Personalisierungs-Anfragen unterscheiden sich diesbezüglich nicht von anderen Anfragen.

## 3. Was Tale durchsetzt

- **Standardmäßig aus.** Ohne Organisationsrichtlinie und ohne Nutzer-Opt-in wird Personalisierung nie an das Modell gesendet — Lese- und Schreibpfade brechen kurzgeschlossen ab.
- **Dreifach-Gating.** Ob Personalisierung für einen Chat gilt, ergibt sich aus drei unabhängigen Signalen; sobald eines davon blockt, werden weder Custom Instructions noch Memories gesendet:
  - **Organisations-Default** — Admin-gesteuert. Bei „an“ erben Mitglieder „an“; bei „aus“ oder fehlend erben Mitglieder „aus“.
  - **Deine Präferenz** — dein explizites An/Aus überstimmt den Organisations-Default in beide Richtungen.
  - **Thread-Sperre** — ein hartes Aus pro Thread (z. B. geteilte Threads).
- **Kein Admin-Bypass.** Die Admin-Rolle umgeht keine fremde Nutzerzeile. Jede öffentliche Lese- und Schreib-Schnittstelle verlangt eine exakte Nutzer-ID-Übereinstimmung plus eine Live-Mitgliedschaftsprüfung, damit ein bereits entfernter Nutzer mit noch gültigem Token keine veralteten Zeilen mehr lesen kann.
- **Auto-Aus beim Teilen.** Beim Teilen eines Threads wird die Personalisierung automatisch deaktiviert; beim Aufheben der Freigabe wieder aktiviert.
- **Cascade-Hardlöschung.** Das Entfernen eines Nutzers aus einer Organisation oder das Löschen der Organisation löscht sofort alle zugehörigen Personalisierungs-Inhaltszeilen hart (Custom Instructions, Memories, Präferenzen). Audit-Log-Einträge, die diese Vorgänge protokollieren, werden ohne Inhalt aufbewahrt — nur Zeitstempel, Aktionstyp und die rohe Subjekt-Nutzer-ID — zur Compliance-Berichterstattung; admin-blinde Pseudonymisierung wird angewendet, sobald eine admin-lesbare Audit-Ansicht ausgeliefert wird. Selbstlöschung des Accounts ist noch kein Produktfeature; der zugehörige Cascade-Hook wird mit dem User-Delete-Plugin nachgereicht.
- **Soft-Delete-Fenster für freigegebene Memories.** Vom Nutzer initiiertes Löschen eines freigegebenen Memory startet ein 30-tägiges Soft-Delete-Fenster, bevor der Speicher per opportunistischem Cleanup zurückgewonnen wird. Ein verworfener Vorschlag — abgelehnt über die Inline-Karte im Chat oder den Tab „Ausstehend“ — wird im Moment des Verwerfens hart gelöscht.

## 4. DPA-Anhang (Entwurf)

Kunden, die eine Erweiterung ihres Auftragsverarbeitungsvertrags für Personalisierungsinhalte benötigen, können den **Personalization & Memory Processor Annex** anfordern, der Folgendes abdeckt:

- Kategorien personenbezogener Daten: freitextliche, vom Nutzer verfasste Instruktionen; LLM-vermittelte Fakten über den Nutzer; rohformatige Audit-Metadaten.
- Zwecke: ausschließlich Personalisierung der Chat-Antworten pro Nutzer.
- Unterauftragsverarbeiter: der pro Organisation konfigurierte LLM-Anbieter (siehe „Memory-Inhalte gehen…“ oben).
- Aufbewahrung: unbefristet, solange der Nutzer Mitglied der Organisation ist und Personalisierung aktiviert bleibt; 30 Tage nach Soft-Delete; sofort bei Hardlöschung.
- Grenzüberschreitende Übermittlung: gemäß Residency des LLM-Anbieters und der vom Kunden gewählten Anbieterregion.
- Betroffenenrechte: Löschung der Inhalte (Art. 17 per Cascade bei Member-Entfernung und Org-Löschung). Audit-Log-Metadaten (ohne Inhalt) werden zur Compliance aufbewahrt und pseudonymisiert, sobald admin-lesbare Audit-Ansichten eingeführt werden. Ein vom Betreiber ausführbarer Export (Art. 15/20) steht gegen die zugrunde liegenden Tabellen zur Verfügung; produktinterner Self-Service-Export ist für v2 geplant.
