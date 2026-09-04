---
title: Zugangsdaten für Connectors
description: Unter Einstellungen > Connectors legt eine Organisation die Zugangsdaten an, mit denen sich jeder mitgelieferte Connector anmeldet — benennen, zum Standard machen, deaktivieren, neu verbinden.
---

Jeder Connector wird mit der Plattform ausgeliefert, deshalb besteht die Arbeit eines Admins nie aus Installation, sondern aus einer Entscheidung: als welche Konten Tale handeln darf, und wie diese Zugangsdaten gesund bleiben. Ein Connector hält so viele Einträge, wie du brauchst — einen pro Workspace, Shop, Postfach oder Bot — und einer davon antwortet für jeden Aufrufer, der keinen benennt. Diese Seite ist die Betriebsseite davon: was die Seite zeigt, wie jede Authentifizierungsmethode ausgefüllt wird und was beim Hochstufen, Deaktivieren, Löschen oder Neuverbinden einer Zeile geschieht.

Der Katalog selbst — die dreizehn Connectoren, was jeder davon bringt und wie ihre Aktionen in Automationen und Agent-Läufen ankommen — steht unter [Connectors](/de/platform/connectors/overview). Hier lohnt sich die Zeit für den Lebenszyklus der Zugangsdaten, denn dieser Teil unterscheidet sich pro Organisation und dieser Teil geht kaputt.

## Was die Seite zeigt

Öffne **Einstellungen > Connectors**. Die Seite verlangt Admin- oder Entwickler-Rechte und ist eine Tabelle der Zugangsdaten, die deine Organisation hält — eine Zeile pro Eintrag, nicht eine pro ausgeliefertem Connector. Eine Zeile zeigt den Namen, den Connector, gegen den sie sich authentifiziert, die Authentifizierungsmethode und die Koordinaten: eine maskierte Vorschau des gespeicherten Secrets sowie die Instanz-URL dort, wo der Connector eine braucht. Ein **Standard**-Badge markiert den Eintrag, auf den eine Aktion zurückfällt, ein **Deaktiviert**-Badge jeden abgeschalteten.

Die Suche deckt sowohl den Namen ab, den du vergeben hast, als auch den Connector dahinter; der Filter-Knopf grenzt auf einen Connector ein. Ein `?connector=`-Link grenzt die Tabelle genauso ein — dorthin kehrt auch der OAuth-Umweg zurück.

Zwei Warnungen erscheinen hier, und sie bedeuten Unterschiedliches. _Keine Standard-Zugangsdaten für {connector}_ heißt: jede Zeile funktioniert, aber für einen Aufrufer ohne eigene Angabe antwortet nichts. **Neu verbinden nötig** auf einer Zeile heißt: eine OAuth-Freigabe lässt sich nicht mehr erneuern und braucht neue Zustimmung — mit den Zugangsdaten selbst ist alles in Ordnung.

## Zugangsdaten hinzufügen

**Zugangsdaten hinzufügen** öffnet den mitgelieferten Katalog. Connectoren, für die du schon Zugangsdaten hältst, stehen zuerst unter **Konfiguriert**; alles andere folgt darunter, jeweils mit den Kategorien und der Anzahl der Aktionen. Die Suche grenzt die Liste ein; eine Auswahl führt zum Einrichtungsschritt, **Zurück** wieder heraus.

Die Einrichtung fragt zuerst nach einem **Namen**, und der Hilfetext des Felds erklärt, warum er zählt: unter diesem Namen wählt eine Aktion diesen Eintrag aus. Nimm etwas, das eine Autorin von Automationen Monate später wiedererkennt, etwa `Support-Postfach` oder `Shop EU`.

Was nach dem Namen folgt, hängt von der **Authentifizierungsmethode** ab, die der Connector akzeptiert.

<Tabs>

<Tab title="API-Schlüssel">

Ein Feld, **API-Schlüssel**. Wohin der Schlüssel reist, entscheiden die Aktionen des Connectors selbst — ein Header, den der Anbieter vorgibt, oder der Request-Body, wo der Anbieter darauf besteht. Shopify und Tavily sind die ausgelieferten Fälle.

</Tab>

<Tab title="Token">

Ein Feld, **Token**, das bei jeder Anfrage als Authorization-Header gesendet wird. GitHub nimmt so ein Personal Access Token entgegen; Discord nimmt ein Bot-Token, das die Plattform unter Discords eigenem Schema statt unter dem üblichen sendet.

</Tab>

<Tab title="Benutzername & Passwort">

Zwei Felder, **Benutzername** und **Passwort**, gesendet als HTTP Basic. Das Paar ist nicht immer ein Login im Alltagssinn: Confluence nimmt die Konto-E-Mail mit einem API-Token, Twilio die Account SID mit dem Auth Token, und der WebDAV-Connector ein WebDAV-App-Passwort. IMAP / SMTP nimmt den Postfach-Login selbst.

