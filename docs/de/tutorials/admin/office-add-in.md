---
title: Das Outlook-Add-in installieren
description: Roll die Tale-Sidebar in Outlook und Microsoft 365 aus, damit Mitglieder Antworten mit Tale-Agenten direkt aus dem Posteingang verfassen können.
---

Das Outlook-Add-in blendet eine Tale-Sidebar in Outlook im Web, auf dem Desktop und mobil ein. Aus der Sidebar wählt ein Mitglied einen Agent, lässt den offenen Mail-Thread als Kontext einfliessen und bekommt einen Antwort-Draft zurück, ohne die App zu wechseln. Dieser Spaziergang richtet sich an einen Admin, der das Add-in organisationsweit ausrollt; er deckt den Manifest-Deploy, das Anmelden und die Verifikation ab.

Du brauchst die Admin-Rolle in Tale, einen Microsoft-365-Tenant, in dem du Integrated Apps verwaltest, und eine Tale-Instanz, die aus der Microsoft-365-Cloud erreichbar ist. Cloud-Orgs sind standardmässig erreichbar; selbst gehostete Instanzen brauchen eine öffentliche HTTPS-URL.

## Bevor du beginnst

Bestätige drei Dinge auf der Microsoft-Seite: du bist Global Administrator (oder hast die Exchange-Admin-Rolle mit Integrated Apps), die zentrale Bereitstellung ist für deinen Tenant aktiviert, und das Test-Postfach hat Add-ins nicht über eine Mailbox-Policy gesperrt. Auf der Tale-Seite öffne **Einstellungen > Connectors** und prüfe, dass **Microsoft 365** gelistet ist — dort veröffentlicht das Add-in die Manifest-URL.

## Schritt 1 — Die Manifest-URL aus Tale holen

Das Add-in spricht mit Tale über ein Manifest-XML, das das Microsoft-365-Admin-Center hostet. Tale generiert das Manifest pro Instanz, damit die Sidebar auf deine URL zeigt und nicht auf einen geteilten Multi-Tenant-Endpunkt. Öffne **Einstellungen > Connectors > Microsoft 365** und kopier die **Add-in-Manifest-URL**, die das Panel zeigt.

Du solltest eine URL sehen, die auf `/connectors/office/manifest.xml` endet. Öffne sie in einem neuen Tab, um zu bestätigen, dass sie XML zurückgibt und keine HTML-Fehlerseite — bricht das ab, ist deine Instanz von aussen nicht erreichbar oder die Connector ist deaktiviert.

## Schritt 2 — Übers Microsoft-365-Admin-Center ausrollen

Das Manifest sagt Microsoft 365, welche Postfächer die Sidebar sehen dürfen und von welcher URL sie geladen wird. Zentrale Bereitstellung ist der unterstützte Pfad; das Side-Loading pro Nutzer funktioniert, übersteht aber keine Postfach-Migration.

Öffne das Microsoft-365-Admin-Center, navigiere zu **Einstellungen > Integrierte Apps > Eigene Apps hochladen**, wähl **Office-Add-in** und **Link zur Manifest-Datei bereitstellen** und füg die URL aus Schritt 1 ein. Wähl die Rollout-Zielgruppe — den ganzen Tenant, eine Sicherheitsgruppe oder eine konkrete Nutzerliste.

Senden. Microsoft bestätigt den Deploy mit einem grünen Banner; der Rollout erreicht Postfächer typischerweise innerhalb einer Stunde, bei grossen Tenants auch ein paar Stunden später.

## Schritt 3 — Aus der Sidebar anmelden

Öffne Outlook als Nutzer in der Rollout-Zielgruppe, klick eine beliebige Mail an und such das Tale-Icon im Nachrichten-Ribbon. Ein Klick öffnet die Sidebar; beim ersten Öffnen verlangt sie eine Anmeldung mit dem Tale-Konto. Die Anmeldung läuft per OAuth über die Tale-Instanz — derselbe Identity-Anbieter wie in der Web-App.

Nach der Anmeldung listet die Sidebar die für den Nutzer verfügbaren Agenten. Einen auswählen und **Antwort entwerfen** klicken zieht den offenen Mail-Thread als Kontext heran und streamt eine Antwort in die Sidebar. Der Nutzer prüft, bearbeitet und klickt **Einfügen**, um sie ins Outlook-Kompositionsfenster zu droppen.

## Wo das eingesetzt wird

Das Add-in ist der leichteste Weg zu „Tale dort, wo deine Mitglieder ohnehin arbeiten" — kein Portal-Wechsel, kein Copy-Paste. Die Sidebar ist eine dünne Hülle um dieselben Agenten, die du in [Agent erstellen](/de/platform/agents/create) veröffentlichst; Änderungen an Instruktionen, Wissen oder Tools eines Agenten landen mit der nächsten Anfrage in der Sidebar.

Für die breitere Connector-Story — Slack, Gmail, eigene MCP-Server — siehe [Connectors-Überblick](/de/platform/connectors/overview). Betreibst du eine selbst gehostete Instanz und ist die Manifest-URL aus Microsoft 365 nicht erreichbar, deckt die Seite [Linux-Server](/de/self-hosted/install/linux-server) die Voraussetzung „öffentliches HTTPS" ab.
