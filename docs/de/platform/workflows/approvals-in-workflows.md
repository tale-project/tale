---
title: Genehmigungen in Workflows
description: Ein Workflow-Schritt kann ein Genehmigungs-Gate sein, das den Lauf anhält, bis ein Mensch entscheidet. Diese Seite behandelt die Zustände des Gates, die Routing-Regeln, was der Rest des Workflows sieht und wie das Gate mit organisationsweiten Genehmigungs-Regeln komponiert.
---

Ein Genehmigungs-Gate ist ein Workflow-Schritt, dessen einzige Aufgabe es ist, den Lauf anzuhalten, bis ein Mensch entscheidet. Der Schritt vor dem Gate läuft fertig, das Gate veröffentlicht eine Genehmigungs-Karte im konfigurierten Pool, und der Schritt nach dem Gate läuft nur, wenn ein Genehmiger auf Genehmigen klickt. Redakteure und Entwickler konfigurieren Gates innerhalb des Workflows; der Genehmiger-Pool entscheidet sie aus dem Inbox oder inline im Chat. Diese Seite behandelt das Gate als Workflow-Primitiv — seine Zustände, sein Routing, welche Daten es trägt und wie es mit organisationsweiten Genehmigungs-Regeln komponiert.

Die organisationsweite Geschichte dessen, was eine Genehmigung ist, was sie hinterlässt und wie sich die vier Auslöser-Quellen unterscheiden, liegt auf [Genehmigungs-Konzepte](/de/platform/approvals/concepts). Die Per-Regel-Konfigurationsfelder, die sowohl Gates als auch organisationsweite Regeln nutzen, liegen auf [Genehmigungen konfigurieren](/de/platform/approvals/configure). Was folgt, ist die workflow-spezifische Oberfläche.

## Ein Gate zu einem Workflow hinzufügen

Öffne den Workflow-Editor und lass einen **Genehmigung**-Schritt dort einfallen, wo das Gate sitzen soll. Das Panel des Schritts fragt nach vier Dingen: dem **Genehmiger-Pool** (Team, Rolle oder explizite Liste), dem **Timeout** und der **Timeout-Aktion** (Ablehnen, Eskalieren, Genehmigen), dem **Kartentitel und -körper** (was der Genehmiger sieht) und der optionalen **Kommentar-Richtlinie** (darf, muss, darf nicht). Speichere den Workflow; der nächste Lauf behandelt den Schritt als Halt.

Titel und Körper der Karte werden mit den Variablen des Workflows im Scope gerendert, sodass du einen Kartenkörper bauen kannst wie `Mail an {{recipient}} mit Betreff "{{subject}}" senden?` — der Genehmiger sieht die aufgelösten Werte, nicht das Template. Dasselbe Templating funktioniert auf jedem Textfeld des Schritts.

## Was das Gate trägt

Wenn das Gate feuert, baut Tale eine Genehmigungs-Karte, die Folgendes trägt:

- Name des Workflows und Bezeichner des Laufs.
- Titel und Körper des Schritts (mit aufgelösten Variablen).
- Einen Link zurück auf die Ausführungs-Sicht des Laufs.
- Die Ausgabe jedes vorherigen Schritts, den der Workflow-Autor als für Genehmiger sichtbar markiert hat.

Der Sichtbar-für-Genehmiger-Hebel der vorherigen Schritte liegt am Ausgabe-Panel jedes vorherigen Schritts: kreuze die Box an, um die Ausgabe für nachgelagerte Genehmigungs-Karten freizugeben. Nicht angekreuzte Ausgaben sind für den Genehmiger unsichtbar — nützlich, wenn ein Zwischenschritt etwas erzeugt, das der Genehmiger nicht sehen muss.

## Zustände und was bei jedem passiert

Das Gate hat dieselben vier Zustände, die jede Genehmigung hat — ausstehend, genehmigt, abgelehnt, abgelaufen — und der Lauf reagiert auf jeden anders.

- **ausstehend** — der Lauf ist pausiert. Die Ausführungs-Sicht zeigt den Schritt als wartend; nachgelagerte Schritte feuern nicht.
- **genehmigt** — der nächste Schritt im Workflow läuft. Wenn mehrere Gates hintereinander gestapelt waren, muss jedes unabhängig genehmigen.
- **abgelehnt** — der Lauf endet mit einem Ablehnungs-Eintrag. Die Ausführungs-Sicht erfasst den Ablehnenden, den Zeitstempel und den optionalen Kommentar. Nachgelagerte Schritte feuern nie.
- **abgelaufen** — die Timeout-Aktion des Gates entscheidet, was passiert. Ablehnen beendet den Lauf; Eskalieren routet die Karte an den Eskalations-Pool und das Gate geht wieder auf ausstehend; Genehmigen lässt den nächsten Schritt automatisch laufen.

Zustands-Übergänge sind append-only — ein aufgelöstes Gate kann nicht wieder geöffnet werden. Um nach einer Ablehnung neu zu starten, starte eine neue Ausführung des Workflows.

## Komponieren mit organisationsweiten Regeln

Ein Workflow-Gate ist eine der vier [Genehmigungs-Auslöser-Quellen](/de/platform/approvals/concepts). Die anderen drei (Wissensdatenbank-Schreibvorgänge, Integrationsaufrufe, Agent- und Skill-Installationen) können im selben Lauf ebenfalls feuern, wenn die Schritte des Workflows diese Ressourcen berühren. Wenn mehr als eine Regel auf dieselbe Aktion zutrifft, wertet die Engine alle parallel aus, und die Aktion wird gehalten, bis jede genehmigt — siehe [Genehmigungen konfigurieren](/de/platform/approvals/configure) für die Kompositions-Regeln.

Die praktische Folge: wenn dein `Mail senden`-Schritt im Workflow bereits durch eine organisationsweite Regel auf ausgehende Mail gegatet ist, brauchst du davor keinen zusätzlichen In-Workflow-Genehmigungs-Schritt. Die organisationsweite Regel wird die Aktion halten, egal wie der Workflow versucht hat, sie aufzurufen.

## Ein durchgespieltes Gate

Ein Tagesbericht-Workflow hat drei Schritte: einen Agent, der eine Zusammenfassung entwirft, ein Genehmigungs-Gate an die Team-Leitung geroutet und einen Mail-Schritt, der den genehmigten Entwurf sendet. Der Titel des Gates ist `Tagesbericht genehmigen`, sein Körper ist `Den heutigen Bericht an das Team senden? Entwurf unten:`, der sichtbare vorherige Schritt ist der Entwurf des Agents, der Timeout ist 4 Stunden, und die Timeout-Aktion ist `Ablehnen`. Wenn die Team-Leitung auf Genehmigen klickt, feuert der Mail-Schritt mit dem Entwurf als Körper; wenn sie ablehnt, endet der Lauf und der Bericht des Tages wird nicht gesendet; wenn 4 Stunden ohne Klick vergehen, vermerkt der Lauf einen Timeout-Reject, und der Lauf am nächsten Morgen startet neu.

## Wo das hingehört

Genehmigungs-Gates sind die Art, wie ein Workflow einen Menschen zwischen zwei automatisierten Schritten setzt. Die natürliche nächste Lektüre ist [Workflow-Konzepte](/de/platform/workflows/concepts) für das umgebende Modell — Definitionen, Trigger, Schritte, Ausführungen — und [Genehmigungs-Konzepte](/de/platform/approvals/concepts) für die quellenübergreifende Geschichte dessen, was jede Genehmigung trägt.
