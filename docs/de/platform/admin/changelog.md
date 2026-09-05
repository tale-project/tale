---
title: Changelog
description: Der In-Produkt-Release-Viewer, der zeigt, was sich in der Tale-Plattform selbst geändert hat.
---

Der Changelog ist der In-Produkt-Viewer, der Release Notes für die Tale-Plattform selbst anzeigt — nicht für Inhalte, die deine Mitglieder produzieren. Nach einem selbst gehosteten Upgrade oder einem Managed-Cloud-Rollout listet der Viewer auf, was sich zwischen der vorherigen Version und der jetzt laufenden geändert hat. Admins lesen ihn nach einem Upgrade, um das Team einzuweisen und alles zu markieren, was die Arbeit der Mitglieder berührt.

Der Viewer liest Release Notes aus dem Tale-Repository auf GitHub und cached jede Seite für eine Stunde — wiederholte Besuche laden nichts neu, ein kalter Cache braucht GitHub aber erreichbar.

## Wo der Changelog lebt

Der Changelog hat zwei Oberflächen. Die Seite **Was ist neu** listet jeden jüngsten Release mit den vollen Notes. Der **Upgrade-Toast** feuert einmal pro Versionssprung und verlinkt direkt auf die Seite — der Toast zeigt `Aktualisiert auf v<version>` mit der Aktion **Anzeigen** und verschwindet nach ein paar Sekunden von selbst; ein Punkt auf deinem Avatar bleibt stehen, bis du die Notes wirklich öffnest, damit ein Mitglied, das weg war, den Hinweis nicht verpasst.

Öffne die Seite über dein Benutzermenü — dessen Fusszeile nennt die laufende Version und verlinkt **Neuigkeiten** — oder über den Upgrade-Toast, wenn er erscheint. Die Seite holt etwa dreissig jüngste Releases; ältere verlinken in die GitHub-Release-Historie.

## Was jeder Eintrag zeigt

Jeder Release-Eintrag trägt vier Felder: das Versions-Tag, das Veröffentlichungsdatum, den Release-Namen (oft eine kurze Überschrift) und den Release-Body in Markdown. Tale rendert den Body wie GitHub — Überschriften, Listen, Links und Code-Fences überleben alle. Releases, die GitHub noch nicht veröffentlicht hat, zeigen eine kurze Erklär-Karte mit einem Link zur öffentlichen Release-Historie.

## Scope

Der Changelog ist der Changelog der Plattform — was sich in Tale selbst geändert hat. Er zeigt nicht Änderungen an deinen Agents, deinen Workflows oder deiner Wissensdatenbank; die haben ihre eigene Pro-Ressource-Historie. Wenn du die Versionshistorie eines Agents oder Workflows suchst, öffne die Ressource und wechsle auf den Tab **Historie**.

Der Viewer ist nur-lesend und für jedes angemeldete Mitglied sichtbar. Es gibt kein Admin-only-Flag — jeder mit einem Account kann die Seite öffnen. Die Daten, die der Viewer abruft, sind öffentliche Release-Informationen aus dem Tale-GitHub-Repository, also gibt es nichts Organisationsinternes zu verstecken.

## Ein durchgespieltes Upgrade

Nach einem selbst gehosteten Upgrade von `v0.42` auf `v0.45` melde dich an und schau oben rechts nach dem Upgrade-Toast. Klick auf **Anzeigen**, um die Changelog-Seite zu öffnen. Die Seite zeigt drei Release-Einträge (`v0.43`, `v0.44`, `v0.45`), neuester zuerst, jeder mit den von Entwicklern geschriebenen Notes aus dem GitHub-Release. Geh die Highlights durch, teile den Link mit dem Team, falls etwas ein grösseres Publikum braucht; der Toast feuert nur einmal pro Version, und der Punkt auf deinem Avatar verschwindet, sobald du die Notes geöffnet hast.

Wenn das Upgrade über das geholte Fenster hinausgeht, zeigt die Seite die jüngsten Einträge mit einem Banner, der für die früheren Notes auf GitHub verlinkt. Der Cache bleibt warm für den nächsten Leser auf deiner Instanz.

## Wo das hingehört

Der Changelog ist die Operator-Lesart dessen, was Tale selbst gerade getan hat; er steht neben dem Audit-Log (das festhält, was deine Mitglieder getan haben) und der Anbieter-Seite (die festhält, welche Modellversionen verdrahtet sind). Paar ihn mit [Selbst gehostetes Upgrade](/de/self-hosted/operate/upgrades), wenn du die Instanz betreibst — der Upgrade-Leitfaden geht den Versionssprung durch, und der Changelog liest auf der anderen Seite das Ergebnis aus.
