---
title: Daten-Residenz
description: Wo deine Cloud-Daten leben, wo sie sich während eines einzelnen Chats bewegen, welche Sub-Prozessoren sie berühren und was in der Region bleibt gegenüber was sie verlässt.
---

Daten-Residenz auf Cloud beantwortet zwei Fragen, die jedes Audit am Ende stellt: welche Region hält deine Daten ruhend, und welche externen Systeme berühren sie im Fluss. Diese Seite verfolgt einen einzelnen Chat-Roundtrip von Anfang bis Ende, listet die Datenklassen und benennt jeden Sub-Prozessor, den deine Nachrichten passieren.

Die Default-Region für neue Cloud-Orgs ist die Schweiz. Die Region nach der Anmeldung zu wechseln ist eine Migration, kein Setting-Flip — eine Org in der EU-Region neu zu erstellen ist schneller, als eine bestehende zu verschieben. Wähl einmal; wähl bewusst.

## Ein durchgespieltes Beispiel — ein Chat-Roundtrip

Der User in Zürich öffnet Chat und sendet „fass den letzten Kundenanruf zusammen". Die Anfrage trifft Tales Edge in der gewählten Region, landet auf `tale-platform`, leitet an `tale-backend-api` (das Backend) weiter, liest Wissen aus der Datenbank des Wissens-Korpus, sobald das Wissens-Tool des Agents danach fragt, und emittiert einen ausgehenden Anruf an den Provider hinter dem Modell, das die sendende Person gewählt hat. Der Wissens-Abruf läuft im Backend — es fragt die Korpus-Datenbank direkt ab, ohne separaten Retrieval-Dienst im Pfad. Der Modell-Provider gibt Tokens zurück; Tale streamt sie auf demselben Pfad zurück. Die Antwort und die Zitate landen in der operativen Datenbank, der Korpus bleibt in der Wissensdatenbank, und beide werden innerhalb der Region repliziert.

Zwei Pfeile überqueren in diesem Trip die regionale Grenze: der Anruf an den Modell-Provider (immer extern) und jeder Sub-Prozessor, den die Tools des Agents ausgelöst haben (Web-Fetch, OneDrive-Lese, MCP-Server in einer anderen Region). Alles andere bleibt in der Region.

## Primärregionen

| Region            | Postgres  | Object Store | DR-Replikat |
| ----------------- | --------- | ------------ | ----------- |
| Schweiz           | Zürich    | Zürich       | Genf        |
| Europäische Union | Frankfurt | Frankfurt    | Dublin      |

Das DR-Replikat ist für Disaster Recovery, nicht für aktiven Verkehr. Die Daten einer Region fliessen nie zum Primary oder Replikat der anderen Region.

## Was in der Region bleibt, was sie verlässt

| Datentyp                         | Region-gebunden | Überquert | Hinweise                                                                             |
| -------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------ |
| Chats und Nachrichten            | ✓               |           |                                                                                      |
| Dokumente und Wissens-Embeddings | ✓               |           |                                                                                      |
| Org-Konfiguration und Rollen     | ✓               |           |                                                                                      |
| Audit-Logs                       | ✓               |           |                                                                                      |
| Modell-Provider-Anfragen         |                 | ✓         | Geht an den konfigurierten Provider; wähl einen regionalen Endpunkt, wenn vorhanden. |
| OneDrive-Sync                    |                 | ✓         | Die Speicherregion von Microsoft gilt.                                               |
| Web-Tool-Abrufe                  |                 | ✓         | Wohin die URL auflöst.                                                               |

## Backups und DR

Tale schnappt beide Postgres-Datenbanken — den operativen Speicher und den Wissens-Korpus — täglich und den Object Store stündlich. Schnappschüsse sind ruhend verschlüsselt mit Schlüsseln, die Tale hält; das DR-Replikat erhält eine Kopie innerhalb der Region. Restores aus Schnappschüssen sind eine kundeninitiierte Operation, geroutet über den Support; das SLA deckt die Restore-Zeit ab.

## Region wechseln

Ein Regionswechsel ist als Export aus der aktuellen Region, Import in die neue Region und DNS-Cutover implementiert. Die Prozedur ist dieselbe wie [Auf Self-hosted migrieren](/de/cloud/migrate-to-self-hosted), ausser dass beide Seiten Cloud-Regionen sind; rechne mit Ausfallzeit im Minutenbereich und einem geplanten Fenster. Es gibt keinen In-place-Region-Schalter.

## Wo das hineinpasst

Daten-Residenz ist die erste Seite, die jede Compliance-Prüfung liest. Paar sie mit [Trust und Compliance](/de/cloud/trust-and-compliance) (welches Framework deckt was) und [Subprozessoren](/de/legal/subprocessors) (die Liste jedes externen Systems, das oben benannt ist). Erwägt deine Org Self-hosted wegen einer Residenz-Anforderung, ist [Self-hosted-Übersicht](/de/self-hosted/overview) die nächste Lektüre — den Stack auf eigener Hardware zu laufen bewegt jeden Pfeil dieser Seite innerhalb deiner eigenen Grenze.
