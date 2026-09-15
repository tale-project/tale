---
title: Ein verfügbares Modell wählen
description: Verstehe Modellauswahl und Provider-Kataloge und finde heraus, warum ein Modell fehlt oder ein Aufruf abgelehnt wird.
---

Die Modellauswahl zeigt, was deine Organisation derzeit nutzen kann, nicht alle Angebote eines Providers. Nutzbare Zugangsdaten, deren Modell-Freigabeliste und die Zugriffsregeln der Organisation bestimmen das Ergebnis. Administratoren verwalten diese unter **Einstellungen > KI-Anbieter** und [Inhalte & Modelle](/de/platform/admin/governance/content-models).

## Automatisch oder gezielt auswählen

Im Chat wählt **Auto** für jede Nachricht ein Modell anhand ihrer Merkmale, etwa Länge, Code und angehängte Dokumente. Dafür dient eine einfache Heuristik, kein zweiter KI-Aufruf. Die Details einer Antwort zeigen, welches Modell tatsächlich geantwortet hat.

Wähle im Eingabebereich ein bestimmtes Modell, wenn du Ergebnisse vergleichen, die Auswahl kontrollieren oder eine bekannte Aufgabe gezielt bearbeiten möchtest. Diese Auswahl bleibt, bis du sie änderst oder zu Auto zurückkehrst. In der [Arena](/de/platform/chat/arena-mode) vergleichst du zwei verfügbare Modelle mit derselben Nachricht.

Projektagenten und Modellschritte in Workflows verwenden ihr konfiguriertes Modell. Die Auswahl eines Agenten unterscheidet Einträge verschiedener Provider auch bei gleicher Modell-ID. Mit einem Eintrag legst du die Kombination aus Provider und Modell fest. Ein Modellfehler wird angezeigt; die Antwort kommt nicht stillschweigend von einem anderen Modell.

## Die Herkunft der Liste verstehen

Öffne **Einstellungen > KI-Anbieter**, um den Provider und seine angebotenen Modelle zu prüfen. Die Anzahl beschreibt die vorhandenen Modelldefinitionen. Sie belegt weder Zugangsdaten noch die Berechtigung deiner Organisation, jedes dieser Modelle aufzurufen.

| Quelle | Wie Modelle in den Katalog gelangen | Wann sie sich ändert |
| --- | --- | --- |
| Mitgelieferter Katalog | Die Modelldefinitionen werden mit Tale ausgeliefert. | Bei einem Plattform- oder Katalogupdate. |
| OpenRouter-Katalog | Tale ruft die Liste von OpenRouter ab. | Nach einem Abruf oder einer erzwungenen Aktualisierung. |
| Modell-Endpunkt des Providers | Tale ruft die Modellliste des Providers ab. | Nach einem Abruf oder einer erzwungenen Aktualisierung. |
| Kein Katalog | Modell-IDs stammen aus der Freigabeliste der Zugangsdaten. | Wenn ein Administrator diese Liste ändert. |

Azure OpenAI und Nous Portal verwenden Modell-IDs aus den Zugangsdaten. Trage bei Azure die Deployment-Namen deiner Ressource ein; sie können von öffentlichen Modellnamen abweichen. Bei einem Provider ohne Katalog macht eine leere Freigabeliste kein Modell verfügbar.

## Einen abgerufenen Katalog aktualisieren

Inhaber, Admins und Entwickler wählen **Kataloge aktualisieren** im Kopfbereich der Einstellungen. Lies das Ergebnis je Provider: Es enthält die Modellanzahl oder den Fehler, der den Abruf verhindert hat. Ein fehlgeschlagener Abruf bedeutet nicht, dass der Provider keine Modelle anbietet.

Externe Kataloge werden 24 Stunden zwischengespeichert und bei einer späteren Anfrage aktualisiert, wenn der Cache veraltet ist. Der Button erzwingt einen neuen Versuch. Schlägt ein automatischer Abruf fehl, kann Tale den bisherigen Katalog oder mitgelieferte Modelle weiterverwenden; ein erzwungener Abruf meldet den Fehler. Ein neues Modell muss außerdem die Prüfungen für Zugangsdaten und Richtlinien bestehen. Installationen mit ausschließlich mitgelieferten Katalogen haben keine externen Listen abzurufen.

## Ein fehlendes Modell finden

Prüfe die Grenzen in dieser Reihenfolge. Wenn du die Einstellungen nicht ändern darfst, gib die Informationen an einen Administrator weiter:

1. Prüfe, ob der Provider aktivierte, nutzbare Zugangsdaten hat. Ein Katalogeintrag allein verbindet noch kein Konto.
2. Lies die **Erlaubte Modelle** dieser Zugangsdaten. Bei einem Provider mit Katalog begrenzt sie die Auswahl, ohne Katalog legt sie sie fest.
3. Prüfe die Modellzugriffsregeln für Organisation, Team oder Person unter [Inhalte & Modelle](/de/platform/admin/governance/content-models).
4. Prüfe bei einem Projektagenten, ob die Zugangsdaten seinen gewählten [Harness](/de/platform/agents/harnesses) unterstützen. Ein Abonnement kann an eine bestimmte Laufzeit gebunden sein.

Ist das Modell sichtbar, aber der Aufruf schlägt fehl, lies die Begründung. Abgelaufene Zugangsdaten, Provider-Ausfälle, Budgetgrenzen und fehlende Sandbox-Kapazität sind unterschiedliche Probleme. Ein Katalogabruf behebt sie nicht alle. [KI-Provider](/de/platform/admin/providers) erklärt Zugangsdaten; [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) behandelt Ausgabengrenzen.
