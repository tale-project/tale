---
title: Agent-Versionen
description: Die Verlauf-Ansicht des Agenten-Editors — jeder Speichervorgang als Snapshot, mit Diff gegen die aktuelle Version und Wiederherstellung per Klick.
---

Jeder Speichervorgang eines Agents erzeugt einen Snapshot. Der Button **Verlauf** oben rechts im Agenten-Editor öffnet diese Snapshots in umgekehrt chronologischer Reihenfolge; Vergleichen zeigt, was sich geändert hat, und Wiederherstellen ersetzt den aktuellen Stand durch eine frühere Version. Es gibt keine Unterscheidung zwischen manuellem Speichern und Auto-Speichern — jede persistierte Änderung ist eine Version.

Der Mechanismus ist klein, aber lasttragend. Die meisten Teams justieren die Anweisungen eines Agents wöchentlich; ohne den Verlauf würde das Team den Änderungen nie trauen.

## Eine Änderung prüfen

Öffne den Agent und klicke auf **Verlauf**. Die Liste zeigt oben **Aktuelle Version** und darunter jede frühere **Snapshot-Version**, mit Autor und Zeitstempel pro Zeile. Wähle einen Snapshot, und **Änderungen vergleichen** stellt die Unterschiede zwischen ihm und der aktuellen Version gegenüber — die geänderten Felder heben sich hervor —, bevor du dich für das Wiederherstellen entscheidest.

## Eine Version wiederherstellen

Klicke in einem Snapshot auf **Diese Version wiederherstellen**. Der aktuelle Stand des Agents wird durch den Snapshot ersetzt — eine Meldung bestätigt **Agent aus Verlauf wiederhergestellt** — und die Wiederherstellung landet als eigener Eintrag auf der Zeitleiste; Wiederherstellungen sind also additiv, nicht destruktiv. Chats, die schon gegen die vorherige Version laufen, laufen auf ihr weiter, bis sie enden; die wiederhergestellte Version gilt ab dem nächsten Chat.

## Was versioniert wird

Die Versionierung deckt alles ab, was der Agent selbst trägt: seine Anzeigetexte und Beschreibung, seine Anweisungen, die Erlaubnislisten für Tools und Skills, den Wissensbereich, seine Sichtbarkeit und seine Metadaten. Was ein Agent nur ansteuert, erreicht sie nicht. Ein ersetztes Dokument, aus dem er abruft, ändert seine Antwort, ohne die Version zu erhöhen, und ein ersetztes Skill-Bundle, das er bindet, ebenso — die Bindung nennt einen Slug, seine eigene Konfiguration bleibt also unverändert, sein Verhalten nicht. Um beides zu prüfen, siehe [Audit-Logs](/de/platform/admin/governance/audit-logs).

## Wo das hingehört

Versionen sind das Sicherheitsnetz des Agents, aus demselben Grund, aus dem git das der Codebasis ist: alles Gespeicherte ist wiederherstellbar. Die Begleitseite ist [Audit-Logs](/de/platform/admin/governance/audit-logs) — sie deckt die organisationsweite Spur ab, wer was getan hat; der Verlauf deckt die Spur pro Agent ab, was es war.