</Tab>

<Tab title="OAuth">

Kein Secret zum Eintippen, der Einrichtungsschritt ist also allein die Übergabe: **Verbinden** bringt dich zum Freigabe-Dialog des Anbieters, und Tale legt ab, was zurückkommt — Access Token, Refresh Token, Ablauf und die erteilten Scopes — als neue Zeile. Gmail, Google Drive, Outlook, Teams und Slack verbinden sich so. Ein Connector, der beides akzeptiert, bietet beides an, mit **Verbinden** zuerst.

**Verbinden** braucht ein Ziel: Für den Connector muss eine OAuth-App existieren — entweder für diese Organisation hinterlegt (siehe unten) oder in der Deployment-Umgebung registriert. Solange keine existiert, sagt der Dialog das, statt den Button anzubieten.

</Tab>

</Tabs>

Einen zweiten Eintrag an einem Connector anzulegen, der schon einen hat, ist derselbe Ablauf noch einmal — der Connector steht dann im Katalog unter **Konfiguriert**. Es gibt keine Grenze zu umgehen und nichts vorher zu trennen.

<Note>

Confluence und Shopify fragen zusätzlich nach einer **Instanz-URL**, weil beide keinen einheitlichen Anbieter-Host haben. Confluence will die Adresse deiner Atlassian-Site — dort, wo du Confluence öffnest. Shopify will die `myshopify.com`-Adresse deines Shops, also die Admin-Adresse statt der Storefront-Domain. Dieser Wert liegt absichtlich unverschlüsselt, damit die Tabelle zeigen kann, auf welche Instanz jede Zeile zeigt.

</Note>

## Den Standard wählen

Ein Eintrag pro Connector kann der **Standard** sein, und **Zum Standard machen** verschiebt ihn auf jede beliebige Zeile. Der Standard greift, wenn ein Automations-Node — oder der Aufruf eines Agents über den Broker — keine Zugangsdaten benennt. Der Mail-Sync ist die Ausnahme in die andere Richtung: `conversation.sync_mailbox` läuft über jeden _aktiven_ Eintrag des Connectors — ein zweites IMAP-Postfach (oder ein zweites Gmail-Konto) holt er also mit ab, ohne dass du es zum Standard machen musst. Jeder Eintrag merkt sich dabei seine eigene Position in seinem eigenen Postfach. Die Posteingangs-Sichtung verteilt sich über `conversation.list_mailbox_messages` genauso.

Ein Connector mit mehreren Einträgen und ohne Standard ist eine funktionierende Konfiguration mit einer Lücke darin. Aufrufer, die eine Zeile benennen, laufen weiter; alle anderen können nicht wählen und scheitern. Stufe eine Zeile hoch, und die Lücke schließt sich sofort.

## Ein Secret ersetzen

Einen Schlüssel zu wechseln ist eine Bearbeitung am Eintrag, keine eigene Operation. Öffne die Zeile und wähle je nach Methode **API-Schlüssel ersetzen**, **Token ersetzen** oder **Benutzername & Passwort ersetzen**. Das gespeicherte Secret wird nie angezeigt, und ein neuer Wert ersetzt es überall dort, wo dieser Eintrag verwendet wird — jeder Automations-Node, der darauf zeigt, übernimmt den neuen Wert, ohne angefasst zu werden.

Name, Standard-Kennzeichen und Instanz-URL überstehen den Wechsel, nachgelagert muss also nichts umgezogen werden. **Zugangsdaten bearbeiten** deckt die andere Richtung ab: eine Zeile umbenennen oder auf eine andere Instanz umziehen.

## Deaktivieren und löschen

**Deaktivieren** nimmt einen Eintrag aus dem Betrieb und behält die Zeile mit allem, was daran konfiguriert ist. Der Eintrag erscheint als **Deaktiviert**, und nichts löst mehr auf ihn auf; **Aktivieren** holt ihn zurück. Greif dazu, wenn ein Konto verdächtig ist statt erledigt, oder wenn eine Konfiguration geparkt werden soll, ohne verloren zu gehen.

<Warning>

**Löschen** wirkt sofort und endgültig. Automationen und Agent-Läufe, die diesen Eintrag verwenden, verlieren augenblicklich den Zugriff auf diesen Connector — eine Schonfrist gibt es nicht. Löschst du den Standard, bleibt der Connector ohne einen, bis du eine andere Zeile hochstufst; die Rückfrage weist darauf hin, bevor du bestätigst.

</Warning>

## OAuth-Apps einrichten

