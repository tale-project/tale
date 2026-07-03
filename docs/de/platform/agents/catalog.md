---
title: Agentenkatalog
description: Durchsuche die vorinstallierte KI-Belegschaft nach Abteilung und installiere, aktiviere oder deaktiviere Agenten für deine Organisation.
---

Eine neue Organisation startet mit einer vollständigen Belegschaft von Agenten — eine Geschäftsleitung und die ausführenden Rollen darunter, nach Abteilung geordnet. Im **Katalog** (Agenten → Katalog) durchsuchst du diese Belegschaft und entscheidest, welche Agenten aktiv sind.

Die JSON-Konfiguration jedes Agenten ist die maßgebliche Quelle für Name, Beschreibung und Abteilungs-Labels; der Katalog liest sie und zeigt darüber den Installationszustand.

## Zustände und Aktionen

Jede Karte zeigt ihren Roster-Zustand und die passende Aktion:

- **Nicht installiert** — kein Status-Abzeichen; **Installieren** fügt den Agenten der Organisation hinzu (aktiviert).
- **Aktiviert** — installiert und aktiv: kann erwähnt werden, erhält Routing und Aufgaben. **Deaktivieren** behält die Installation, nimmt den Agenten aber aus dem Betrieb; **Deinstallieren** entfernt ihn.
- **Deaktiviert** — installiert, aber außer Betrieb (rotes Abzeichen). **Aktivieren** holt ihn zurück.

Karten sind nach Abteilung gruppiert (ihrem primären Label — Engineering, Marketing, Vertrieb, Finanzen usw.), und ein Suchfeld filtert nach Name, Beschreibung oder Abteilung.

## Herkunft und integrationsgebundene Agenten

Manche Agenten werden beim Verbinden einer Integration für dich installiert — etwa installiert das Verbinden von GitHub den Pull-Request-Reviewer und den Issue-Triager. Diese tragen das Abzeichen **Installiert von &lt;Integration&gt;**, und der Katalog lässt nicht zu, sie von Hand zu deaktivieren oder zu deinstallieren (trenne stattdessen die Integration). Ein Agent, der noch eine Integration benötigt, zeigt **Erfordert &lt;Integration&gt;**, bis du sie verbindest.

## Aus dem integrierten Katalog aktualisieren

Deine Organisation besitzt ihre eigene Kopie der Konfiguration jedes mitgelieferten Agenten — ein Plattform-Upgrade überschreibt sie nie hinter deinem Rücken. Um die neuesten mitgelieferten Versionen zu holen, öffne das Menü **Agent erstellen** und wähle **Mitgelieferte Agenten aktualisieren**: Jeder integrierte Agent, dessen Konfiguration vom Katalog abweicht, wird ersetzt — auch Agenten, die du bearbeitet hast. Die vorherige Version jedes ersetzten Agenten landet in seinem [Verlauf](/de/platform/agents/versions), sodass du sie wiederherstellen kannst; Agenten, die deine Organisation selbst erstellt hat, bleiben unberührt. Dieselbe Aktion mit derselben Semantik liegt im jeweiligen Menü des Automatisierungs-Katalogs, der Integrationsliste und der Apps-Seite.

## Berechtigungen

Installieren, Aktivieren, Deaktivieren, Deinstallieren und das Aktualisieren aus dem Katalog sind Administrator-Aktionen (Admin, Entwickler oder Inhaber). Modell, Anweisungen oder die vollständige Konfiguration eines Agenten bearbeitest du im Agenten-Editor (Agenten → Alle Agenten → ein Agent), nicht im Katalog.
