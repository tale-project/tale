---
title: Anfragen betroffener Personen
description: Der Workflow nach DSGVO Artikel 17 zur Löschung der Daten einer Person über Chats, Dokumente, Uploads und Einstellungen hinweg. Admins und Inhaber lesen das, wenn ein Benutzer eine Anfrage stellt oder wenn eine SLA-Frist näher rückt.
---

Anfragen betroffener Personen ist der Workflow, den Tale für die Einhaltung von DSGVO Artikel 17 (Recht auf Löschung) und das entsprechende CCPA-Recht nach kalifornischem Recht ausliefert. Jede Anfrage wird zu einem Beleg: er nennt die betroffene Person, den Begründungs-Code, die SLA-Frist und die Kaskade von Zeilen, die das System über Threads, Dokumente, Uploads und die übrigen Zeilen hinweg gelöscht hat, die die Person identifizieren. Admins und Inhaber lesen diese Seite, wenn eine Person eine Anfrage stellt, wenn eine Frist näher rückt, oder wenn ein Audit den Beleg einer vergangenen Löschung verlangt.

<Frame caption="Governance > Anfragen betroffener Personen — die DSAR-Governance-Richtlinie (Cooling-off-Fenster, Vier-Augen-Freigabe, Tageslimit) über der Liste der Anfrage-Belege mit Anfrage einreichen.">

![Die Governance-Seite Anfragen betroffener Personen zeigt das Cooling-off-Fenster, den Schalter für die Vier-Augen-Freigabe und die Tageslimit-Felder über einer Tabelle der Löschungs-Anfragen mit einer offenen Anfrage — betroffene Person Jordan Blake, Begründungs-Code Einwilligung widerrufen, noch 24 Stunden bis zur Ausführung und 29 Tage SLA-Frist —, daneben die Schaltfläche Anfrage einreichen.](/images/platform/governance-data-subject-requests.webp)

</Frame>

## Eine durchgespielte Einreichung

Um eine Anfrage einzureichen, öffne **Einstellungen > Richtlinien > Anfragen betroffener Personen** und klick auf **Anfrage einreichen**. Wähle die betroffene Person, wähle einen Begründungs-Code (Einwilligung widerrufen, nicht mehr erforderlich, unrechtmäßige Verarbeitung, rechtliche Verpflichtung, Widerspruch, minderjährige Person oder Vertragsende) und füge eine Freitext-Begründung hinzu. Die Anfrage tritt in ein Cooling-off-Fenster ein, bevor die Kaskade läuft — jeder Admin kann während des Fensters abbrechen. Nach Ablauf des Fensters löscht die Kaskade die Threads und Dokumente der Person (der Wissensdatenbank-Eintrag eines Dokuments geht mit), ihre Uploads, Einstellungen, Benachrichtigungen, Feedback-, Memory- und Nutzungszeilen und schwärzt ihre Kennungen im Audit-Pfad — der Beleg dokumentiert einen Zähler pro Durchlauf.

## Status-Lebenszyklus

| Name                | Default        | Beschreibung                                                                                       |
| ------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Ausstehend          | Anfangszustand | Die Anfrage ist eingereicht und wartet auf das Cooling-off-Fenster oder die zweite Admin-Freigabe. |
| Wartet auf Freigabe | Vier-Augen     | Ein zweiter Admin muss freigeben, bevor die Kaskade läuft.                                         |
| Läuft               | mid-cascade    | Die Kaskade läuft; Teilzähler aktualisieren sich, sobald jede Kategorie fertig ist.                |
| Abgeschlossen       | terminal       | Jede Kategorie ist ohne Fehler gelöscht.                                                           |
| Teilweise           | terminal       | Ein oder mehrere Kaskade-Durchläufe schlugen fehl — der Fehler im Beleg benennt sie.               |
| Fehlgeschlagen      | terminal       | Die Kaskade starb mitten im Lauf — fataler Fehler oder Watchdog-Timeout; Wiederholen reicht sie neu ein. |
| Blockiert           | terminal       | Ein aktiver Legal Hold blockiert jeden Kaskade-Schritt.                                            |
| Abgebrochen         | terminal       | Ein Admin hat vor Ablauf des Cooling-off-Fensters abgebrochen.                                     |

## SLA-Verfolgung

Jede Anfrage trägt eine Service-Level-Frist — standardmäßig 30 Tage ab Einreichung. Die Anfragenliste zeigt verbleibende Tage oder ein Überfällig-Badge pro Zeile. Artikel 12(3) DSGVO erlaubt eine einmalige Verlängerung für komplexe Fälle; die Aktion **Frist verlängern** vermerkt die Verlängerung auf dem Beleg mit dem Namen des anfordernden Admins und einer Begründung.

## Interaktion mit Legal Hold

Daten einer betroffenen Person werden _nicht_ gelöscht, solange sie auf Legal Hold liegen. Zeilen unter Hold erscheinen im Beleg in den Per-Kategorie-Zählern als **Durch Legal Hold übersprungen**; den Hold aufheben und die Anfrage erneut versuchen schließt die Löschung ab. Der Status Blockiert greift, wenn ein Hold von Anfang an jede Kategorie abdeckt — die Kaskade läuft nicht, und der Beleg spiegelt die Blockade.

## Die Kaskade-Kategorien

Der Beleg schlüsselt die gelöschten Zeilen nach Durchlauf auf — Threads, Dokumente, Uploads, Einstellungen, Benachrichtigungen, Abonnements, Feedback, Memories, Nutzungs-Ledger und die Schwärzung im Audit-Pfad. Lies das Drawer für Zähler und die Audit-Zeitleiste; das Audit-Log im selben Governance-Bereich trägt die volle Ereigniskette (`gdpr_erasure_requested`, `gdpr_erasure_executed`, `gdpr_erasure_extended`, `gdpr_erasure_cancelled`).

## Wo das hingehört

Anfragen betroffener Personen ist das Compliance-Gesicht der Aufbewahrung — der auditierte, vier-Augen-kontrollierte Pfad, der eine bestimmte Person auf Anfrage löscht, statt der zeitgesteuerten Sweeps, die die Aufbewahrung über alle hinweg läuft. Die Begleitseite ist [Legal Hold](/de/platform/admin/governance/legal-hold) — sie deckt ab, wie Aufbewahrung und Löschungs-Kaskaden für Rechtsstreitigkeiten pausiert werden, bevor sie laufen.
