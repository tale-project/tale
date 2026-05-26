---
title: Agent-Versionen
description: Der History-Tab des Agents — jede Änderung als Schnappschuss, mit Vergleich und Wiederherstellung für jede vergangene Version.
---

Jeder Speichervorgang eines Agents erzeugt einen Schnappschuss. Der **History**-Tab am Agent zeigt die Schnappschüsse in umgekehrt chronologischer Reihenfolge; zwei Schnappschüsse zu vergleichen zeigt den Diff dessen, was sich geändert hat, und einen vergangenen Schnappschuss wiederherzustellen ersetzt den aktuellen Stand durch diese Version. Es gibt keine manueller-Speicher-versus-Auto-Speicher-Unterscheidung — jede persistierte Änderung ist eine Version.

Der Mechanismus ist klein, aber lasttragend. Die meisten Teams justieren die Instructions eines Agents wöchentlich; ohne die History würde das Team den Edits nie trauen.

## Ein durchgespielter Diff

Öffne den Agent und wechsle zu **History**. Die Liste zeigt **Current version** oben und jeden früheren **Snapshot version** darunter, mit Autor und Zeitstempel in jeder Zeile. Klick zwei Zeilen, und **Compare changes** öffnet einen Side-by-side-Diff; die geänderten Felder heben sich hervor. Schliess den Diff, um zur Liste zurückzukehren.

## Eine Version wiederherstellen

Öffne einen vergangenen Schnappschuss und klick **Restore this version**. Der aktuelle Stand des Agents wird mit dem Schnappschuss überschrieben, und das Wiederherstellen selbst erzeugt einen neuen Schnappschuss auf der Zeitachse — Wiederherstellungen sind nicht zerstörerisch, nur additiv. Chats, die bereits gegen die vorherige aktuelle Version laufen, laufen darauf weiter, bis sie enden; die wiederhergestellte Version gilt für neue Chats ab dann.

## Was versioniert wird

Die Versionierung deckt Instructions, Modellwahlen, Wissensbindungen, Tool-Schalter, Gesprächseinstiege und Metadaten ab. Sie deckt nicht die zugrunde liegenden Wissensquellen selbst ab — ein Dokument zu ersetzen, an das der Agent gebunden ist, ändert, was der Agent abruft, ohne die Version des Agents zu bumpen. Um eine Wissensänderung zu auditieren, siehe [Audit-Logs](/de/platform/admin/governance/audit-logs).

## Wo das hineinpasst

Versionen sind das Sicherheitsnetz des Agents aus demselben Grund, aus dem git das des Codebases ist: alles, was gespeichert ist, ist wiederherstellbar. Die Begleitseite ist [Audit-Logs](/de/platform/admin/governance/audit-logs) — sie deckt den org-weiten Wer-hat-was-Pfad ab; Versionen decken den pro-Agent Was-war-es-Pfad ab.
