---
title: API-Schlüssel
description: Organisationsweite Anmeldedaten, mit denen externer Code Tales REST-API im Namen der Organisation aufruft. Admins und Entwickler erstellen, rotieren und widerrufen sie unter Einstellungen > API-Schlüssel.
---

API-Schlüssel sind die organisationsweiten Anmeldedaten, die Tale ausstellt, damit externer Code seine REST-API ohne Person in der Schleife aufrufen kann. Ein Schlüssel authentifiziert den Aufrufer als die Organisation, begrenzt durch die Rolle, die du beim Anlegen wählst. Admins und Entwickler verwalten Schlüssel; andere Rollen sehen die Seite nicht. Das ist die Referenz dafür, was ein Schlüssel ist, wie du einen erstellst, wie du ihn begrenzt und wie du ihn außer Dienst stellst, ohne etwas zu zerbrechen, das von ihm abhängt.

Die hier gelisteten Schlüssel sind etwas anderes als die Per-Benutzer-Session-Tokens, die Tale beim Anmelden ausstellt. Die sind kurzlebig und an eine Person gebunden; API-Schlüssel sind langlebig und an die Organisation gebunden. Greif zu einem API-Schlüssel, wenn du ein Skript, einen Cron-Job, einen internen Dienst oder eine Drittanbieter-Integration an Tale anschließt; greif zur In-Produkt-Oberfläche, wenn eine Person an der Tastatur sitzt.

<Frame caption="Einstellungen > API-Schlüssel — wo Schlüssel erstellt, rotiert und widerrufen werden.">

![Die REST-API-Schlüssel-Einstellungsseite listet zwei Schlüssel, jeder nur mit seinem Präfix, dem Datum unter Hinzugefügt und der Markierung Nie verwendet, neben der Schaltfläche API-Schlüssel erstellen.](/images/get-started/settings-api-keys.webp)

</Frame>

## Einen Schlüssel erstellen

Öffne **Einstellungen > API-Schlüssel** und klick auf **API-Schlüssel erstellen**. Gib dem Schlüssel einen Namen, der sagt, wer oder was ihn nutzt (`Billing-Sync`, `Slack-Relay`, `ops-cron`), wähl die Rolle, die er tragen soll, und wähl das Ablaufdatum. Tale zeigt das Geheimnis genau einmal bei der Erstellung — kopier es in deinen Passwort-Manager oder dein Deployment-System, bevor du den Dialog schließt. Danach ist nur noch das Präfix des Schlüssels in der Tabelle sichtbar.

Die Rolle, die du wählst, begrenzt alles, was der Schlüssel tun kann. Ein Schlüssel mit Entwickler-Rolle kann jede Ressource lesen und in die meisten schreiben; ein Schlüssel mit Mitglied-Rolle kann die Wissensdatenbank lesen und Chats starten, aber nichts konfigurieren. Nimm die kleinste Rolle, die den Job erledigt — Schlüssel sind genau so gefährlich wie die Rolle, die sie tragen.

## Was die Tabelle zeigt

Die API-Schlüssel-Tabelle listet jeden Schlüssel mit Name, Präfix, Rolle, Ersteller, Zeitstempel der letzten Nutzung und Ablauf. Das Präfix sind die ersten acht Zeichen des Geheimnisses — genug, um den Schlüssel in Logs zu identifizieren, ohne ihn offenzulegen. Der Zeitstempel der letzten Nutzung aktualisiert sich bei jeder erfolgreichen Anfrage, die der Schlüssel macht; ein Schlüssel, der wochenlang ungenutzt war, ist meist sicher auszumustern.

Die Filterzeile lässt dich nach Rolle, Ersteller und Ablaufzeitraum einengen. Die Standardsortierung ist „zuletzt erstellt zuerst"; die sekundäre Sortierung ist „zuletzt genutzt".

## Einen Schlüssel rotieren

Zum Rotieren erstellst du zuerst den neuen Schlüssel, deployst ihn auf das System, das den alten nutzt, prüfst, dass der neue funktioniert (der Zeitstempel der letzten Nutzung aktualisiert sich), und widerrufst erst dann den alten. Tale rotiert Schlüssel nicht automatisch; die Disziplin der Überlappung liegt bei dir. Rotation ist die richtige Bewegung, wenn ein Verdacht auf Leck besteht, wenn jemand mit Zugriff auf den Schlüssel die Organisation verlässt, oder in dem Rhythmus, den deine Sicherheitsrichtlinie vorgibt.

## Einen Schlüssel widerrufen

Klick auf die Zeile, dann auf **Widerrufen**. Ein widerrufener Schlüssel authentifiziert sofort nicht mehr — jede laufende Anfrage wird abgeschlossen, aber die nächste schlägt mit `401` fehl. Widerrufene Schlüssel bleiben für den Audit-Pfad in der Tabelle; die Zeile markiert sie als widerrufen und zeigt, wer wann widerrufen hat. Es gibt kein Undo für einen Widerruf; wenn du den falschen widerrufen hast, lege einen neuen an.

## Bereiche und Grenzen

Jeder Schlüssel trägt die Berechtigungen seiner Rolle zum Zeitpunkt jeder Anfrage, nicht zum Zeitpunkt der Erstellung. Wenn du die Berechtigungen einer Rolle über eine Governance-Richtlinie änderst, erbt jeder Schlüssel mit dieser Rolle die Änderung bei der nächsten Anfrage. Die Rate-Limits der Organisation gelten pro Schlüssel, nicht pro Organisation; ein lauter Schlüssel drosselt keinen ruhigen.

Ein Schlüssel kann bei der Erstellung weiter durch eine IP-Allowlist eingeschränkt werden. Die Allowlist nimmt eine kommagetrennte Liste von CIDR-Blöcken; Anfragen außerhalb der Liste schlagen mit `403` fehl. Greif zur IP-Allowlist, wenn das aufrufende System einen stabilen Egress hat und du Tiefenverteidigung willst.

## Wo das hingehört

API-Schlüssel sind die Brücke zwischen Tale und externem Code; sie sitzen neben [Integrationen](/de/platform/admin/integrations) (Drittanbieter-Systeme, die Tale aufruft) und [Automatisierungs-Webhook-Triggern](/de/platform/automations/triggers) (Systeme, die Tale bei Ereignissen aufrufen). Die natürliche nächste Lektüre ist die REST-API selbst — siehe die API-Referenz im Develop-Tab für die Oberfläche, gegen die ein Schlüssel authentifiziert, und siehe [Mitglieder und Rollen](/de/platform/admin/members-and-roles) für die Rollen-zu-Berechtigungen-Karte, die jeder Schlüssel erbt.
