---
title: Genehmigungs-Konzepte
description: Eine Genehmigung ist eine Karte, die ein Mensch klicken muss, bevor eine automatisierte Aktion fortfährt. Diese Seite benennt die vier Auslöser, das Genehmiger-Routing und was eine Genehmigung im Audit-Log hinterlässt.
---

Eine Genehmigung ist die Naht zwischen einer automatisierten Aktion und einer menschlichen Entscheidung. Sie ist eine Karte, die eine Person klicken muss — Genehmigen, Ablehnen oder Änderungen anfordern —, bevor die Aktion fortfährt. Redakteure und Entwickler konfigurieren, wo Genehmigungen verlangt werden; der Genehmiger-Pool entscheidet.

Diese Seite vermittelt dir das mentale Modell, was eine Genehmigung ist, was sie auslöst und was jede Entscheidung hinterlässt. Lies sie, bevor du ein Gate in einem Workflow konfigurierst oder einen Agent verdrahtest, der in die Wissensdatenbank zurückschreibt.

## Was eine Genehmigung ist

Eine Genehmigung lebt als Zeile in der Genehmigungs-Tabelle und als Karte in der Chat-Oberfläche. Die Karte trägt den Kontext der Aktion (wer ausgelöst hat, was sich ändern soll, warum eine Genehmigung verlangt war) und die drei Entscheidungs-Knöpfe. Genehmiger können ihre Entscheidung mit einem Kommentar versehen; der Kommentar landet neben der Aktion im Audit-Log.

Offene Genehmigungen tauchen an zwei Orten auf: inline im Chat, wo die Aktion versucht wurde, und im Posteingang des Genehmigers (im Bereich Konversationen). Genehmiger können von jeder Oberfläche aus handeln; die Entscheidung propagiert gleich.

## Die vier Auslöser

**Workflow-Gates.** Ein Schritt in einem Workflow ist als Genehmigungs-Gate konfiguriert. Der Lauf pausiert, bis das Gate sich auflöst. Siehe [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows).

**Dokument-Schreibvorgänge.** Ein Agent versucht, in die Wissensdatenbank zu schreiben — ein Dokument, einen Kunden, ein Produkt, einen Lieferanten erstellen oder bearbeiten — und die Governance-Richtlinie auf dieser Ressource verlangt Freigabe. Der Schreibvorgang wird nicht festgeschrieben, bis er genehmigt ist.

**Integrations-Aufrufe.** Ein Agent versucht, ein externes System über eine Integration aufzurufen, die Genehmigung für ausgehende Schreibvorgänge verlangt. Der Aufruf wird gehalten, bis ein Genehmiger auf Genehmigen klickt.

**Agent-Erstellung und Skill-Installation.** Wenn die Governance-Richtlinie eine Admin-Prüfung verlangt, erzeugt das Erstellen eines neuen Agents oder das Installieren einer Fähigkeit eine Genehmigungs-Karte an den konfigurierten Pool.

## Genehmiger-Routing

Jede Genehmigung wird mit einem Genehmiger-Pool erstellt — ein Team, eine Rolle oder eine explizite Liste von Personen. Der erste berechtigte Genehmiger, der klickt, entscheidet; der Rest des Pools sieht die Karte in einen aufgelösten Zustand übergehen. Handelt niemand innerhalb des Gate-Timeouts, eskaliert die Genehmigung gemäss der Eskalationsrichtlinie des Gates (typisch: an einen Fallback-Pool umleiten oder den Lauf fehlschlagen lassen).

Genehmiger können ihre eigene Anfrage nicht genehmigen: die Person, die die Aktion ausgelöst hat, wird aus dem berechtigten Pool ausgeschlossen, auch wenn sie sonst drin wäre.

## Zustände und Timeouts

Eine Genehmigung hat vier Lebenszyklus-Zustände:

- **pending** — erstellt, noch nicht entschieden.
- **approved** — ein Genehmiger hat auf Genehmigen geklickt; die Aktion fährt fort.
- **rejected** — ein Genehmiger hat auf Ablehnen geklickt; die Aktion wird aufgegeben, der Lauf hält die Ablehnung fest.
- **timed-out** — keine Entscheidung im konfigurierten Fenster; je nach Richtlinie eskaliert oder fehlgeschlagen.

Jeder Zustandsübergang landet im Audit-Log mit Akteur, Zeitstempel und Kommentar. Die Übergänge sind append-only: eine aufgelöste Genehmigung kann nicht wieder geöffnet werden.

## Zusammengesetzt

Ein Finance-Operations-Team konfiguriert drei Governance-Richtlinien: Workflow-Schritte, die Mail an externe Adressen senden, verlangen Genehmigung; Agent-Schreibvorgänge in die Kundendatenbank verlangen Genehmigung; neue MCP-Server-Installationen verlangen Genehmigung. Drei Auslöser, ein Genehmiger-Pool (das Finance-Team), eine Audit-Spur. Das Team sieht jede offene Genehmigung in seinem Posteingang und jede aufgelöste Entscheidung im Audit-Log.

## Wo das hingehört

Genehmigungen sind die Oberfläche, an der Automatisierung und Verantwortlichkeit zusammentreffen — sie lassen dich die Arbeit an Agents und Workflows delegieren, ohne die Aufzeichnung aufzugeben, wer was genehmigt hat. Die natürliche nächste Lektüre ist [Genehmigungen konfigurieren](/de/platform/approvals/configure) für die Felder pro Ressource und [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows) für die Gate-Spezifika.
