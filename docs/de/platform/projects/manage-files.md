---
title: Projekt-Dateien verwalten
description: Der Wissen-Tab eines Projekts hält die Dateien, aus denen jeder Chat im Projekt schöpfen kann — Ordner, Hochladen, Index-Status, Anheften und wie Projekt-Dateien auf das Projekt begrenzt bleiben.
---

Der **Wissen**-Tab eines Projekts ist der geteilte Dateibereich, den jeder Chat im Projekt erreichen kann. Lade eine Datei einmal hoch, und jeder Chat im Projekt — und jeder Agent, der darin läuft — kann sie ohne erneutes Hochladen lesen. Diese Seite deckt den Ordnerbaum, den Upload-Mechanismus, das Anheften und die Grenzen ab.

Der Wissen-Tab ist nicht die org-weite Wissensdatenbank im Sinn von [Dokumente](/de/platform/knowledge/documents). Seine Dateien sind auf ein Projekt begrenzt und tauchen weder in der org-weiten Bibliothek noch in `@`-Pickern ausserhalb des Projekts noch über WebDAV auf; das Projekt zu löschen löscht die Dateien. Für org-weites Referenzmaterial nutz [Dokumente](/de/platform/knowledge/documents) und bind sie an Agents.

<Frame caption="Der Wissen-Tab — der Dateibaum des Projekts; jede Datei bleibt auf dieses Projekt begrenzt und ist für die Suche indexiert.">

![Der Wissen-Tab des Projekts Website relaunch mit zwei indexierten Dateien im Dateibaum, einem Neuer-Ordner-Button und der Dropzone zum Hinzufügen von Dateien.](/images/platform/project-knowledge-files.webp)

</Frame>

## Ordner

Projekt-Dateien liegen in einem Ordnerbaum. **Neuer Ordner** legt einen Ordner auf der Wurzelebene an; das Ordner-Plus-Symbol auf einer Ordnerzeile erstellt einen Unterordner. Klick einen Ordner an, um ihn auszuwählen — der Drop-Bereich wechselt zu _Datei zu „…" hinzufügen_ und Uploads landen darin. Einen Ordner zu löschen löscht alles darin, inklusive der Einträge im Retrieval-Index; die Bestätigung sagt das, bevor irgendetwas passiert. Ordner hier sind projekt-gebunden: ein gleichnamiger Ordner in der org-weiten Dokumentbibliothek ist ein anderer Ordner.

## Ein durchgespielter Upload

Öffne das Projekt, klick **Wissen**, wähl den Zielordner (oder keinen für die Wurzel) und zieh Dateien auf den Drop-Bereich. Die Zeile erscheint im Baum und löst zu **Indexed** auf, sobald das Retrieval sie aufgenommen hat. Derselbe Upload ist nun aus jedem Chat erreichbar, den das Projekt besitzt: Sende eine Nachricht, die das Thema referenziert, und der Agent ruft sie ab — oder tippe `@` im Chat und hefte die Datei oder gleich einen ganzen Ordner an den Turn.

## Ersetzen und Löschen

Eine Datei zu ersetzen lädt eine neue Kopie unter demselben Namen hoch; die frühere Version wandert in die Versions-History des Projekts. Zitate aus früheren Chats verweisen weiterhin auf die Version, die aktiv war, als der Chat sie referenzierte. Eine Datei zu löschen entfernt sie sofort aus dem Picker; bestehende Chats behalten ihre Zitate, aber die darunterliegende Datei wird mit dem Rest der Aufbewahrungs-Kohorte des Projekts in den [Papierkorb](/de/platform/admin/governance/trash) verschoben.

## Eine Datei als gelenktes Dokument führen

Wenn die Freigabe mit genau der Datei verknüpft bleiben muss, die der Reviewer gesehen hat — eine SOP, ein Validierungsplan —, öffne das Zeilenmenü der Datei und klick **Als gelenktes Dokument führen**. Die Zeile trägt danach `v1 · Entwurf` und durchläuft denselben Lebenszyklus wie ein gelenktes Dokument in der org-weiten Bibliothek: **Zum Review einreichen** friert die Datei für einen benannten Reviewer ein, die Freigabe macht die Version unveränderlich, und **Neue Revision** öffnet den nächsten Entwurf. Den vollständigen Lebenszyklus — inklusive Ersetzen der Entwurfsdatei — beschreibt [Dokumente](/de/platform/knowledge/documents#gelenktes-dokument-ueberarbeiten). Am Geltungsbereich ändert das nichts: Eine gelenkte Projekt-Datei bleibt eine Projekt-Datei und ist nur im Projekt sichtbar.

## Grössenlimits

Pro-Datei- und Pro-Projekt-Limits werden von der Org unter [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) gesetzt. Ein Pro-Datei-Limit zu treffen scheitert den Upload mit einem Toast; ein Pro-Projekt-Limit zu treffen scheitert den Upload mit einem anderen Toast, der die Richtlinie benennt. Mitglieder, die ein Limit treffen, können es nicht selbst anheben — ein Admin justiert die Richtlinie, oder der Projektbesitzer löscht ältere Dateien.

## Auftauchen in Chats

Ein Chat, der in einem Projekt gestartet wird, hat automatisch Zugriff auf jede Datei im Wissen-Tab des Projekts. Das Retrieval-Tool des Agents sieht Projekt-Dateien neben jeglichen agent-gebundenen Wissensquellen. Zitate aus Projekt-Dateien sind auf den Chat begrenzt, der sie erzeugt hat — einen Chat ausserhalb des Projekts zu teilen bewahrt die Zitate, aber der Betrachter kann nicht zur Quelle durchklicken, ausser er ist auch im Projekt.

Anheften mit `@` verengt einen einzelnen Turn: `@Datei` heftet eine Datei an, `@Ordner` einen Ordner samt allem darunter (der Picker bietet in Projekt-Chats die Ordner des Projekts an, überall sonst die org-weiten Ordner). Angeheftete Dateien werden zusätzlich in die Sandbox des Agents unter `/user/uploads` geliefert — ein Projekt-Agent auf einem Coding-Harness wie Claude Code öffnet also die echten Bytes, statt nur Retrieval-Schnipsel zu zitieren.

## Wo das hineinpasst

Dateien verwalten ist die operative Seite für den Wissen-Tab — die konzeptuelle Rahmung liegt in den [Projekt-Konzepten](/de/platform/projects/concepts), und das agent-gebundene Äquivalent über die ganze Org ist [Dokumente](/de/platform/knowledge/documents). Wenn du dich dabei ertappst, dieselben Dateien in viele Projekte erneut hochzuladen, ist das das Signal, sie in die [Dokumente](/de/platform/knowledge/documents) zu verschieben und stattdessen einen Agent daran zu binden.
