---
title: Automatisierungs-Metriken
description: Das Dashboard, das die Lauf-Historie in Erfolgsrate, durchschnittliche Dauer, Gesamtläufe und gescheiterte Läufe über jeden Workflow der Org rollt — über die letzten 7, 30 oder 90 Tage. Redakteure und Entwickler lesen das, wenn ein Workflow abbaut oder um zu sehen, welche Workflows die Last tragen.
---

Das Metriken-Dashboard ist die organisationsweite Lesart, wie Automatisierungen abschneiden. Jede Ausführung rollt in vier Kopfzähler (Gesamtläufe, Erfolgsrate, durchschnittliche Dauer, gescheiterte Läufe), zwei Diagramme (Läufe über Zeit, Status-Aufschlüsselung) und eine Top-Workflows-Tabelle, die die beschäftigtsten Definitionen rangiert. Redakteure und Entwickler lesen es, wenn ein Workflow häufiger als gewöhnlich scheitert, wenn Latenz hochkriecht oder wenn jemand fragt, welche Workflows die Arbeit machen.

Die Seite lebt unter **Automatisierungen > Metriken** in der Sidebar. Wähl eine Periode — 7, 30 oder 90 Tage — und jedes Panel rechnet gegen die Läufe nach, die innerhalb dieses Fensters gestartet sind.

## Die vier Kopf-Karten

Die Karten über den Diagrammen fassen die Periode auf einen Blick zusammen. Jede Karte zeigt eine einzige Zahl für die gewählte Periode.

| Karte              | Typ         | Pflicht | Beschreibung                                                                            |
| ------------------ | ----------- | ------- | --------------------------------------------------------------------------------------- |
| Gesamtläufe        | Zahl        | ja      | Anzahl der Ausführungen, die im Fenster gestartet sind, über jeden Workflow der Org.    |
| Erfolgsrate        | Prozentwert | ja      | Anteil der abgeschlossenen Läufe an Gesamtläufen. Schliesst Läufe aus, die noch laufen. |
| Ø Dauer            | Dauer       | ja      | Mittlere Wanduhr-Dauer abgeschlossener Läufe im Fenster.                                |
| Gescheiterte Läufe | Zahl        | ja      | Anzahl der Ausführungen, die im Status `failed` endeten.                                |

Die Karten rollen über jeden Workflow zusammen. Nutz die Top-Workflows-Tabelle darunter, um die Summen spezifischen Definitionen zuzuordnen.

## Die Trend- und Status-Diagramme

Zwei Diagramme stehen unter den Karten. Das Trend-Diagramm zeichnet Läufe pro Tag über die gewählte Periode auf — ein schneller Blick, ob die Org über Zeit mehr oder weniger Automatisierungsarbeit fährt. Das Status-Diagramm bricht dieselbe Summe in abgeschlossen, gescheitert und laufend auf, damit du den Fehler-Anteil auf einen Blick siehst.

Beide Diagramme teilen sich die Perioden-Kontrolle oben auf der Seite. Fahr über jeden Balken oder jedes Tortenstück und der Tooltip trägt die genaue Anzahl.

## Die Top-Workflows-Tabelle

Die Tabelle unten auf der Seite rangiert die Workflows nach Lauf-Anzahl über das Fenster. Spalten: Workflow-Name, Gesamtläufe, Erfolgsrate, Ø Dauer, gescheiterte Läufe, Zeitstempel des letzten Laufs. Klick eine Zeile, um auf den Ausführungs-Tab dieses Workflows zu springen — der natürliche Drill-Down, wenn eine Metrik falsch aussieht und du die zugrundeliegenden Läufe sehen willst.

Die Liste ist auf die jüngsten 5.000 Ausführungen im Fenster gedeckelt. Wenn das Limit greift, zeigt die Seite ein Banner, das das sagt — ältere Läufe in derselben Periode sind nicht in den Summen enthalten. Verenge das Fenster oder öffne den Ausführungs-Tab des Workflows direkt, wenn das Limit beisst.

## Eine durchgespielte Untersuchung

Jemand fragt, warum der Tagesbericht-Workflow diese Woche langsamer ist. Öffne **Automatisierungen > Metriken** und schalte die Periode auf **Letzte 7 Tage**. Die Kopf-Karten zeigen, dass die Erfolgsrate flach bei 100 % bleibt, aber die durchschnittliche Dauer um 40 % oben ist. Das Trend-Diagramm bestätigt stetiges Volumen — die Verlangsamung ist pro Lauf, nicht lastgetrieben. Die Top-Workflows-Tabelle setzt den Tagesbericht in die Top drei; klick rein, dann sortiere den Tab **Ausführungen** absteigend nach Dauer. Die langsamsten Läufe teilen einen Agent-Schritt, der eine längere Zusammenfassung als üblich produziert. Von dort verengst du das Prompt oder schneidest die Eingabemenge zurück; die Metriken-Karte am nächsten Morgen bestätigt den Fix.

## Wo das hingehört

Metriken ist das Rollup; [Ausführungs-Logs](/de/platform/automations/execution-logs) ist das Pro-Lauf-Detail, von dem das Rollup liest. Nutz Metriken, um einen Workflow zu finden, der Aufmerksamkeit braucht, dann tauche in den Ausführungs-Tab des Workflows ein, um den spezifischen Lauf zu finden, der sich falsch verhielt. Für organisationsweite Token- und Kostenrechnung (statt Läufen und Dauern) trägt das [Audit-Log](/de/platform/admin/governance/audit-logs) und das Nutzungs-Ledger unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) die Pro-Mitglied-Ausgaben.
