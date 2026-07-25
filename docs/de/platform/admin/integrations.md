---
title: Integrationen (Admin-Sicht)
description: Einstellungen > Integrationen ist der Ort, an dem Admins die Anmeldedaten hinter Slack, Gmail, Outlook, Microsoft 365, Google Drive, Confluence, WebDAV, GitHub, Shopify, Tavily und MCP installieren, konfigurieren und rotieren. Diese Seite behandelt die Admin-Oberfläche, nicht die Per-Integrations-Funktionsliste.
---

Einstellungen > Integrationen ist die Anmeldedaten-Oberfläche für jedes Drittanbieter-System, mit dem Tale im Namen der Organisation spricht. Admins installieren Integrationen einmal; Agents, Workflows und die Dokumenten-Pipeline nutzen sie überall sonst. Diese Seite behandelt die Admin-Seite — was die Liste zeigt, wie Installation und Rotation funktionieren, was ein Admin eingrenzen kann und wie sich die Oberfläche von MCP-Servern unterscheidet.

Die funktionale Geschichte jeder Integration (was sie tut, welche Scopes sie verlangt, was ein Agent aufrufen kann) liegt einen Tab weiter auf den Per-Integrations-Seiten und in der übergreifenden Konzeptseite. Was folgt, ist die Betriebsoberfläche: installieren, rotieren, einschränken, widerrufen.

<Frame caption="Der Integrations-Katalog unter Integration hinzufügen — jeder Connector, den Tale mitbringt, nach Kategorie filterbar.">

![Der Integrations-Katalog mit einem Raster aus Connector-Karten — Slack, Gmail, Google Drive, GitHub, Tavily und mehr — jede mit einer Verbinden-Aktion.](/images/platform/integrations-catalog.webp)

</Frame>

## Was die Liste zeigt

Öffne **Einstellungen > Integrationen**, um auf den installierten Integrationen der Organisation zu landen. Jede Zeile nennt eine Integration, zeigt ihre Kategorie (Kommunikation, Speicher, Identität, Wissen, Quellcode, Handel, KI), den Anmeldedaten-Typ (OAuth2, API-Schlüssel, App-Token) und den Verbindungs-Status (verbunden, ausstehend, Fehler). Die Liste ist nach Kategorie und Status filterbar.

Der Katalog verfügbarer Integrationen sitzt einen Klick entfernt unter **Integration hinzufügen**. Der Katalog liefert aktuell Slack, Microsoft Teams, Discord, Gmail, Outlook, Twilio, Microsoft 365, Google Drive, Confluence, WebDAV, Tavily, GitHub, Shopify und AI-Image; derselbe Katalog ist die Quelle, die die Integrations-Übersicht dokumentiert.

## Eine Integration installieren

Wähl eine Integration aus dem Katalog und klick auf **Verbinden**. Die Integration deklariert den erwarteten Anmeldedaten-Typ und die benötigten Scopes; Tale geht für OAuth-Integrationen den OAuth-Tanz und zeigt ein Formular für API-Schlüssel-Integrationen. Sobald die Anmeldedaten ankommen, prüft Tale sie mit einem No-op-Aufruf gegen das Upstream-System, bevor gespeichert wird — ein Fehler erscheint als Verbindungsfehler mit der Upstream-Meldung dran.

Einige Integrationen tragen Unteroptionen bei der Installation. Microsoft 365 lässt dich wählen, ob OneDrive-Sync, SharePoint-Sync, beide oder nur Single Sign-on aktiviert werden; GitHub lässt dich die Repositories wählen, auf die die Organisation Zugriff erhält; Slack fragt, in welchen Kanälen der Bot posten darf. Die Unteroptionen lassen sich später aus der Zeile der Integration ändern, ohne neu zu installieren.

## Definitionen aus dem mitgelieferten Katalog aktualisieren

Die Definition jeder Integration — ihr Konfigurationsschema, ihr Connector, ihr Icon — wird beim Anlegen der Organisation kopiert und bleibt danach unangetastet; ein Plattform-Upgrade ändert sie also nie hinter deinem Rücken. **Mitgelieferte Integrationen aktualisieren** im Menü **Integration hinzufügen** ersetzt jede mitgelieferte Definition, die vom aktuellen Katalog abweicht, durch die neueste Version. Anmeldedaten, Secrets und selbst hinzugefügte Integrationen bleiben unberührt; die vorherige Version jeder ersetzten Definition bleibt auf dem Server erhalten, sodass ein Operator sie wiederherstellen kann.

