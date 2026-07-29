---
title: Papierkorb
description: Die Soft-Delete-Wiederherstellungsansicht für durch Aufbewahrung verworfene Datensätze — Chat-Threads, Dokumente, Prompts, Workflow-Läufe — bevor sie am Ende des Kulanzfensters endgültig gelöscht werden. Admins und Inhaber lesen das, wenn jemand ein gelöschtes Artefakt zurückbraucht.
---

Papierkorb ist die Wiederherstellungsoberfläche für die Zeilen, die die Aufbewahrung soft-gelöscht, aber noch nicht hart-gelöscht hat. Wenn ein Chat-Thread, ein Dokument, eine Prompt-Vorlage oder ein Workflow-Lauf sein Aufbewahrungsfenster überschreitet, wandert er für das konfigurierte Kulanzfenster hierhin, bevor der nächste Cleanup-Lauf ihn endgültig entfernt. Admins und Inhaber lesen diese Seite, wenn ein Mitglied ein gelöschtes Artefakt zurückbittet, wenn ein Workflow das Falsche gelöscht hat, oder wenn ein Audit wissen muss, ob eine Zeile noch wiederherstellbar ist.

## Eine durchgespielte Wiederherstellung

Um einen Chat-Verlauf-Thread wiederherzustellen, öffne **Einstellungen > Richtlinien > Papierkorb** und stelle den Filter **Kategorie** auf **Chatverlauf**. Jede Zeile trägt den Typ, den Namen, den Eigentümer, den Status und wann sie verworfen wurde. Klick auf **Wiederherstellen** in der Zeile, bestätige im Dialog, und die Zeile kehrt in ihre Quellliste zurück — Chat-Threads erscheinen wieder im Konversations-Posteingang und Dokumente in der Wissensdatenbank. Eine durch Aufbewahrung abgelaufene Zeile wiederherzustellen verlangt das Tippen von `restore` zur Bestätigung und wird als Überschreibung der Aufbewahrungsrichtlinie auditiert.

## Die zwei Status

**Verworfen** ist der normale Soft-Delete-Zustand. Das Aufbewahrungsfenster der Zeile ist abgelaufen, sie ist in den Papierkorb gewandert, und das Kulanzfenster tickt noch. Wiederherstellen führt die Zeile in ihre Quellliste zurück, ohne die Richtlinie zu überschreiben.

**Abgelaufen** ist der zweite Zustand — das Kulanzfenster ist abgelaufen und die Zeile ist für die endgültige Löschung im nächsten Cleanup vorgemerkt. Wiederherstellen ist weiterhin möglich, aber es ist eine Überschreibung: der Dialog verlangt, dass du `restore` tippst, und das Audit-Log dokumentiert die Überschreibung mit deinem Namen.

## Die Kategorien

Der Papierkorb hält Zeilen aus vielen Kategorien. Der Kategoriefilter wechselt die Ansicht pro Tab:

- Chatverlauf (Threads)
- Dokumente
- Temporäre Dateien
- Prompt-Vorlagen
- Nachrichten-Feedback
- Kontakte
- Lieferanten
- Externe Konversationen
- Nachrichten-Metadaten
- Workflow-Läufe
- Workflow-Trigger-Logs
- Nutzungsbuch
- Audit-Logs
- Chat-Filter-Ereignisse
- Memory-Audit

Jede Kategorie respektiert ihr eigenes Aufbewahrungsfenster und ihr eigenes Kulanzfenster — gesetzt in der Aufbewahrungsrichtlinie unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits).

## Interaktion mit Legal Hold

Zeilen unter Legal Hold erscheinen nicht im Papierkorb — der Hold heftet sie außer Reichweite jedes Aufbewahrungs-Schritts. Wenn du versuchst, eine gehaltene Zeile aus ihrer Quellliste zu löschen, lehnt Tale mit der Nachricht **Löschen ist durch einen aktiven Legal Hold gesperrt** ab. Den Hold aufheben lässt die Aufbewahrung die Zeile durch das Papierkorb-Fenster laufen, wie andere Kategorien fließen.

## Das Kulanzfenster

Das Kulanzfenster ist pro Kategorie in der Aufbewahrungsrichtlinie konfigurierbar. Ein Kulanz-Wert von null überspringt den Papierkorb komplett — der Cleanup-Lauf löscht die Zeile hart, sobald die Aufbewahrung auslöst. Ein Wert über null hält die Zeile diese Anzahl Tage im Papierkorb und zeigt sie hier für das Admin-Fenster, in dem Wiederherstellen noch billig ist.

## Wo das hingehört

Papierkorb ist die zweite Chance, die die Aufbewahrung jeder Kategorie gibt, bevor der Cleanup-Lauf eine Zeile endgültig entfernt. Er paart mit [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) — die Aufbewahrungsseite setzt die Fenster; diese Seite ist die Wiederherstellungsansicht, in die diese Fenster speisen. Die Begleitseite ist [Legal Hold](/de/platform/admin/governance/legal-hold) — der einzige Mechanismus, der die Aufbewahrung schlägt, bevor eine Zeile überhaupt im Papierkorb landet.
