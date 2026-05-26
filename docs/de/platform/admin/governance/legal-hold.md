---
title: Legal Hold
description: Das vier-Augen-kontrollierte Einfrieren, das Aufbewahrungs-Sweeps und Löschungs-Kaskaden für einen bestimmten Benutzer, ein Dokument, einen Thread oder die gesamte Organisation während eines Rechtsstreits pausiert. Admins und Inhaber lesen das, wenn der Rechtsbeistand bittet, Beweise zu sichern.
---

Legal Hold ist der Mechanismus, den Tale für die Beweissicherung unter Rechtshalt ausliefert. Ein Hold heftet ein Ziel — einen Benutzer, ein Dokument, einen Thread, eine Workflow-Ausführung oder die gesamte Organisation — außer Reichweite des Aufbewahrungs-Sweeps und der Löschungs-Kaskade für betroffene Personen. Admins und Inhaber lesen diese Seite, wenn der Rechtsbeistand bittet, die Daten einer Custodian-Person zu sichern, wenn eine Freigabe-Anfrage die Vier-Augen-Freigabe braucht, oder wenn ein Audit abgleicht, welche Holds zu einem gegebenen Datum in Kraft waren.

## Eine durchgespielte Platzierung

Um einen Hold auf einen Benutzer zu platzieren, öffne **Einstellungen > Governance > Legal Hold** und klick auf **Legal Hold platzieren**. Wähle den Zieltyp — Benutzer, Thread, Dokument, Ausführung oder Organisation — wähle das konkrete Ziel, füge einen Grund hinzu und verknüpfe den Hold mit einer Sache, falls eine offen ist. Der Hold wirkt sofort; Aufbewahrungs-Sweeps überspringen die Zeilen des Ziels, die Löschungs-Kaskade meldet sie als **Durch Hold übersprungen**, und die Zielzeile trägt das Badge **Auf Legal Hold** in jeder Liste, in der sie erscheint.

## Die vier Bereiche

**Aktive Holds** ist die Arbeitsliste jedes Holds, der gerade in Kraft ist. Jede Zeile trägt den Typ, das Ziel, den Grund, die Sache, wer ihn platziert hat und wann. Filtere nach Typ oder nach Sache, um die Ansicht einzugrenzen.

**Freigabe-Anfragen** ist die Vier-Augen-Warteschlange. Einen Hold freigeben verlangt, dass ein anderer Admin die Anfrage genehmigt; genehmigte Anfragen warten zusätzlich eine Abkühlphase ab, bevor sie wirken. Der Bereich teilt sich in _wartet auf Freigabe_ und _genehmigt, wartet auf Abkühlphase_, sodass die Warteschlange und der Timer beide sichtbar sind.

**Sachen** gruppiert Holds nach Fall. Jede Sache trägt einen Namen, eine Fallnummer und die Liste der verknüpften Holds. Eine Sache zu schließen reicht Freigabe-Anfragen für jeden verknüpften Hold ein — weiterhin unter Vier-Augen-Genehmigung pro Anfrage.

**Freigabe-Historie** ist das nur-lesbare Audit der effektiven und abgelehnten Freigaben. Nutz es, um gegen ein Beweissicherungsschreiben der Gegenseite abzugleichen oder einen Audit-Bericht zu speisen.

## Hold-und-Kaskade-Interaktion

Ein Hold blockiert jeden Aufbewahrungs-Lauf und jeden Löschungs-Schritt für das Ziel. Die Papierkorb-Seite zeigt den Banner **Löschen ist durch einen aktiven Legal Hold gesperrt**, wenn ein Admin versucht, eine Zeile unter Hold zu entfernen. Eine Anfrage einer betroffenen Person, deren Subjekt von einem Hold abgedeckt ist, landet im Status **Blockiert**, bis der Hold freigegeben ist; teilweise Abdeckung (manche Threads unter Hold, manche nicht) landet in **Teilweise** mit Per-Kategorie-Zählern im Beleg.

## Vier-Augen-Kontrolle

Platzieren und Freigeben sind nicht symmetrisch. Platzieren ist eine Aktion durch einen Admin allein — die Geschwindigkeit zählt, wenn Rechtsstreit kommt. Freigeben ist vier-Augen-kontrolliert: der anfordernde Admin reicht ein, ein anderer Admin gibt frei, und zwischen Genehmigung und Wirkung gilt eine Abkühlphase, sodass eine voreilige Freigabe noch abgebrochen werden kann. Beide Hälften des Workflows werden Ende zu Ende auditiert.

## Wo das hingehört

Legal Hold ist der Einfrier-Knopf auf der Aufbewahrung. Er ist der einzige Mechanismus, der den zeitgesteuerten Aufbewahrungs-Sweep und die Löschungs-Kaskade für betroffene Personen schlägt — beide respektieren Holds per Konstruktion. Die Begleitseiten sind [Anfragen betroffener Personen](/de/platform/admin/governance/data-subject-requests) für die Kaskaden-Seite und [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) für die Aufbewahrungsfenster, die der Hold übersteuert.