## Anmeldedaten rotieren

Zum Rotieren öffne die Zeile der Integration und klick auf **Anmeldedaten rotieren**. OAuth-Integrationen gehen den Tanz nochmal mit denselben Scopes; API-Schlüssel-Integrationen zeigen ein Feld für den neuen Schlüssel. Die alte Anmeldung hört auf zu funktionieren, sobald die neue verifiziert ist — auf Integrations-Ebene gibt es kein Überlappungsfenster für Anmeldedaten. Greif zur Rotation in dem Rhythmus, den deine Sicherheitsrichtlinie vorgibt, oder wann immer das Upstream-System meldet, dass die Anmeldung kompromittiert ist.

Wenn ein Plattform-Upgrade einer OAuth-Integration, die du schon verbunden hast, neue Scopes hinzufügt, rotier einmal, damit der Consent-Bildschirm sie vergibt. **Outlook** ist der aktuelle Fall: nach dem Upgrade, das die Kontoadresse fürs Verfassen liest, müssen bestehende Outlook-Verbindungen einmal rotieren, bevor das Verfassen die echte Adresse statt des bloßen Anbieternamens zeigt — bis dahin funktioniert das Senden weiter; nur das Erfassen der Adresse wartet auf den neuen Scope `User.Read`.

## Eine Integration einschränken

Über die Anmeldedaten hinaus trägt eine Integration zwei Eingrenzungs-Hebel unter ihrer Zeile:

- **Erlaubte Rollen.** Schränke ein, welche Rollen-Agents und -Workflows die Integration aufrufen dürfen. Standard ist jede schreibende Rolle (Redakteur, Entwickler, Admin, Inhaber); das einzuengen ist die Art, wie du etwa die Twilio-Integration aus Mitglieder-Agents fernhältst.
- **Erlaubte Teams.** Schränke ein, welche Team-Agents und -Workflows die Integration aufrufen dürfen. Nützlich, wenn die Anmeldung zur Arbeit eines Teams gehört (das Slack des Supports) und du nicht willst, dass es in ein anderes leakt.

Beide Hebel werden zur Anfrage-Zeit erzwungen, nicht zur Installations-Zeit — ein Hebelwechsel greift beim nächsten Aufruf.

## Eine Integration widerrufen

Klick auf die Zeile, dann auf **Trennen**. Eine getrennte Integration hört sofort auf zu authentifizieren; Agents und Workflows, die von ihr abhängen, melden beim nächsten Aufruf einen Konfigurationsfehler. Die Zeile bleibt mit einem Getrennt-Badge in der Liste, damit der Audit-Pfad überlebt.

Beim Trennen bleibt die gespeicherte Anmeldung erhalten, deshalb bietet die Zeile **Neu verbinden** an — ein Klick, kein erneutes Eintippen. Tale prüft die gespeicherten Anmeldedaten zuerst und markiert die Integration nur dann als verbunden, wenn sie noch funktionieren; wurde das Passwort oder der Schlüssel in der Zwischenzeit geändert, scheitert die Prüfung und die Zeile bleibt getrennt — eine veraltete Anmeldung sieht also nie gesund aus. Über **Andere Anmeldedaten verwenden** trägst du stattdessen eine neue Anmeldung ein. OAuth-Integrationen verbinden sich über den Zustimmungsdialog des Anbieters neu, denn eine widerrufene Freigabe lässt sich nur durch erneutes Autorisieren wiederherstellen. Beim Neuverbinden werden außerdem die beim Trennen deaktivierten Agents wieder aktiv und die an die Integration gebundenen Automatisierungen laufen weiter.

**Verbindung entfernen** geht weiter als Trennen: die gespeicherte Anmeldung wird vollständig gelöscht. Die Vorlage der Integration bleibt im Katalog, du kannst sie also später erneut mit neuen Anmeldedaten verbinden.

## Zwei Instanzen derselben Integration betreiben

Manche Integrationen braucht man mehrfach — zwei Postfächer, zwei Datenbanken, zwei API-Mandanten. Öffne die Integration und wähle **Duplizieren** (auch im ⋯-Menü der Zeile), um eine zweite Instanz anzulegen. Tale kopiert die Konfiguration der Integration unter einem neuen Namen (`Support-Postfach (2)`), lässt die Anmeldedaten für dich frei und klont jede an das Original gebundene Automatisierung, damit die Kopie ihre eigene Synchronisation und ihren eigenen Posteingang bekommt.

