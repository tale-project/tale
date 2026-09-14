---
title: Aufbewahrungsgrenzen festlegen
description: Lege Aufbewahrungsgrenzen je Organisation fest, prüfe Änderungen und verstehe die Datenbereinigung.
---
Die Aufbewahrungsrichtlinie bestimmt, wie lange Tale einzelne Datenkategorien behält. Betreiber legen die zulässigen Grenzen fest; Organisationsadmins aktivieren Kategorien und wählen eine Dauer innerhalb dieser Grenzen. Eine kürzere Dauer kann vorhandene Historie löschen. Prüfe deshalb die Folgen vor der Übernahme.

## Grenzen und Richtlinie unterscheiden

Zwei Dateien unter `TALE_CONFIG_DIR/<orgSlug>/governance/` erfüllen unterschiedliche Aufgaben:

| Datei | Zweck |
| --- | --- |
| `retention.yml` | Grenzen und Standardwerte des Betreibers für jede Kategorie. JSON wird ebenfalls akzeptiert. |
| `retention-policy.yml` | Aktivierte Kategorien und gewählte Fristen der Organisation. Die Governance-Einstellungen verwalten diese Datei. |

Jede Organisation erhält bei ihrer Erstellung eigene Dateien. Eine Änderung an einer Organisation ändert nicht die Richtlinie einer anderen. Fehlt ihre Grenzdatei, greift Tale nicht auf eine Organisation namens `default` zurück.

Jede Kategorie enthält `min`, `max`, `default` und `unit`. Ein höheres `min` verlangt eine längere Aufbewahrung; ein niedrigeres `max` begrenzt die zulässige Dauer. Keiner der beiden Werte aktiviert allein die Bereinigung. Dafür ist die angewendete Richtlinie maßgeblich.

## Grenzen einer Organisation ändern

Gehe von der vorhandenen vollständigen Datei aus und behalte unveränderte Kategorien bei. Dieser Ausschnitt zeigt eine einzelne Kategorie; er ersetzt nicht die gesamte Datei:

```yaml
chatHistory:
  min: 30
  max: 730
  default: 90
  unit: days
```

Die meisten Kategorien verwenden Tage; `userTempHours` und `agentTempHours` verwenden Stunden. Die Kategorie für den Tokenverbrauch heißt `usageLedger`. Verwende die Bezeichner aus der vorhandenen Datei, damit die Validierung Fehler erkennen kann.

Umgebungsvariablen werden ausdrücklich in `_metadata.envNames` an der Dateiwurzel zugeordnet, optional mit `_metadata.envPrefix`. Die mitgelieferte Datei ordnet beispielsweise `TALE_RETENTION_AUDIT_MIN` dem Feld `auditLog.min` zu. Eine Mindestgrenze darf über die Umgebung nur steigen, eine Höchstgrenze nur sinken. Starte die Backend-Prozesse nach Änderungen ihrer Umgebung neu.

## Änderung prüfen und übernehmen

Bitte nach der Änderung den Organisationsadmin, den Vorschlag unter [Richtlinien und Grenzen](/de/platform/admin/governance/policies-and-limits) zu prüfen. Die Bereinigung verwendet den übernommenen Stand der Grenzen. Eine Dateiänderung des Betreibers aktiviert neue Grenzen nicht stillschweigend.

Prüfe aktivierte Kategorien, bisherige und neue Fristen sowie eine mögliche Schonfrist. `auditLogRetentionDays: 730` ist eine gewählte Dauer; `auditLog.min: 365` ist eine Mindestgrenze. Unterscheide diese Bedeutungen beim Prüfen eines Diffs.

<Tip>

Teste kürzere Fristen zunächst mit synthetischen Daten. Prüfe, ob Daten innerhalb der Frist erhalten bleiben, abgelaufene Daten der jeweiligen Löschregel folgen und gesperrte Daten geschützt bleiben.

</Tip>

## Ergebnis der Bereinigung verstehen

Der Backend-Worker bereinigt Daten nach Zeitplan und getrennt je Organisation. Threads, Dokumente, Kontakte und externe Konversationen durchlaufen einen Lebenszyklus. Kategorien mit einzelnen Datensätzen können nach Aufbewahrungs- und Schonfrist direkt gelöscht werden. Nicht jeder gelöschte Datensatz erscheint im Papierkorb.

Auch Audit-Einträge werden je Organisation aufbewahrt. Die Bereinigung entfernt den ältesten zulässigen zusammenhängenden Anfang ihrer Audit-Kette und stoppt an einem Eintrag, den eine Aufbewahrungssperre schützt. Eine kürzere Frist eines Mandanten verkürzt nicht die Historie eines anderen.

`TALE_RETENTION_DISABLED=true` pausiert die geplante Aufbewahrungsbereinigung für ein Wartungsfenster. Die Variable stellt keine Daten wieder her und verhindert keine anderen Löschwege. Halte ihre Aktivierung fest und entferne sie nach der Wartung.

## Gesperrte Daten bewahren

Aufbewahrungssperren haben für ihren unterstützten Geltungsbereich Vorrang vor der Richtlinie. Eine organisationsweite Sperre schützt die Organisation; engere Sperren schützen die zugeordneten Objekte oder Personen. Lies den [Ablauf für Aufbewahrungssperren](/de/platform/admin/governance/legal-hold), bevor du eine betroffene Richtlinie änderst.

Eine Sperre ersetzt kein Backup. Sind Daten außerhalb einer Sperre bereits gelöscht, bringt eine längere Frist sie nicht zurück. Dafür brauchst du ein erhaltenes Backup und den dazu passenden Bereitstellungsstand.
