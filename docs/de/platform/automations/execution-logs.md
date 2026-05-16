---
title: Ausführungslogs
description: Vergangene Automatisierungs-Läufe lesen, Fehler debuggen und mit neuer Eingabe erneut starten.
---

Der **Ausführungen**-Tab jeder Automatisierung ist die Pro-Lauf-Aufzeichnung von allem, was versucht hat, sie zu starten — Zeitpläne, Webhooks, Ereignisse und manuelle Läufe gleichermassen. Jede Zeile ist ein Lauf, jede Zeile klappt sich zur Schritt-für-Schritt-Spur von Eingaben, Ausgaben und Fehlern auf, die ihn produziert hat. Hier landet ein Entwickler oder Admin, wenn eine Drittanbieter-API nachts `400` zurückgegeben hat und die Frage lautet „welcher Schritt, mit welcher Payload, gegen welches Modell".

Läufe werden gemäss der [Aufbewahrungsrichtlinie](/de/platform/admin/governance#aufbewahrung) der Organisation aufbewahrt. Jenseits dieses Horizonts werden Zeilen vom täglichen Aufräum-Job hart gelöscht; langfristiges Debugging heisst, die Spur zu kopieren, bevor das passiert.

## Ein durchgearbeiteter Fehlschlag

Klicke auf eine beliebige Zeile, um sie auszuklappen. Das Detail-Panel zeigt eine JSON-Ansicht des ganzen Laufs, strukturiert wie folgt:

```json
{
  "execution": {
    "id": "exe_…",
    "status": "failed",
    "startedAt": "2026-05-15T09:12:04.317Z",
    "completedAt": "2026-05-15T09:12:06.842Z",
    "triggeredBy": "webhook",
    "error": "Shopify returned 400: 'price' must be a positive number"
  },
  "metadata": { … trigger source, webhook token id, idempotency key … },
  "variables": { … workflow variables at run time … },
  "journal": [
    { "step": "Start", "status": "completed", "input": { … }, "output": { … } },
    { "step": "Fetch order", "status": "completed", "output": { … } },
    { "step": "Create line item", "status": "failed", "error": { … } }
  ]
}
```

Das Feld `journal` trägt die Last — jeder Schritt, der gelaufen ist, wird in Reihenfolge aufgezeichnet, mit der buchstäblichen Eingabe, der erzeugten Ausgabe und dem Fehler, falls einer geworfen wurde. Fehlgeschlagene Schritte bleiben standardmässig aufgeklappt, damit der Fehler sich selbst zeigt, ohne dass du durch Geschwister suchst.

## Filtern und Suchen

Die Filterleiste über der Tabelle deckt die Fälle ab, nach denen du am häufigsten greifst.

| Filter              | Werte                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Status**          | `running`, `completed`, `failed`, `pending`.                                            |
| **Ausgelöst durch** | `schedule`, `manual`, `event`, `webhook`, `api`, `system`.                              |
| **Zeitraum**        | Heute, letzte 7 Tage, letzte 30 Tage, alle Zeiten oder ein eigenes Von/Bis.             |
| **Suche**           | Exakter Treffer auf die Lauf-ID; nützlich, wenn du die ID aus einem Fehlerbericht hast. |

Die Tabelle lädt die jüngsten Läufe seitenweise und blättert beim Tiefer-Scrollen unendlich weiter. Filter kombinieren sich — `status: failed` plus `triggered by: webhook` plus die letzten 24 Stunden grenzt auf „was ist seit heute Morgen an eingehendem Verkehr explodiert" ein.

## Erneut starten

Aus einer ausgeklappten Zeile spielen zwei Aktionen den Lauf erneut ab:

- **Mit gleicher Eingabe erneut starten** beginnt einen frischen Lauf mit der ursprünglichen Payload. Nützlich, wenn sich die Automatisierung seit dem ursprünglichen Fehlschlag geändert hat und du den Fix bestätigen willst.
- **Mit anderer Eingabe erneut starten** öffnet die Payload in einem Editor, sodass du sie vor dem Feuern anpassen kannst. Nützlich, um Edge Cases abzuklopfen — ändere ein Feld, beobachte, welcher Schritt anders verzweigt.

Erneute Läufe landen als neue Zeilen im **Ausführungen**-Tab; der ursprüngliche Fehlschlag bleibt an Ort und Stelle, damit die Audit-Spur intakt bleibt.

## Alarme

Der **Alarme**-Tab einer Automatisierung erlaubt dir, Fehlschlag-Benachrichtigungen an die E-Mail eines Admins zu verdrahten — feuern, wenn ein Lauf fehlschlägt, wenn er über einen Schwellwert hinaus läuft oder wenn der Fehler zu einem Muster passt. Die Alarme pro Automatisierung decken den Pro-Automatisierungs-Fall ab; für „mehr als fünf Fehlschläge in der letzten Stunde über jede Automatisierung in der Organisation" greife stattdessen zu [Operations](/de/self-hosted/operate/observability/operations) — das trägt die organisationsweite Aufrollung, die die Alarm-Oberfläche absichtlich nicht trägt.

## Wo das einsetzt

Ausführungslogs sind die Pro-Automatisierungs-Debug-Oberfläche — der **Ausführungen**-Tab auf der Automatisierung vor dir. Für die organisationsweite Aufrollung (Gesamtläufe, Erfolgsquote, Top-Automatisierungen nach Volumen) ist [Automatisierungs-Metriken](/de/platform/automations/metrics) das Dashboard. Für organisationsweite Fehler-Trends, die Automatisierungen und Chat mischen, ist [Operations](/de/self-hosted/operate/observability/operations) die richtige Oberfläche, einen Tab daneben.