Der Abschnitt **OAuth-Apps** unten auf der Seite — sichtbar für Admins und Inhaber — bestimmt, gegen welche App-Registrierung des Anbieters die Freigabe jedes OAuth-Connectors läuft. Eine hier hinterlegte App gehört dieser Organisation und hat Vorrang vor der deployment-weiten aus der Umgebung; ohne beides lässt sich der Connector nicht verbinden, und die Liste sagt **Nicht eingerichtet**.

**Einrichten** nimmt Client-ID und Secret aus der App-Registrierung des Anbieters entgegen, bei einer Single-Tenant-Microsoft-App zusätzlich die Verzeichnis-ID (Tenant) — Tale autorisiert dann gegen diesen Tenant. Der Dialog listet die Redirect-URIs, die vor dem Verbinden beim Anbieter zu registrieren sind. Das Secret liegt verschlüsselt, wird nie wieder angezeigt, und ein späteres Bearbeiten darf das Feld leer lassen, um es zu behalten. **Entfernen** verwirft die App der Organisation; die des Deployments übernimmt, falls vorhanden, und bestehende Verbindungen laufen weiter, bis ihre Tokens ablaufen.

Zwei Einträge reichen über diese Seite hinaus: Die **Google Drive**-App teilt sich mit dem Google-Drive-Import von Wissen (ein Google-OAuth-Client, beide Redirect-URIs), und **OneDrive / SharePoint (Wissens-Import)** existiert nur für diesen Import — er hat keinen eigenen Connector. Slack fehlt mit Absicht: Seine App bleibt in der Deployment-Umgebung, weil die Signaturprüfung eingehender Events läuft, bevor eine Organisation bekannt ist.

Meldet sich deine Organisation über Microsoft Entra ID an, kennt Tale die App-Registrierung bereits — die Zeile **OneDrive / SharePoint (Wissens-Import)** bietet dann zusätzlich **Entra-ID-App aus SSO übernehmen**. Das kopiert Client-ID und Secret der SSO-Registrierung serverseitig in diesen Eintrag — das Secret durchläuft nie den Browser — und der Bestätigungsdialog listet, was dieser Registrierung in Entra noch fehlt, bevor Mitglieder verbinden können: die Import-Redirect-URI als „Web"-URI und die delegierten Microsoft-Graph-Berechtigungen. Die Kopie ist bewusst einmalig; tauschst du das SSO-Secret später aus, kopierst du es hier erneut.

## Eine kaputte Autorisierung neu verbinden

Ein OAuth-Eintrag, dessen gespeicherte Autorisierung abgelaufen ist oder widerrufen wurde, zeigt **Neu verbinden nötig** samt Grund. Das ist der Befund der Plattform und nicht die Entscheidung eines Admins, deshalb liest es sich anders als ein Eintrag, den jemand von Hand deaktiviert hat: an der Zeile ist nichts falsch, der Anbieter erkennt die Freigabe nur nicht mehr an.

**Neu verbinden** startet den Freigabe-Dialog des Anbieters erneut und stellt den Zugriff auf derselben Zeile wieder her — mit Name, Standard-Kennzeichen und allen Verweisen darauf. Ein Eintrag, den du selbst deaktiviert hast, wird auf diesem Weg nicht repariert; dort hilft **Aktivieren**, und Neuverbinden würde die falsche Frage beantworten.

## Connectoren und MCP-Server

Ein Connector ist anbieterspezifisch, kommt mit der Plattform und wird für dich gepflegt; deine Seite davon sind die Zugangsdaten. Einen eigenen MCP-Server zu registrieren, den Agenten aufrufen, gibt es in dieser Version nicht — gibt es für ein System keinen Connector, erreicht dein eigener Code es über die **Secrets** eines Projekt-Agenten oder einen `transform`-Knoten einer Automatisierung, und Tales einzige MCP-Oberfläche ist der eingehende Endpoint unter **Einstellungen > API > MCP**, an dem dein Client Tale steuert. [MCP-Server](/de/platform/connectors/mcp-servers) legt beides dar.

## Wo das hingehört

Zugangsdaten zu verwalten ist inzwischen die gesamte Connector-Administration, weil nichts mehr installiert wird: Konten anlegen, gut benennen, pro Connector einen Standard halten und die OAuth-Einträge neu verbinden, die auslaufen. [Connectors](/de/platform/connectors/overview) ist der Katalog, an dem diese Einträge hängen, [Projekt-Agenten](/de/platform/projects/project-agents) zeigt, wie die daraus entstehenden Aktionen in der Ausrüstung eines Agents ankommen, und [Genehmigungen konfigurieren](/de/platform/approvals/configure) ist der Ort, an dem schreibende Aktionen auf eine Freigabe warten.
