---
title: Organisationseinstellungen
description: Benenne die Organisation um, wähle die Sprache, auf die ihre Agenten zurückgreifen, kopiere die Organisations-ID und lösche die Organisation.
---

Unter **Einstellungen > Organisation** siehst du die Organisation, die du gerade geöffnet hast: unter **Organisationsdetails** ihren Namen, die Standardsprache ihrer Agenten und ihre ID. Inhaber sehen außerdem die **Gefahrenzone**, über die sie die Organisation löschen können. Inhaber und Admins können die Seite öffnen. Mitglieder mit anderen Rollen sehen **Organisation** nicht im Einstellungsmenü; folgen sie einem Link auf die Seite, erscheint **Du benötigst Admin-Berechtigungen, um auf die Organisationseinstellungen zuzugreifen.**

## Die Organisation umbenennen {#rename-the-organization}

Ändere den Namen im Feld **Organisationsname** und wähle dann im Kopfbereich der Einstellungen **Speichern**. Name und **Standardsprache (für Agenten)** werden gemeinsam gespeichert; **Verwerfen** setzt beide auf die gespeicherten Werte zurück. Scheitert das Speichern, erscheint **Organisation konnte nicht aktualisiert werden**.

Der Name darf nicht leer sein: Tale entfernt Leerzeichen am Anfang und am Ende und lehnt einen leeren Namen ab; unter dem Feld erscheint dann **Organisationsname ist erforderlich**. Anders als beim Namen einer neuen Organisation sind alle Zeichen erlaubt, nicht nur Buchstaben, Ziffern, Leerzeichen, Bindestriche und Unterstriche.

Der neue Name erscheint überall, wo Tale die Organisation nennt, etwa in der Organisationsauswahl deines Profilmenüs und am Ende des Titels im Browser-Tab. Den Slug der Organisation, der beim Erstellen festgelegt wurde, ändert eine Umbenennung nicht. WebDAV-Adressen und Skripte, die den Slug in `X-Organization-Slug` senden, funktionieren deshalb weiter.

## Die Standardsprache der Agenten wählen {#default-language}

Wähle unter **Standardsprache (für Agenten)** eine der Sprachen **English**, **Deutsch** oder **Français** und dann **Speichern**. Eine in der App erstellte Organisation erhält zunächst die Oberflächensprache der Person, die sie erstellt hat, oder Englisch, wenn diese Sprache keine der drei ist.

Tale verwendet diese Sprache an folgenden Stellen:

