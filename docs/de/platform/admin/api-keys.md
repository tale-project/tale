---
title: API-Schlüssel
description: Persönliche Bearer-Anmeldedaten, mit denen externer Code Tales REST-API aufruft. Admins und Entwickler erstellen, rotieren und widerrufen sie unter Einstellungen > API > REST.
---

API-Schlüssel sind die Anmeldedaten, die Tale ausstellt, damit externer Code seine REST-API ohne Person in der Schleife aufrufen kann. Ein Schlüssel authentifiziert den Aufrufer als die Person, die ihn angelegt hat, und trägt deren Rolle in der Organisation. Admins und Entwickler verwalten Schlüssel; andere Rollen sehen die Seite nicht. Das ist die Referenz dafür, was ein Schlüssel ist, wie du einen erstellst, wie er begrenzt ist und wie du ihn außer Dienst stellst, ohne etwas zu zerbrechen, das von ihm abhängt.

Die hier gelisteten Schlüssel sind etwas anderes als die Per-Benutzer-Session-Tokens, die Tale beim Anmelden ausstellt. Die sind kurzlebig und an einen Browser gebunden; API-Schlüssel sind langlebig und für unbeaufsichtigte Aufrufer gedacht. Greif zu einem API-Schlüssel, wenn du ein Skript, einen Cron-Job, einen internen Dienst oder eine Drittanbieter-Connector an Tale anschließt; greif zur In-Produkt-Oberfläche, wenn eine Person an der Tastatur sitzt.

<Frame caption="Einstellungen > API > REST — wo Schlüssel erstellt, rotiert und widerrufen werden.">

![Die REST-API-Schlüssel-Einstellungsseite listet zwei Schlüssel, jeder nur mit seinem Präfix, dem Datum unter Hinzugefügt und der Markierung Nie verwendet, neben der Schaltfläche API-Schlüssel erstellen.](/images/get-started/settings-api-keys.webp)

</Frame>

## Einen Schlüssel erstellen

Öffne **Einstellungen > API > REST** und klick auf **API-Schlüssel erstellen**. Gib dem Schlüssel einen Namen, der sagt, wer oder was ihn nutzt (`Billing-Sync`, `Slack-Relay`, `ops-cron`), und wähl das Ablaufdatum — 7, 30 oder 90 Tage, ein Jahr oder nie; Standard sind 30 Tage. Tale zeigt das Geheimnis genau einmal bei der Erstellung — kopier es in deinen Passwort-Manager oder dein Deployment-System, bevor du den Dialog schließt. Danach zeigt die Tabelle nur noch ein maskiertes Fragment davon.

Der Schlüssel handelt als du: Jede Anfrage, die er macht, trägt deine Rolle in der Organisation. Ein Schlüssel, den ein Entwickler angelegt hat, kann jede Ressource lesen und in die meisten schreiben; einen Schlüssel mit mehr Macht als sein Ersteller gibt es nicht. Weil Schlüssel genau so gefährlich sind wie die Rolle dahinter, lass den am wenigsten privilegierten Account, der den Job erledigt, den Schlüssel anlegen.

## Was die Tabelle zeigt

Die Tabelle listet die Schlüssel, die du angelegt hast — Schlüssel von Teamkolleginnen und -kollegen sind hier nicht sichtbar — jeden mit Name, einem maskierten Fragment des Geheimnisses (die ersten und letzten paar Zeichen), dem Datum unter Hinzugefügt und dem Zeitstempel der letzten Nutzung. Das Fragment reicht, um eine Zeile dem Schlüssel zuzuordnen, den du in der Hand hast, ohne ihn offenzulegen. Der Zeitstempel der letzten Nutzung aktualisiert sich bei jeder erfolgreichen Anfrage, die der Schlüssel macht; ein Schlüssel, der wochenlang ungenutzt war, ist meist sicher auszumustern.

Eine Such- oder Filterzeile gibt es nicht — eine Organisation hält eine Handvoll Schlüssel, und ein bewusstes Namensschema hält die Tabelle überschaubar.

## Einen Schlüssel rotieren

Zum Rotieren erstellst du zuerst den neuen Schlüssel, deployst ihn auf das System, das den alten nutzt, prüfst, dass der neue funktioniert (der Zeitstempel der letzten Nutzung aktualisiert sich), und widerrufst erst dann den alten. Tale rotiert Schlüssel nicht automatisch; die Disziplin der Überlappung liegt bei dir. Rotation ist die richtige Bewegung, wenn ein Verdacht auf Leck besteht, wenn jemand mit Zugriff auf den Schlüssel die Organisation verlässt, oder in dem Rhythmus, den deine Sicherheitsrichtlinie vorgibt.

## Einen Schlüssel widerrufen

Öffne das Zeilenmenü des Schlüssels und klick auf **Schlüssel widerrufen**, dann bestätige. Ein widerrufener Schlüssel authentifiziert sofort nicht mehr — jede laufende Anfrage wird abgeschlossen, aber die nächste schlägt mit `401` fehl — und die Zeile verschwindet aus der Tabelle. Es gibt kein Undo für einen Widerruf; wenn du den falschen widerrufen hast, lege einen neuen an.

## Bereiche und Grenzen

Jeder Schlüssel trägt die Berechtigungen der Rolle seines Erstellers zum Zeitpunkt jeder Anfrage, nicht zum Zeitpunkt der Erstellung. Ändert sich die Rolle der Person — oder wird ihre Mitgliedschaft deaktiviert —, erbt jeder Schlüssel, den sie angelegt hat, die Änderung bei der nächsten Anfrage. Anfragen über die REST-API sind pro aufrufender Adresse rate-limitiert, und eine [Governance-Budgetregel](/de/platform/admin/governance/policies-and-limits) kann deckeln, was ein einzelner Schlüssel für Modelle ausgibt.

## Wo das hingehört

API-Schlüssel sind die Brücke zwischen Tale und externem Code; sie sitzen neben [Connectors](/de/platform/admin/connectors) (Drittanbieter-Systeme, die Tale aufruft) und [Automatisierungs-Webhook-Triggern](/de/platform/automations/triggers) (Systeme, die Tale bei Ereignissen aufrufen). Die natürliche nächste Lektüre ist die REST-API selbst — siehe die API-Referenz im Develop-Tab für die Oberfläche, gegen die ein Schlüssel authentifiziert, und siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) für die Rollen-zu-Berechtigungen-Karte, die jeder Schlüssel erbt.
