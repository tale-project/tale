---
title: Zugangsdaten für Connectors
description: Unter Einstellungen > Connectors legt eine Organisation die Zugangsdaten an, mit denen sich jeder mitgelieferte Connector anmeldet — benennen, zum Standard machen, deaktivieren, neu verbinden.
---

Jeder Connector wird mit der Plattform ausgeliefert, deshalb besteht die Arbeit eines Admins nie aus Installation, sondern aus einer Entscheidung: als welche Konten Tale handeln darf, und wie diese Zugangsdaten gesund bleiben. Ein Connector hält so viele Einträge, wie du brauchst — einen pro Workspace, Shop, Postfach oder Bot — und einer davon antwortet für jeden Aufrufer, der keinen benennt. Diese Seite ist die Betriebsseite davon: was die Seite zeigt, wie jede Authentifizierungsmethode ausgefüllt wird und was beim Hochstufen, Deaktivieren, Löschen oder Neuverbinden einer Zeile geschieht.

Der Katalog selbst — die dreizehn Connectoren, was jeder davon bringt und wie ihre Aktionen in Automationen und im Chat ankommen — steht unter [Connectors](/de/platform/connectors/overview). Hier lohnt sich die Zeit für den Lebenszyklus der Zugangsdaten, denn dieser Teil unterscheidet sich pro Organisation und dieser Teil geht kaputt.

## Was die Seite zeigt

Öffne **Einstellungen > Connectors**. Die Seite verlangt Admin- oder Entwickler-Rechte und ist eine Tabelle der Zugangsdaten, die deine Organisation hält — eine Zeile pro Eintrag, nicht eine pro ausgeliefertem Connector. Eine Zeile zeigt den Namen, den Connector, gegen den sie sich authentifiziert, die Authentifizierungsmethode und die Koordinaten: eine maskierte Vorschau des gespeicherten Secrets sowie die Instanz-URL dort, wo der Connector eine braucht. Ein **Standard**-Badge markiert den Eintrag, auf den eine Aktion zurückfällt, ein **Deaktiviert**-Badge jeden abgeschalteten.

Die Suche deckt sowohl den Namen ab, den du vergeben hast, als auch den Connector dahinter; der Filter-Knopf grenzt auf einen Connector ein. Ein `?connector=`-Link grenzt die Tabelle genauso ein — dorthin kehrt auch der OAuth-Umweg zurück.

Zwei Warnungen erscheinen hier, und sie bedeuten Unterschiedliches. _Keine Standard-Zugangsdaten für {connector}_ heißt: jede Zeile funktioniert, aber für einen Aufrufer ohne eigene Angabe antwortet nichts. **Neu verbinden nötig** auf einer Zeile heißt: eine OAuth-Freigabe lässt sich nicht mehr erneuern und braucht neue Zustimmung — mit den Zugangsdaten selbst ist alles in Ordnung.

## Zugangsdaten hinzufügen

**Zugangsdaten hinzufügen** öffnet den mitgelieferten Katalog. Connectoren, für die du schon Zugangsdaten hältst, stehen zuerst unter **In Verwendung**; alles andere folgt unter **Verfügbar**, alphabetisch, jeweils mit den Kategorien und der Anzahl der Aktionen. Die Suche grenzt die Liste ein; eine Auswahl führt zum Einrichtungsschritt, **Zurück zum Katalog** wieder heraus.

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

</Tab>

</Tabs>

Einen zweiten Eintrag an einem Connector anzulegen, der schon einen hat, ist derselbe Ablauf noch einmal — der Connector steht dann im Katalog unter **In Verwendung**. Es gibt keine Grenze zu umgehen und nichts vorher zu trennen.

<Note>

Confluence und Shopify fragen zusätzlich nach einer **Instanz-URL**, weil beide keinen einheitlichen Anbieter-Host haben. Confluence will die Adresse deiner Atlassian-Site — dort, wo du Confluence öffnest. Shopify will die `myshopify.com`-Adresse deines Shops, also die Admin-Adresse statt der Storefront-Domain. Dieser Wert liegt absichtlich unverschlüsselt, damit die Tabelle zeigen kann, auf welche Instanz jede Zeile zeigt.

</Note>

## Den Standard wählen

Ein Eintrag pro Connector kann der **Standard** sein, und **Zum Standard machen** verschiebt ihn auf jede beliebige Zeile. Der Standard greift, wenn ein Automations-Node oder eine Chat-Aktion keine Zugangsdaten benennt — und das ist der Normalfall. Einen Eintrag ausdrücklich zu benennen ist die Ausnahme, reserviert für den Workflow, der ein bestimmtes Konto braucht.