- Projektagenten und die Agentenschritte von Automatisierungen sind angewiesen, bei einer Aufgabe die Sprache von deren Titel und Beschreibung beizubehalten. Lässt sich daraus keine Sprache eindeutig ablesen oder hat ein Lauf keine Aufgabe, sollen sie die Standardsprache verwenden. [Eine Aufgabe an einen Agenten delegieren](/de/platform/projects/task-automation#die-aufgabe-vorbereiten-und-starten) erklärt die Regel.
- Richtet Tale den [Standard-Agenten](/de/platform/projects/project-agents#standard-agent) in einem Projekt ein, erhält er seinen Namen in dieser Sprache, bei Französisch zum Beispiel **Agent standard**. Änderst du die Standardsprache später, behält er seinen Namen.
- Benachrichtigungs-E-Mails schreibt Tale in dieser Sprache, unabhängig davon, welche Sprache die empfangende Person in Tale nutzt. Auch eine Nachricht, die eine Automatisierung an Mitglieder schickt ([`notify.member`](/de/platform/automations/notify-members)), nennt die Automatisierung in dieser Sprache, sofern sie einen Namen in ihr hat.
- Der Benachrichtigungsexport der API verwendet sie, wenn eine Anfrage keinen `locale`-Parameter angibt ([Empfänger und Datenstrom wählen](/de/develop/api-reference#empfaenger-und-datenstrom-waehlen)).

An der Oberflächensprache ändert die Einstellung nichts; die wählt jede Person selbst im Profilmenü ([Sprache oder Arbeitsbereich wechseln](/de/platform/member/preferences#sprache-oder-arbeitsbereich-wechseln)). Auch der Chat-Assistent richtet sich nicht nach dieser Einstellung.

## Die Organisations-ID kopieren {#organization-id}

Das Feld **Organisations-ID** zeigt die Kennung, die Tale der Organisation beim Erstellen gegeben hat; eine Umbenennung ändert sie nicht. Wähle das Feld aus, um die ID zu kopieren. Ein Häkchen bestätigt das Kopieren.

Verwende die ID überall, wo Tale nach der Organisations-ID oder `orgId` fragt:

- bei Aufrufen von `/api/app` mit einer angemeldeten Sitzung, etwa wenn du eine Anwendung registrierst, bei der man sich [mit Tale anmeldet](/de/develop/api-reference#mit-tale-bei-einer-anwendung-anmelden);
- als `--org`, wenn die `tale`-CLI [die Plattform konfiguriert](/de/self-hosted/install/cli-install#plattform-konfigurieren).

Dieselbe ID steht in der Adresse jeder Seite der Organisation hinter `/dashboard/`, und `GET /api/v1/me` gibt sie als `organization.id` zurück. Die REST-API erkennt die Organisation dagegen an ihrem Slug: Sende in `X-Organization-Slug` den Slug, nie die ID. Wie ein Skript den Slug findet, steht unter [Konto und Organisation bestimmen](/de/get-started/developers#konto-und-organisation-bestimmen); du kannst ihn auch unter **Einstellungen > API > MCP** aus dem Feld **Organisations-Slug** kopieren.

## Die Organisation löschen {#delete-the-organization}

<Warning>

Wenn du die Organisation löschst, wird ihr gesamter Inhalt für alle Mitglieder gelöscht. Das lässt sich nicht rückgängig machen.

</Warning>

Nur Inhaber sehen die **Gefahrenzone** und können die Organisation löschen; als Admin bittest du einen Inhaber darum. Eine Organisation mit dem Slug `default` hat keine **Gefahrenzone**: Unter diesem Slug speichert das Deployment seine plattformweiten Standardwerte, deshalb löscht Tale diese Organisation nie.

1. Prüfe im Feld **Organisationsname**, ob du die richtige Organisation geöffnet hast: Die Seite gilt immer für die Organisation, in der du gerade bist.
2. Wähle unter **Gefahrenzone** die Schaltfläche **Organisation löschen**.
3. Lies den Dialog. Er nennt die Organisation und sagt, was das Löschen entfernt.
4. Gib den Namen, den der Dialog zeigt, in das Feld **Tippe den Namen der Organisation zur Bestätigung** ein. Groß- und Kleinschreibung zählen, Leerzeichen am Anfang und am Ende nicht. **Organisation löschen** im Dialog bleibt deaktiviert, bis der Name übereinstimmt.
5. Wähle **Organisation löschen**. Während Tale löscht, dreht sich auf der Schaltfläche ein Ladesymbol, und der Dialog lässt sich nicht schließen.

Tale bestätigt mit **Organisation gelöscht** und bringt dich in eine andere Organisation, der du angehörst. War es deine einzige, landest du auf der Seite, auf der du eine Organisation erstellst. Beschränkt das Deployment, wer Organisationen erstellen darf, steht dort **Du kannst in dieser Bereitstellung keine Organisation erstellen. Wende dich an den Betreiber, um einen Arbeitsbereich anzufordern.**

### Was beim Löschen entfernt wird {#what-deletion-removes}

Mit der Organisation verschwinden ihre Teams, offenen Einladungen, Projekte, Aufgaben, Dokumente, Konversationen, Agenten, Automatisierungen samt ihren Läufen, KI-Anbieter, Connectors samt Zugangsdaten, verbundene Coding-Agents, die Anwendungen, bei denen man sich mit Tale anmeldet, sowie alle [Sandboxes der Organisation samt Dateien](/de/platform/admin/sandboxes#explain-why-a-workspace-disappeared). Auch die API-Schlüssel, die hier für ein Mitglied, ein Team, ein Projekt oder die Organisation erstellt wurden, werden gelöscht; Schlüssel, die Mitglieder für sich selbst erstellt haben, bleiben ihnen. Die Mitglieder behalten ihre Tale-Konten und ihre anderen Organisationen; nur ihre Mitgliedschaft in dieser endet.

Hochgeladene Dateien, den Wissensindex und die Konfiguration der Organisation entfernt Tale erst in einer anschließenden Bereinigung. Sie leert den Dateispeicher und die Wissensdatenbank, die die Organisation zu diesem Zeitpunkt nutzt. Hatte die Organisation unter **Einstellungen > Datenresidenz** einen eigenen Bucket oder eine eigene Wissensdatenbank verbunden, bleiben Dateien, die nie dorthin verschoben wurden, und Wissen, das vor dem Wechsel indexiert wurde, im bisherigen Speicher ([Datenspeicher wählen und umziehen](/de/self-hosted/configuration/data-residency)).

Bis die Bereinigung abgeschlossen ist, kann eine neue Organisation den Namen, mit dem die gelöschte erstellt wurde, nicht übernehmen, auch nicht in anderer Groß- und Kleinschreibung: Tale lehnt sie ab und meldet **Dieser Name ist schon vergeben. Wähle einen anderen.** Versuch es später erneut.

Erhalten bleibt das Audit-Log, samt einem Eintrag, der das Löschen festhält. In der App kann es aber niemand mehr öffnen, sobald die Organisation gelöscht ist.

### Wenn Tale das Löschen ablehnt {#when-deletion-is-refused}

Lehnt Tale das Löschen ab, ändert sich nichts. Die Organisation bleibt, wie sie war, der Dialog bleibt offen, und **Organisation konnte nicht gelöscht werden** nennt den Grund:

| Grund | Was du tun kannst |
| --- | --- |
| **Ein aktiver Legal Hold bewahrt die Daten dieser Organisation. Gib alle Holds unter Richtlinien > Legal Hold frei und versuch es dann erneut.** | Ein Legal Hold auf der gesamten Organisation oder auf einem ihrer Mitglieder verhindert das Löschen. Gib jeden unter **Einstellungen > Richtlinien > Legal Hold** frei; eine Freigabe braucht die Zustimmung eines zweiten Admins und eine Wartezeit. Versuch es erneut, sobald **Aktive Holds** leer ist und **Keine aktiven Legal Holds** anzeigt. [Blockierte Löschungen verstehen](/de/platform/admin/governance/legal-hold#blockierte-loeschungen-verstehen) erklärt die Regel. |
| **Automationsläufe bleiben gesperrt, weil ihre früheren externen Aktionen noch nicht überprüft wurden. Deine Organisation wurde nicht gelöscht. Eine Stopp-Anfrage hebt diese Sperren nicht auf.** | Einige Automatisierungsläufe wurden [nach einem Upgrade zurückgehalten](/de/platform/automations/execution-logs#ein-nach-dem-upgrade-zurueckgehaltener-lauf). Diese Sperren lassen sich derzeit nicht aufheben; solange eine besteht, lässt sich die Organisation nicht löschen. |
| **Die Bestätigung stimmt nicht mit dem Namen der Organisation überein. Lade die Seite neu und versuch es erneut.** | Der Name der Organisation hat sich geändert, nachdem die Seite geladen wurde: Jemand hat sie in einem anderen Fenster umbenannt, oder du hast auf dieser Seite einen neuen Namen gespeichert. Lade die Seite neu und gib den Namen ein, den der Dialog zeigt. |
