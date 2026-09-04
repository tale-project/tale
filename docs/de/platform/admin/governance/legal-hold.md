---
title: Legal Hold
description: Das vier-Augen-kontrollierte Einfrieren, das Aufbewahrungs-Sweeps und Löschungs-Kaskaden für einen bestimmten Benutzer oder die gesamte Organisation während eines Rechtsstreits pausiert. Admins und Inhaber lesen das, wenn der Rechtsbeistand bittet, Beweise zu sichern.
---

Legal Hold ist der Mechanismus, den Tale für die Beweissicherung unter Rechtshalt ausliefert. Ein Hold heftet ein Ziel — einen Benutzer als Custodian oder die gesamte Organisation — außer Reichweite des Aufbewahrungs-Sweeps und der Löschungs-Kaskade für betroffene Personen. Admins und Inhaber lesen diese Seite, wenn der Rechtsbeistand bittet, die Daten einer Custodian-Person zu sichern, wenn ein Freigabeantrag die Vier-Augen-Freigabe braucht, oder wenn ein Audit abgleicht, welche Holds zu einem gegebenen Datum in Kraft waren.

<Frame caption="Governance > Legal Hold — die Tabelle der aktiven Holds mit der Aktion Legal Hold setzen über der vier-Augen-kontrollierten Warteschlange der Freigabeanträge.">

![Die Governance-Seite Legal Hold zeigt einen aktiven Hold — Typ Benutzer auf marta.vogel, gesetzt von Alex Rivera zum Sachverhalt Northstar contract — neben der Schaltfläche Legal Hold setzen, darunter die Warteschlangen Ausstehende Genehmigung und Genehmigt, die beide Keine Freigabeanträge melden.](/images/platform/governance-legal-hold.webp)

</Frame>

## Eine durchgespielte Platzierung

Um einen Hold auf einen Benutzer zu setzen, öffne **Einstellungen > Richtlinien > Legal Hold** und klick auf **Legal Hold setzen**. Wähle den Zieltyp — Benutzer als Custodian oder die gesamte Organisation — wähle die Person, wo eine nötig ist, füge einen Grund hinzu und verknüpfe den Hold mit einem Fall, falls einer offen ist. Der Hold wirkt sofort: Aufbewahrungs-Sweeps überspringen die Zeilen des Ziels, ein Löschantrag gegen das Ziel wird verweigert, und das Löschen gehaltener Inhalte wird an der Quelle abgewiesen.

## Die vier Bereiche

**Aktive Holds** ist die Arbeitsliste jedes Holds, der gerade in Kraft ist. Jede Zeile trägt den Typ, das Ziel, den Grund, den Fall, wer ihn gesetzt hat und wann. Filtere nach Typ oder nach Fall, um die Ansicht einzugrenzen.

**Freigabeanträge** ist die Vier-Augen-Warteschlange. Einen Hold freigeben verlangt, dass ein anderer Admin die Anfrage genehmigt; genehmigte Anfragen warten zusätzlich eine Abkühlphase ab, bevor sie wirken. Der Bereich teilt sich in _wartet auf Freigabe_ und _genehmigt, wartet auf Abkühlphase_, sodass die Warteschlange und der Timer beide sichtbar sind.

**Fälle** gruppiert Holds nach Fall. Jeder Fall trägt einen Namen, eine Fallnummer und die Liste der verknüpften Holds. Einen Fall zu schließen reicht Freigabeanträge für jeden verknüpften Hold ein — weiterhin unter Vier-Augen-Genehmigung pro Antrag.

**Freigabeverlauf** ist das nur-lesbare Audit der effektiven und abgelehnten Freigaben. Nutz es, um gegen ein Beweissicherungsschreiben der Gegenseite abzugleichen oder einen Audit-Bericht zu speisen.

## Hold-und-Kaskade-Interaktion

Ein Hold blockiert jeden Aufbewahrungs-Lauf und jeden Löschungs-Schritt für das Ziel, und Löschen wird an der Quelle abgewiesen — die Threads oder Dokumente einer gehaltenen Person in den Papierkorb zu legen scheitert mit einem Legal-Hold-Fehler, und ein Ordner-Löschen verweigert, solange er eine gehaltene Datei enthält. Auch das Löschen der ganzen Organisation ist gesperrt: Solange irgendein Hold aktiv ist — organisationsweit oder für ein Mitglied —, lehnt Tale **Organisation löschen** ab, und die Organisation bleibt unverändert. Eine Anfrage einer betroffenen Person, deren Subjekt von einem Hold abgedeckt ist, landet im Status **Blockiert**, bis der Hold freigegeben ist; der Beleg dokumentiert die Blockade.

## Vier-Augen-Kontrolle

Platzieren und Freigeben sind nicht symmetrisch. Platzieren ist eine Aktion durch einen Admin allein — die Geschwindigkeit zählt, wenn Rechtsstreit kommt. Freigeben ist vier-Augen-kontrolliert: der anfordernde Admin reicht ein, ein anderer Admin gibt frei, und zwischen Genehmigung und Wirkung gilt eine Abkühlphase, sodass eine voreilige Freigabe noch abgebrochen werden kann. Beide Hälften des Workflows werden Ende zu Ende auditiert.

## Wo das hingehört

Legal Hold ist der Einfrier-Knopf auf der Aufbewahrung. Er ist der einzige Mechanismus, der den zeitgesteuerten Aufbewahrungs-Sweep und die Löschungs-Kaskade für betroffene Personen schlägt — beide respektieren Holds per Konstruktion. Die Begleitseiten sind [Anfragen betroffener Personen](/de/platform/admin/governance/data-subject-requests) für die Kaskaden-Seite und [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) für die Aufbewahrungsfenster, die der Hold übersteuert.