Ein Connector mit mehreren Einträgen und ohne Standard ist eine funktionierende Konfiguration mit einer Lücke darin. Aufrufer, die eine Zeile benennen, laufen weiter; alle anderen können nicht wählen und scheitern. Stufe eine Zeile hoch, und die Lücke schließt sich sofort.

## Ein Secret ersetzen

Einen Schlüssel zu wechseln ist eine Bearbeitung am Eintrag, keine eigene Operation. Öffne die Zeile und wähle je nach Methode **API-Schlüssel ersetzen**, **Token ersetzen** oder **Benutzername & Passwort ersetzen**. Das gespeicherte Secret wird nie angezeigt, und ein neuer Wert ersetzt es überall dort, wo dieser Eintrag verwendet wird — jeder Automations-Node und jede Chat-Aktion, die darauf zeigt, übernimmt den neuen Wert, ohne angefasst zu werden.

Name, Standard-Kennzeichen und Instanz-URL überstehen den Wechsel, nachgelagert muss also nichts umgezogen werden. **Name & Instanz bearbeiten** deckt die andere Richtung ab: eine Zeile umbenennen oder auf eine andere Instanz umziehen.

## Deaktivieren und löschen

**Deaktivieren** nimmt einen Eintrag aus dem Betrieb und behält die Zeile mit allem, was daran konfiguriert ist. Der Eintrag erscheint als **Deaktiviert**, und nichts löst mehr auf ihn auf; **Aktivieren** holt ihn zurück. Greif dazu, wenn ein Konto verdächtig ist statt erledigt, oder wenn eine Konfiguration geparkt werden soll, ohne verloren zu gehen.

<Warning>

**Löschen** wirkt sofort und endgültig. Automationen und Chat-Aktionen, die diesen Eintrag verwenden, verlieren augenblicklich den Zugriff auf diesen Connector — eine Schonfrist gibt es nicht. Löschst du den Standard, bleibt der Connector ohne einen, bis du eine andere Zeile hochstufst; die Rückfrage weist darauf hin, bevor du bestätigst.

</Warning>

## Eine kaputte Autorisierung neu verbinden

Ein OAuth-Eintrag, dessen gespeicherte Autorisierung abgelaufen ist oder widerrufen wurde, zeigt **Neu verbinden nötig** samt Grund. Das ist der Befund der Plattform und nicht die Entscheidung eines Admins, deshalb liest es sich anders als ein Eintrag, den jemand von Hand deaktiviert hat: an der Zeile ist nichts falsch, der Anbieter erkennt die Freigabe nur nicht mehr an.

**Neu verbinden** startet den Freigabe-Dialog des Anbieters erneut und stellt den Zugriff auf derselben Zeile wieder her — mit Name, Standard-Kennzeichen und allen Verweisen darauf. Ein Eintrag, den du selbst deaktiviert hast, wird auf diesem Weg nicht repariert; dort hilft **Aktivieren**, und Neuverbinden würde die falsche Frage beantworten.

## Connectoren und MCP-Server

Beide Oberflächen lassen einen Agent über Tale hinausgreifen, und der Unterschied liegt darin, wem die Brücke gehört. Ein Connector ist anbieterspezifisch, kommt mit der Plattform und wird für dich gepflegt; deine Seite davon sind die Zugangsdaten. Ein MCP-Server ist ein Prozess, den du selbst betreibst und unter **Einstellungen > API > MCP** registrierst, mit genau den Tools, die du schreibst. Greif zum Connector, wenn es einen für das Zielsystem gibt, und zu [MCP-Servern](/de/platform/connectors/mcp-servers), wenn nicht.

## Wo das hingehört

Zugangsdaten zu verwalten ist inzwischen die gesamte Connector-Administration, weil nichts mehr installiert wird: Konten anlegen, gut benennen, pro Connector einen Standard halten und die OAuth-Einträge neu verbinden, die auslaufen. [Connectors](/de/platform/connectors/overview) ist der Katalog, an dem diese Einträge hängen, [Agent-Tools](/de/platform/agents/tools) zeigt, wie die daraus entstehenden Aktionen im Werkzeugkasten eines Agents ankommen, und [Genehmigungen konfigurieren](/de/platform/approvals/configure) ist der Ort, an dem schreibende Aktionen auf eine Freigabe warten.
</content>
</invoke>
