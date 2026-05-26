---
title: Platform-Übersicht
description: Produktdokumentation für Tale — Funktionen, Rollen und Organisationsverwaltung. Gilt identisch für Cloud und selbst gehostete Instanzen.
---

Platform ist die vollständige Produktdokumentation zu Tale. Sie beschreibt jede nutzerseitige Funktion — Chat, Wissensdatenbank, Agents, Automatisierungen, Integrationen — und enthält zusätzlich rollenspezifische Aufgaben-Leitfäden sowie alle Einstellungen auf Organisationsebene (Mitglieder, Rollen, Teams, Branding, Governance, KI-Anbieter, Analytics). Alles hier gilt gleichermaßen, egal ob du die gemanagte [Cloud](/de/cloud)-Edition nutzt oder eine eigene [selbst gehostete](/de/self-hosted) Instanz betreibst.

Nur editionsspezifische Themen gehören **nicht** hierher: Cloud-Abrechnung, regionale Datenhaltung und gehostetes SSO stehen unter Cloud; Installation, Umgebungskonfiguration, Observability und Release Notes stehen unter selbst gehostet. Alles, was du in der Produktoberfläche siehst, ist in diesem Bereich beschrieben.

## Nach Funktion

- **[Chat](/de/platform/chat/basics)** — die Konversationsoberfläche. Anhänge, Agents im Chat, Arena-Modus für den direkten Modellvergleich.
- **[Arbeitsbereich](/de/platform/workspace/knowledge-base)** — Wissensdatenbank, Konversationen, Genehmigungen, Canvas, Prompt-Bibliothek und Dokumentenvergleich.
- **[Agents](/de/platform/agents/concepts)** — eigene KI-Assistenten: was sie sind, wie du einen anlegst und wie Versionen funktionieren.
- **[Automatisierungen](/de/platform/automations/concepts)** — mehrstufige Workflows, Trigger und Ausführungsprotokolle.
- **[Wissen](/de/platform/knowledge/structured-data)** — strukturierte Daten und Website-Crawling.
- **[Integrationen](/de/platform/integrations/overview)** — Tale mit KI-Anbietern, Datenquellen und Drittanbieter-Tools verbinden.

## Nach Rolle

Tale kennt sechs Rollen. Vier davon bekommen hier einen aufgabenorientierten Leitfaden; Inhaber entspricht Admin plus einigen Lebenszyklus-Aktionen; Deaktiviert hat keinen Produktzugang.

- **[Mitglied](/de/platform/member/overview)** — Lesezugriff: Chat nutzen, Wissen durchsuchen, Konversationen und Genehmigungen lesen.
- **[Redakteur](/de/platform/editor/overview)** — Mitglied plus Inhaltspflege und Genehmigungsentscheidungen.
- **[Entwickler](/de/platform/developer/overview)** — Redakteur plus Agents, Automatisierungen, Integrationen und API-Schlüssel.
- **[Admin](/de/platform/admin/overview)** — Entwickler plus Organisationseinstellungen.

## Organisationsverwaltung

Organisationsweite Einstellungen gelten sowohl für Cloud als auch für selbst gehostet, sofern nicht anders vermerkt. Kanonische Referenz:

- [Mitglieder und Rollen](/de/platform/admin/members-and-roles) — die Sechs-Rollen-Rechtematrix.
- [Teams](/de/platform/admin/teams) — Zugriff auf Wissen und Chat eingrenzen.
- [KI-Anbieter](/de/platform/admin/providers) — OpenAI, Anthropic, Google und selbst gehostete Modelle konfigurieren.
- [Branding](/de/platform/admin/branding) — Logos, Farben, Produktname.
- [Governance](/de/platform/admin/governance) — Regeln für Inhalte und Richtlinien.
- [Nutzungsanalyse](/de/platform/admin/usage-analytics) — Aktivität pro Person und organisationsweit.

Für die Einrichtung der Authentifizierung (Passwort, SSO, Trusted-Kopfzeilen) siehe [Authentifizierung in selbst gehosteten Instanzen](/de/self-hosted/admin/authentication) — die Konfiguration ist auf selbst gehostete Instanzen zugeschnitten; in Cloud erledigt das die gehostete Admin-Oberfläche.

## Wo das einsetzt

Platform ist die einzige Wahrheit darüber, was Tale tut, und die Oberfläche bleibt dieselbe, egal wo die Instanz läuft. Alles, was eine Konfigurationsdatei, eine Umgebungsvariable oder einen CLI-Befehl braucht, liegt einen Tab weiter unter [selbst gehostet](/de/self-hosted/overview); alles, was es nur für gemanagte Kundinnen und Kunden gibt — Abrechnung, gehostetes SSO, eigene Domains — liegt unter [Cloud](/de/cloud). Wenn du aus einer Suchergebnisliste hier gelandet bist und nicht sicher bist, mit welcher Rolle du lesen sollst, fang mit [Mitglieder und Rollen](/de/platform/admin/members-and-roles) an — jede andere Admin-Frage liest sich anders, sobald diese Seite beantwortet hat, wer was darf.