Die Kopie startet getrennt und bleibt ruhig — bis du ihre Anmeldedaten einträgst und verbindest, läuft kein geplanter Durchlauf. Ein unkonfiguriertes Duplikat erzeugt also nie fehlschlagende Durchläufe. Duplizieren wird nur dort angeboten, wo eine zweite Instanz tatsächlich funktionieren kann: OAuth-Integrationen (Gmail, Outlook, Slack) und GitHub sind beim Anbieter an ihre exakte Identität gebunden und lassen sich deshalb nicht duplizieren.

Ein Duplikat ist vollständig entfernbar. Solange es getrennt ist, bietet sein Panel **Löschen** an — das entfernt die Instanz, ihre Anmeldedaten und die für sie geklonten Automatisierungen. Mitgelieferte Integrationen bieten nie Löschen an: sie lassen sich nur trennen, damit die Vorlage für die nächste Verbindung erhalten bleibt.

## Slack-Bot und Benachrichtigungen

Slack ist zweigerichtet. Über den Agent, der Slack aufruft (Nachrichten posten, Kanäle lesen), hinaus kann die Organisation Leute aus Slack heraus mit einem Agent sprechen lassen und System-Events in einen Kanal pushen. Beides wird auf der verbundenen Slack-Zeile konfiguriert, und beides nutzt dieselbe OAuth-Anmeldung — keine zweite Verbindung.

Jede Organisation bringt ihre eigene Slack-App mit, vollständig über die Slack-Zeile konfiguriert — auf dem Deployment ist nichts zu setzen. Wenn du Slack verbindest, zeigt die Zeile ein Panel **Slack-App einrichten** mit einem fertig einfügbaren App-Manifest und den beiden URLs, auf die es verweist: die Request-URL für Event Subscriptions (`/api/integrations/slack/events`) und die OAuth-Redirect-URL. Das Manifest füllt die Bot-Berechtigungen, die Events `app_mention` und `message.im` sowie beide URLs vor, sodass das Erstellen der App auf api.slack.com/apps nur ein paar Klicks dauert. Füge **Client-ID**, **Client-Secret** und **Signing-Secret** der App zurück in die Zeile ein und autorisiere dann per OAuth. Das Signing-Secret verifiziert eingehende Events, also bleibt der Bot stumm, bis es gesetzt ist; eingehende Nachrichten werden über den Slack-Workspace zurück an die richtige Organisation geroutet.

Auf der verbundenen Slack-Zeile wählt ein Admin, **welcher Agent auf Slack antwortet** (eine Erwähnung in einem Kanal oder eine Direktnachricht startet eine Thread-Antwort dieses Agents) und **welche Kanäle Benachrichtigungen erhalten**, mit einem Schalter pro Event. Die ausgelieferten Events sind Workflow fehlgeschlagen, Workflow abgeschlossen und Sicherheitswarnungen; ein Slack-Thread bildet sich auf ein Agent-Gespräch ab, und der Slack-Autor bleibt darauf erhalten, statt als System verbucht zu werden.

## Integrationen versus MCP-Server

Zwei Oberflächen lassen einen Agent über Tale hinausgreifen. **Integrationen** sind die hier dokumentierten anbieterspezifischen Erstanbieter-Konnektoren. **MCP-Server** sind externe Prozesse, die das Model Context Protocol freilegen; die Organisation registriert sie unter **Einstellungen > MCP-Server** und genehmigt jedes Tool beim ersten Aufruf. Greif zu einer Integration, wenn eine für das Zielsystem existiert; greif zu [MCP-Servern](/de/platform/integrations/mcp-servers), wenn keine Integration deckt, was du brauchst.

## Wo das hingehört

Integrationen sind die Anmelde-Hälfte der Agent-zu-Aussenwelt-Geschichte; die Agent-Hälfte (welche Tools ein Agent bekommt, wie er sie aufruft, wie die Vertrauensgrenze aussieht) liegt unter [Agent-Tools](/de/platform/agents/tools). Die natürliche nächste Lektüre für einen neuen Admin ist [Integrations-Übersicht](/de/platform/integrations/overview) — sie nennt jede ausgelieferte Integration nach Zweck gruppiert und gibt das Per-Integrations-Setup auf einen Blick.
