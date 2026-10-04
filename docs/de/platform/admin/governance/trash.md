---
title: Papierkorb
description: Finde wiederherstellbare Datensätze, verstehe ihren Status und hole sie vor der endgültigen Löschung zurück.
---

Als Admin oder Inhaber kannst du unter **Einstellungen > Richtlinien > Papierkorb** Datensätze wiederherstellen, die nach einer vorläufigen Löschung noch gespeichert sind. Endgültig gelöschte Daten lassen sich hier nicht zurückholen. Nicht jede Löschung in Tale führt über den Papierkorb.

## Einen Datensatz wiederherstellen

1. Öffne den Papierkorb und grenze die Liste mit **Filter > Kategorie** ein. Ohne Filter siehst du alle unterstützten Typen.
2. Prüfe Name, Eigentümer, Typ und Löschzeitpunkt. Damit unterscheidest du ähnlich benannte Datensätze. Ein Chat erscheint unter seinem Titel; die in einem [Arena](/de/platform/chat/arena-mode)-Vergleich verworfene Antwort behält den Titel ihres Chats.
3. Wähle in der Zeile **Wiederherstellen** und lies die Bestätigung.
4. Gib bei einem durch Aufbewahrung abgelaufenen Datensatz exakt `restore` ein. Bestätige und suche den Datensatz anschließend an seinem ursprünglichen Ort, etwa in der Chatliste oder im Wissensbereich.

Die wiederhergestellte Zeile verschwindet aus dem Papierkorb. Tale protokolliert die Wiederherstellung im Audit-Log. Ist die Zeile nicht mehr verfügbar, aktualisiere die Liste: Die Bereinigung könnte sie bereits endgültig gelöscht haben.

## Den Status verstehen

| Status | Bedeutung |
| --- | --- |
| **Verworfen** | Der Datensatz wurde vorläufig gelöscht und lässt sich noch wiederherstellen. |
| **Abgelaufen** | Die Aufbewahrungsrichtlinie hat den Datensatz ablaufen lassen. Eine Wiederherstellung übergeht diese Richtlinie und verlangt deshalb die Eingabe `restore`. |

**Abgelaufen** bedeutet nicht, dass die Wiederherstellungsfrist schon vorbei ist. Die Aufbewahrung markiert Datensätze zu Beginn der Schonfrist als abgelaufen. Nach deren Ende folgt die endgültige Bereinigung.

Der Kategoriefilter listet die Datensatztypen, die über den Papierkorb laufen: Chats, Dokumente, temporäre Dateien, Nachrichten-Feedback, Kontakte und externe Konversationen. Die früheren Versionen eines Chats reisen mit ihm: Sie werden zusammen mit dem Chat verworfen und wiederhergestellt und erscheinen nie als eigene Zeilen. Andere Daten wie Automatisierungsläufe, Nutzungsdaten, Audit-Einträge und Chat-Filterereignisse werden direkt oder zusammen mit übergeordneten Datensätzen gelöscht und haben hier keine Wiederherstellungsaktion.

## Die Wiederherstellungsfrist prüfen

Die Aufbewahrungsrichtlinie der Organisation legt die Schonfrist fest. Bei einer positiven Frist bleiben unterstützte abgelaufene Datensätze bis zur Bereinigung wiederherstellbar. Null erlaubt die sofortige endgültige Bereinigung. Prüfe die aktive Richtlinie unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits), statt von einer festen Anzahl Tage auszugehen.

Ein leerer Papierkorb bedeutet, dass es in dieser Ansicht keine wiederherstellbaren Datensätze gibt. Er beweist nicht, dass nie etwas gelöscht wurde. Entferne Kategoriefilter, bevor du einen Datensatz als fehlend einstufst.

Ein fehlgeschlagener Abruf erscheint im Papierkorb nie als leer. Lässt sich die Liste nicht laden, erscheint statt der Tabelle eine Meldung mit **Erneut versuchen**, nie der leere Zustand. Sind bereits Datensätze aufgeführt, aber die nächsten oder eine Aktualisierung lassen sich nicht laden, sagt ein Hinweis über der Liste das und bietet **Erneut versuchen** an. Die Zählung unter der Liste behauptet dann nicht mehr, alle Datensätze zu zeigen.

## Aufbewahrungssperren berücksichtigen

Ein [Legal Hold](/de/platform/admin/governance/legal-hold) schützt betroffene Daten vor Löschung durch Aufbewahrung oder Löschanfragen. Er bewahrt noch vorhandene Daten, kann aber endgültig gelöschte Daten nicht zurückholen. Prüfe Sperren und Aufbewahrungshistorie, wenn du klärst, warum ein Datensatz im Papierkorb gelandet ist oder dort fehlt.
