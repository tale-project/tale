---
title: Projekt-Dateien verwalten
description: Hochladen, Ersetzen, Löschen und die Pro-Projekt-Grössenlimits — und wie Projekt-Dateien in Chats innerhalb des Projekts auftauchen.
---

Der **Files**-Tab eines Projekts ist der geteilte Dateibereich, den jeder Chat im Projekt erreichen kann. Lade eine Datei einmal hoch, und jeder Chat im Projekt — und jeder Agent, der darin läuft — kann sie ohne erneutes Hochladen lesen. Diese Seite deckt den Ordnerbaum, den Upload-Mechanismus und die Grenzen ab.

Der Files-Tab ist keine Wissensdatenbank im Sinn von [Wissen](/de/platform/knowledge/documents). Seine Dateien sind auf ein Projekt begrenzt und tauchen weder in der org-weiten Bibliothek noch in `@`-Pickern ausserhalb des Projekts noch über WebDAV auf; das Projekt zu löschen löscht die Dateien. Für org-weites Referenzmaterial nutz Wissen und bind es an Agents.

## Ordner

Projekt-Dateien liegen in einem Ordnerbaum. **Neuer Ordner** legt einen Ordner auf der Wurzelebene an; das Ordner-Plus-Symbol auf einer Ordnerzeile erstellt einen Unterordner. Klick einen Ordner an, um ihn auszuwählen — der Drop-Bereich wechselt zu _Datei zu „…" hinzufügen_ und Uploads landen darin. Einen Ordner zu löschen löscht alles darin, inklusive der Einträge im Wissensindex; die Bestätigung sagt das, bevor irgendetwas passiert. Ordner hier sind projekt-gebunden: ein gleichnamiger Ordner in der org-weiten Wissensbibliothek ist ein anderer Ordner.

## Ein durchgespielter Upload

Öffne das Projekt, klick **Knowledge**, wähl den Zielordner (oder keinen für die Wurzel) und zieh Dateien auf den Drop-Bereich. Die Zeile erscheint im Baum und löst zu **Indexed** auf, sobald das Retrieval sie aufgenommen hat. Derselbe Upload ist nun aus jedem Chat erreichbar, den das Projekt besitzt: Sende eine Nachricht, die das Thema referenziert, und der Agent ruft sie ab — oder tippe `@` im Composer und hefte die Datei oder gleich einen ganzen Ordner an den Turn.

## Ersetzen und Löschen

Eine Datei zu ersetzen lädt eine neue Kopie unter demselben Namen hoch; die alte Version wandert in die Versions-History des Projekts. Zitate aus früheren Chats verweisen weiterhin auf die Version, die aktiv war, als der Chat sie referenzierte. Eine Datei zu löschen entfernt sie sofort aus dem Picker; bestehende Chats behalten ihre Zitate, aber die darunter liegende Datei wird mit dem restlichen Aufbewahrungs-Kohortenkram des Projekts in den [Papierkorb](/de/platform/admin/governance/trash) verschoben.

## Grössenlimits

Pro-Datei- und Pro-Projekt-Limits werden von der Org unter [Policies and limits](/de/platform/admin/governance/policies-and-limits) gesetzt. Ein Pro-Datei-Limit zu treffen scheitert den Upload mit einem Toast; ein Pro-Projekt-Limit zu treffen scheitert den Upload mit einem anderen Toast, der die Policy benennt. Mitglieder, die ein Limit treffen, können es nicht selbst anheben — ein Admin justiert die Policy, oder der Projektbesitzer löscht ältere Dateien.

## Auftauchen in Chats

Ein Chat, der in einem Projekt gestartet wird, hat automatisch Zugriff auf jede Datei im Files-Tab des Projekts. Das Retrieval-Tool des Agents sieht Projekt-Dateien neben jeglichem agent-gebundenem Wissen. Zitate aus Projekt-Dateien sind auf den Chat begrenzt, der sie erzeugt hat — einen Chat ausserhalb des Projekts zu teilen bewahrt die Zitate, aber der Betrachter kann nicht zur Quelle durchklicken, ausser er ist auch im Projekt.

Anheften mit `@` verengt einen einzelnen Turn: `@Datei` heftet eine Datei an, `@Ordner` einen Ordner samt allem darunter (der Picker bietet in Projekt-Chats die Ordner des Projekts an, überall sonst die org-weiten Wissensordner). Angeheftete Dateien werden zusätzlich in die Sandbox des Agents unter `/user/uploads` geliefert — Coding-Agents wie Claude Code öffnen also die echten Bytes, statt nur Retrieval-Schnipsel zu zitieren.

## Wo das hineinpasst

Dateien verwalten ist die operative Seite für den Files-Tab — die konzeptuelle Rahmung liegt in [Projekt-Konzepte](/de/platform/projects/concepts), und das agent-gebundene Äquivalent über die ganze Org ist [Dokumente](/de/platform/knowledge/documents). Wenn du dich dabei ertappst, dieselben Dateien in viele Projekte erneut hochzuladen, ist das das Signal, sie ins Wissen zu verschieben und stattdessen einen Agent daran zu binden.
