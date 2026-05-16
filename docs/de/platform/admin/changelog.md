---
title: Was ist neu
description: Der In-App-Changelog-Viewer — Release-Notes für die Tale-Version deiner Instanz, bei jedem Upgrade aufgefrischt und Badge-gesteuert, damit Nutzer Änderungen sehen, ohne das Produkt zu verlassen.
---

Der **Was ist neu**-Dialog ist der In-App-Changelog-Viewer. Nach einem Release — egal ob die Cloud-Edition automatisch weitergerollt ist oder `tale deploy` auf einer selbst gehosteten Instanz durchgelaufen ist — erscheint neben dem Avatar jedes Nutzers ein kleines Badge, das auf die neuen Einträge zeigt. Öffnest du den Dialog, siehst du die Release-Notes der Version, auf der die Instanz läuft, plus jede frühere Version seit dem letzten Markieren als gelesen. Zielgruppe sind alle im Produkt: Mitglieder sehen, was sich in ihrer Oberfläche geändert hat, Admins lesen dieselben Notes, um zu wissen, was sie dem Team kommunizieren.

Diese Seite ist für Admins und Entwickler, die verstehen müssen, wie der Dialog rendert, woher der Inhalt kommt und was im Geltungsbereich liegt. Es gibt keinen Dialog, den der Admin konfiguriert; Badge und Inhalt werden vollständig durch veröffentlichte Versionen gesteuert.

## Wie der Dialog den Leser erreicht

Tale zeigt das Badge in dem Moment, in dem ein Release mit nutzersichtbaren Änderungen erkannt wird. Ein Klick öffnet den Dialog. Jeder Eintrag trägt eine Versionsnummer, ein Release-Datum und einen Markdown-Body mit den Änderungen dieser Version.

Das Badge verschwindet, wenn der Dialog bestätigt wird — nicht schon beim bloßen Öffnen. Schließt ein Nutzer den Dialog, ohne durch jeden neuen Eintrag zu scrollen, bleibt das Badge bis zur nächsten Sitzung sichtbar. So verhält sich der Indikator wie ein Ungelesen-Zähler und nicht wie eine Einmal-Benachrichtigung.

Springt eine Instanz mehrere Versionen in einem einzigen Upgrade — etwa `v1.4` auf `v1.6`, weil `v1.5` übersprungen wurde — listet der Dialog jede dazwischenliegende Version chronologisch auf. Nichts zwischen den beiden Endpunkten verschwindet durch den Sprung.

## Woher der Inhalt kommt

Release-Notes werden im kanonischen Format gemäß [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) im GitHub-Repo des Projekts veröffentlicht. Die Plattform holt die Notes für jede Version, die der aktuellen Edition sichtbar ist, bei Install- und Upgrade-Zeit, cached sie lokal und rendert die je-Versions-Abschnitte über den gleichen Markdown-Renderer wie der Rest der Doku.

Der Rendering-Pfad ist kurz:

1. CI veröffentlicht Notes bei jedem getaggten Release.
2. Die Plattform zieht das kanonische Markdown bei Install und Upgrade.
3. Der Dialog rendert jeden je-Versions-Abschnitt, neueste zuerst.
4. Der Badge-Zähler erhöht sich, sobald die Notes einer neuen Version landen.

Ist eine selbst gehostete Instanz offline oder darf sie GitHub nicht erreichen, läuft das Upgrade trotzdem durch — der Dialog fällt auf die Notes zurück, die mit dem Release-Artefakt gebündelt sind, und blockiert nicht den Netzwerk-Abruf.

## Was im Geltungsbereich liegt, was nicht

Der In-App-Changelog spiegelt die kanonischen GitHub-Release-Notes. Der Inhalt ist identisch; nur die Oberfläche unterscheidet sich. Abgedeckt sind die Änderungen, die ein Nutzer bemerken würde: neue Funktionen, Breaking Changes, Fehlerbehebungen, die der Leser nachvollziehen kann, und Migrations-Notes für Upgrades, die Operator-Aktion verlangen.

Bewusst nicht abgedeckt:

- **Reine Infrastruktur-Änderungen** — Abhängigkeits-Bumps, interne Refactorings, CI-Anpassungen. Die leben in der Git-Historie.
- **Cloud-spezifische Operations-Notes** — Vorfälle und geplante Wartung gehören auf die [Statusseite](/de/develop/status-page), nicht in den Changelog.
- **Roadmap-Ankündigungen** — dafür ist die Marketing-Seite zuständig; der Changelog beschreibt nur ausgelieferte Versionen.

Für die Operator-Seite eines Upgrades — die exakten CLI-Flags, die Downgrade-Vorbehalte, die abgekündigten Env-Variablen — ist [Release-Notes-Format](/de/self-hosted/operate/release-notes/format) die maßgebliche Quelle.

## Wo das hingehört

Der Changelog ist die nutzerseitige Hälfte jedes Releases. Operatoren lesen die GitHub-Release-Notes, bevor sie `tale deploy` ausführen, um die Aktionspunkte zu planen; alle im Produkt lesen den In-App-Dialog, nachdem das Upgrade gelandet ist, um zu erfahren, was sich geändert hat. Zusammen decken die beiden Surfaces die zwei Enden jedes Releases ab.

Für den Live-Zustand der Cloud-Edition — Vorfälle, Wartung, Regionen-Status — ist die [Statusseite](/de/develop/status-page) die richtige Stelle. Für den historischen Release-Notes-Katalog über jede Version ist die [Release-Notes-Format](/de/self-hosted/operate/release-notes/format)-Referenz die kanonische Stelle.
