---
title: Agentenkatalog
description: Durchsuchen Sie die vorinstallierte KI-Belegschaft nach Abteilung und installieren, aktivieren oder deaktivieren Sie Agenten für Ihre Organisation.
---

Eine neue Organisation startet mit einer vollständigen Belegschaft von Agenten — eine Geschäftsleitung und die ausführenden Rollen darunter, nach Abteilung geordnet. Im **Katalog** (Agenten → Katalog) durchsuchen Sie diese Belegschaft und entscheiden, welche Agenten aktiv sind.

Die JSON-Konfiguration jedes Agenten ist die maßgebliche Quelle für Name, Beschreibung und Abteilungs-Labels; der Katalog liest sie und zeigt darüber den Installationszustand.

## Zustände und Aktionen

Jede Karte zeigt einen von drei Zuständen und die passende Aktion:

- **Verfügbar** — im Katalog, aber nicht installiert. **Installieren** fügt den Agenten der Organisation hinzu (aktiviert).
- **Aktiviert** — installiert und aktiv: kann erwähnt werden, erhält Routing und Aufgaben. **Deaktivieren** behält die Installation, nimmt den Agenten aber aus dem Betrieb; **Deinstallieren** entfernt ihn.
- **Deaktiviert** — installiert, aber außer Betrieb. **Aktivieren** holt ihn zurück.

Karten sind nach Abteilung gruppiert (ihrem primären Label — Engineering, Marketing, Vertrieb, Finanzen usw.), und ein Suchfeld filtert nach Name, Beschreibung oder Abteilung.

## Herkunft und integrationsgebundene Agenten

Manche Agenten werden beim Verbinden einer Integration für Sie installiert — etwa installiert das Verbinden von GitHub den Pull-Request-Reviewer und den Issue-Triager. Diese tragen das Abzeichen **Installiert von &lt;Integration&gt;**, und der Katalog lässt nicht zu, sie von Hand zu deaktivieren oder zu deinstallieren (trennen Sie stattdessen die Integration). Ein Agent, der noch eine Integration benötigt, zeigt **Erfordert &lt;Integration&gt;**, bis Sie sie verbinden.

## Berechtigungen

Installieren, Aktivieren, Deaktivieren und Deinstallieren sind Administrator-Aktionen (Admin, Entwickler oder Eigentümer). Modell, Anweisungen oder die vollständige Konfiguration eines Agenten bearbeiten Sie im Agenten-Editor (Agenten → Alle Agenten → ein Agent), nicht im Katalog.
