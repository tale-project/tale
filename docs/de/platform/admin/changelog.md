---
title: Was ist neu
description: Der In-App-Changelog-Viewer — Release-Notes für die Tale-Version, auf der deine Instanz läuft, über Upgrades hinweg aktuell gehalten.
---

Der **Was-ist-neu**-Dialog ist der In-App-Changelog-Viewer. Nach einem Upgrade — egal ob die Cloud-Edition vorwärtsgerollt ist oder `tale deploy` auf deiner selbst gehosteten Instanz fertig geworden ist — erscheint ein kleines Badge in der Navigation, das auf die neuen Einträge zeigt; der geöffnete Dialog zeigt die Release-Notes für die Version, auf der du bist, plus jede vorherige Version seit deinem letzten Besuch. Die Zielgruppe sind alle im Produkt: Mitglieder sehen, was sich in ihrer UI geändert hat, Admins lesen dieselben Notes, um zu wissen, was sie dem Team mitteilen sollen.

Diese Seite ist für Admins und Entwickler, die verstehen wollen, wie der Dialog rendert, woher sein Inhalt kommt und was abgedeckt ist bzw. ausgeschlossen.

## Wie der Dialog die Leserin erreicht

Ein kleines Badge erscheint neben dem Avatar eines Nutzers nach einem Release, der nutzerseitig sichtbare Änderungen einführt. Klicke darauf, um den **Was-ist-neu**-Dialog zu öffnen. Der Dialog listet jede Version, die seit der letzten als gelesen markierten Sitzung veröffentlicht wurde; jeder Eintrag hat eine Versionsnummer, ein Release-Datum und einen Markdown-Körper mit der Beschreibung der Änderungen.

Das Badge wird in dem Moment gelöscht, in dem der Dialog quittiert wird — nicht wenn er nur geöffnet ist. Den Dialog schliessen, ohne durch jeden neuen Eintrag zu scrollen, lässt das Badge bis zur nächsten Sitzung stehen.

## Woher der Inhalt kommt

Release-Notes werden im kanonischen [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) im GitHub-Repository des Projekts veröffentlicht. Die Plattform lädt die Notes für jede Version, die der aktuellen Edition sichtbar ist, und rendert sie im Dialog. Cross-Version-Upgrades — etwa ein Sprung von `v1.4` auf `v1.6`, weil `v1.5` übersprungen wurde — zeigen die Notes jeder Zwischenversion in chronologischer Reihenfolge, sodass keine Änderung zwischen den beiden Versionen durch den Sprung verborgen wird.

Der Render-Pfad:

1. Die CI veröffentlicht Notes bei jedem Tag-Release.
2. Die Plattform lädt die kanonische Markdown-Quelle bei Installation/Upgrade.
3. Der Dialog rendert die Markdown-Abschnitte pro Version chronologisch.
4. Der Badge-Zähler erhöht sich, wenn die Notes einer neuen Version landen.

## Was im Scope ist, was nicht

Der In-App-Changelog spiegelt die kanonischen GitHub-Release-Notes — gleicher Inhalt, nur im Produkt gerendert. Er deckt nutzerseitig sichtbare Änderungen ab: neue Funktionen, Breaking Changes, Bugfixes, die der Leser bemerken würde, und Migrations-Notizen für Upgrades, die Betreiber-Aktion brauchen.

Er deckt **nicht** ab: rein infrastrukturelle Änderungen (Dependency-Bumps, interne Refactors), Cloud-spezifische Betriebsnotizen (die gehen in Status-Posts) oder Roadmap-Ankündigungen (die leben auf der Marketing-Seite). Für die Betreiber-seitigen Details eines Upgrades — genaue CLI-Flags, Downgrade-Vorbehalte, veraltete Umgebungsvariablen — ist die [Release-Notes-Format-Referenz](/de/self-hosted/operate/release-notes/format) die massgebliche Quelle.

## Wo das einsetzt

Der Changelog ist die nutzerseitige Kommunikations-Schicht für Upgrades. Betreiber lesen die GitHub-Release-Notes, bevor sie `tale deploy` ausführen; alle im Produkt lesen den In-App-Dialog, nachdem das Upgrade gelandet ist. Zusammen decken sie beide Enden des Releases ab: die Betreiberin bekommt die Action-Items, die Nutzerin die Erklärung. Für den öffentlichen Status der Cloud-Edition (Incidents, geplante Wartung) ist die [Status-Seite](/de/develop/status-page) die Oberfläche.
