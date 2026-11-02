---
title: Connector-Zugangsdaten
description: Verbinde Dienstkonten, wähle Standards und erneuere ihre Zugriffsberechtigung.
---

Hinterlege Connector-Zugangsdaten, damit Tale Dienste wie Postfächer, Dateiablagen oder Aufgabenverwaltung verwenden kann. Inhaber, Admins und Entwickler verwalten sie unter **Einstellungen > Connectors**. Wähle den benötigten Dienst und das passende Konto. Der [Connector-Katalog](/de/platform/connectors/overview) erklärt die verfügbaren Aktionen.

## Ein Konto verbinden

1. Wähle **Zugangsdaten hinzufügen** und den Connector. Bereits konfigurierte Connectors stehen zuerst und können weitere Zugangsdaten erhalten.
2. Prüfe das Feld **Name**. Es enthält bereits den Namen des Connectors. Heißen andere Zugangsdaten dieses Connectors schon so, hängt Tale eine Zahl an: `GitHub`, dann `GitHub 2`. Ein Name wie `Support-Postfach` oder `EU-Shop` ist beim Erstellen von Automatisierungen leichter zu erkennen. Eine OAuth-Verbindung hat kein Namensfeld. Tale benennt sie nach derselben Regel, sobald du den Zugriff erteilt hast (die Zugangsdaten eines zweiten Slack-Workspace tragen seinen Namen), und mit **Zugangsdaten bearbeiten** kannst du sie umbenennen.
3. Fülle die angebotene Authentifizierungsmethode aus. Bei OAuth wählst du **Verbinden** und erteilst den Zugriff beim Anbieter. Jedes **Verbinden** legt neue Zugangsdaten für das freigegebene Konto an und ersetzt nie bestehende. Melde dich beim Anbieter deshalb mit dem Konto an, das du hinzufügen willst.
4. Schließe das Formular ab und prüfe den neuen Eintrag mit Connector, Konto oder Instanz und Status.

Slack verbindet pro Slack-Workspace genau einen Satz Zugangsdaten. Gibst du einen bereits verbundenen Slack-Workspace erneut frei, erneuert Tale dessen Zugangsdaten, statt weitere anzulegen.

Starte jede Verbindung mit **Verbinden** in Tale. Einen Verbindungslink, der von einer anderen Website aus geöffnet wird, lehnt Tale ab. So kann ein Link, den dir jemand schickt, kein Konto und kein Postfach in deinem Namen verbinden.

Der Connector bestimmt die Felder. Verwende die tatsächlichen Zugangsdaten des Dienstkontos, keinen Tale-API-Schlüssel.

| Methode | Benötigte Angaben |
| --- | --- |
| API-Schlüssel | Der vom Dienst ausgegebene Schlüssel, etwa für Tavily oder Shopify. Jev decisions braucht einen OpenRouter-API-Schlüssel. |
| Token | Ein Dienst-Token, etwa ein persönlicher GitHub-Zugangstoken, ein Forgejo-Zugangstoken mit `read:repository` und `read:issue` (`write:issue`, um Issues zu ändern), ein Discord-Bot-Token oder ein GlitchTip-API-Token mit `project:read` und `event:read`. Ein GitHub-Token, das Sicherheitswarnungen synchronisiert, braucht zusätzlich Lesezugriff auf die Code-Scanning-, Dependabot- und Secret-Scanning-Warnungen des Repositorys. |
| Benutzername und Passwort | Das vom Dienst erwartete Paar, etwa Anmeldung und App-Passwort oder eine anbieterspezifische ID mit Token. |
| OAuth | Die Freigabe im Browser beim Anbieter. Tale speichert die zurückgegebene Berechtigung. |
| App-Anmeldung | Die eigene App-Registrierung deiner Organisation beim Anbieter: ihre Verzeichnis-ID (Tenant), Anwendungs-ID (Client) und ihr Client-Secret. Die App meldet sich selbst an, ohne eine Person; ihr Zugriffstoken holt und erneuert Tale. Outlook nutzt sie für ein [freigegebenes Postfach](#ein-freigegebenes-outlook-postfach-verbinden). |
| GitHub App | Ein Name für die Zugangsdaten und einer für die App, optional die GitHub-Organisation, der die App gehört. Tale registriert die eigene GitHub App deiner Organisation und bewahrt ihren privaten Schlüssel auf; was Tale auf GitHub anlegt, erscheint dann als Bot der App. Siehe [GitHub mit einer GitHub App verbinden](#github-mit-einer-github-app-verbinden). |

Manche Connectors benötigen zusätzlich die Adresse der Instanz. Für Confluence ist das die Basisadresse der Atlassian-Site. Für Forgejo ist das der Ursprung der Instanz ohne Pfad, etwa `https://codeberg.org`, für GlitchTip der Ursprung der Instanz, etwa `https://app.glitchtip.com`; eine selbst gehostete Forgejo- oder GlitchTip-Instanz muss zusätzlich durch die Host-Richtlinie des Connectors erlaubt sein. Für Shopify verwendest du die `myshopify.com`-Adresse des Shops, nicht die öffentliche Shop-Domain.

## Einen Standard wählen

Die Tabelle zeigt eine Zeile je Zugangsdaten-Eintrag und aktualisiert sich ohne Neuladen, solange sie geöffnet ist: Was andere Admins hinzufügen, ändern oder löschen, siehst du sofort. **Standard** kennzeichnet den Eintrag für Aktionen ohne ausdrückliche Auswahl. Mit **Zum Standard machen** im Zeilenmenü änderst du ihn. Pro Connector ist ein Standard möglich.

Ein Connector mit mehreren Einträgen, aber ohne Standard funktioniert weiterhin für Aufrufer, die Zugangsdaten benennen. Ohne einen solchen Namen braucht der Aufruf einen Standard. Benenne Konten eindeutig, bevor du sie in Automatisierungen verwendest, damit später erkennbar bleibt, welches Konto gemeint ist.

Postfachsynchronisation und Eingangssichtung können alle aktiven Zugangsdaten eines Postfach-Connectors prüfen; eine E-Mail-Synchronisierung, die auf ein Postfach eingestellt ist, liest nur dieses. Ein zweites Postfach muss dafür nicht zuerst Standard werden. Beim Verfassen einer neuen E-Mail listet das Feld **Postfach** jedes Postfach mit seinem Namen auf; die E-Mail wird über das gewählte Postfach versendet. Auch Antworten in dieser Konversation werden über dieses Postfach versendet, ebenso ein erneuter Versuch nach einem fehlgeschlagenen Versand.

Auch Benachrichtigungs-E-Mails an Mitglieder, die [**Handlungsrelevante Alerts per E-Mail**](/de/platform/member/preferences#notification-email) eingeschaltet lassen, werden über ein verbundenes Postfach versendet. Tale nimmt zuerst aktive Zugangsdaten für das IMAP-/SMTP-Postfach, dann für Gmail, dann für Microsoft Outlook, und innerhalb eines Connectors jeweils den Standard. Über IMAP/SMTP kommen die E-Mails von `notification@` unter der Domain des Postfachs: Ein Postfach, das sich als `support@example.com` anmeldet, versendet sie als `notification@example.com`. Ohne aktive Zugangsdaten für ein Postfach erhalten Mitglieder ihre Benachrichtigungen nur in Tale. Ein fehlgeschlagener Versand wird nicht wiederholt; die Benachrichtigung in Tale bleibt.

## Ein Geheimnis rotieren oder Zugriff pausieren

Nutze die Ersetzen-Aktion der jeweiligen Methode, etwa **API-Schlüssel ersetzen** oder **Token ersetzen**. Der neue Wert ersetzt das gespeicherte Geheimnis. Name, Standardauswahl und Verweise bleiben erhalten. Prüfe anschließend eine passende Dienstaktion.

**Deaktivieren** pausiert den Eintrag und behält seine Konfiguration; **Aktivieren** stellt den Zugriff wieder her. Über **Zugangsdaten bearbeiten** änderst du andere unterstützte Angaben wie Namen oder Instanzadresse.

<Warning>

Das Löschen von Zugangsdaten entzieht abhängigen Automatisierungen und Agenten den Zugriff. Stelle die Aufrufer vorher um. Löschst du den Standard eines Connectors, wird sein ältester verbleibender aktiver Eintrag zum Standard; die Bestätigung nennt diesen Eintrag, bevor du löschst. Ein deaktivierter Eintrag oder einer, der neu verbunden werden muss, übernimmt nie. Bleibt kein aktiver Eintrag übrig, hat der Connector keinen Standard, bis du einen wählst. Ein gelöschter Eintrag lässt sich nicht durch erneutes Öffnen wiederherstellen.

</Warning>

## Eine OAuth-App vorbereiten

Unter **OAuth-Apps** am Seitenende konfigurieren Inhaber und Admins die Anbieter-Apps, über die Mitglieder den Zugriff freigeben. Eine organisationsspezifische App hat Vorrang vor der Bereitstellungs-App. Fehlen beide, kann der Connector keine Anmeldung starten. Die Seite zeigt den fehlenden Einrichtungsstand an. Kann Tale nicht prüfen, ob eine App für den Wissens-Import eingerichtet ist, zeigt ihre Zeile **Status nicht verfügbar** ohne **Einrichten**, und **Erneut versuchen** startet die Prüfung neu. Du kannst die App einrichten, sobald die Prüfung klappt.

Wähle **Einrichten**, gib Client-ID und Geheimnis des Anbieters ein und registriere dort exakt die im Dialog gezeigten Weiterleitungsadressen. Microsoft-Apps benötigen gegebenenfalls auch die Verzeichnis- oder Mandanten-ID. Bei späteren Änderungen lässt du ein gespeichertes Geheimnis leer, um es beizubehalten.

Die Google-Drive-App unterstützt auch den Wissensdatenbank-Import. Der OneDrive-/SharePoint-Eintrag dient diesem Import und keinem eigenen Connector. Die Slack-App richtet der Bereitstellungsbetreiber ein. Lies den jeweiligen [Connector-Leitfaden](/de/platform/connectors/overview), bevor du Anbieterrechte vergibst.

Bei OneDrive/SharePoint kann **Entra-ID-App aus SSO übernehmen** eine bestehende SSO-Registrierung in die Importkonfiguration kopieren. Das ist eine einmalige Kopie. Kopiere nach einer Rotation des SSO-Geheimnisses erneut und prüfe Weiterleitungsadresse sowie delegierte Rechte in der Bestätigung.

## Ein freigegebenes Outlook-Postfach verbinden

Ein freigegebenes Postfach wie `promotion@example.com` hat keine eigene Anmeldung. Tale erreicht es auf einem von zwei Wegen: Die eigene Microsoft-App deiner Organisation meldet sich selbst an und darf nur in dieses eine Postfach, oder eine Person mit Vollzugriff auf das Postfach verbindet ihr eigenes Konto. In beiden Fällen nennt das Feld **Postfach** der Zugangsdaten die freigegebene Adresse. Alle Outlook-Aktionen, die Postfach-Synchronisierung und der Posteingang arbeiten dann in diesem Postfach und verwenden seine Adresse als Absender. **Postfach** nimmt nur eine E-Mail-Adresse an. Eine ID, etwa die Objekt-ID des Postfachs, lehnt Tale ab. Das Postfach gibst du beim Hinzufügen der Zugangsdaten an, danach lässt es sich nicht mehr ändern: Was die Zugangsdaten gelesen und gesendet haben, gehört zu diesem Postfach. Für ein anderes Postfach fügst du weitere Zugangsdaten hinzu.

Für ein Team-Postfach eignet sich die App-Anmeldung besser: Sie hängt nicht am Konto einer einzelnen Person, und Exchange beschränkt die App auf die Postfächer, die du festlegst.

1. Registriere in Microsoft Entra ID für diesen Zweck eine Single-Tenant-App und lege ein Client-Secret an. Notiere auf ihrer Übersichtsseite die **Verzeichnis-ID (Mandant)** und die **Anwendungs-ID (Client)**. Erteile ihr in Entra ID keine Microsoft-Graph-Berechtigungen für E-Mail: Diese würden für jedes Postfach deiner Organisation gelten.
2. Beschränke die App in Exchange Online PowerShell als Exchange-Administrator mit RBAC for Applications auf das Postfach. Nimm die IDs aus dem Eintrag der App unter **Unternehmensanwendungen**, nicht aus **App-Registrierungen**:

   ```powershell
   New-ServicePrincipal -AppId <application-id> -ObjectId <enterprise-app-object-id> -DisplayName "Tale promotion mailbox"
   New-ManagementScope -Name "Tale promotion mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'promotion@example.com'"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.ReadWrite" -CustomResourceScope "Tale promotion mailbox"
   New-ManagementRoleAssignment -App <application-id> -Role "Application Mail.Send" -CustomResourceScope "Tale promotion mailbox"
   Test-ServicePrincipalAuthorization -Identity <application-id> -Resource promotion@example.com
   ```

   Mit `Application Mail.ReadWrite` liest Tale das Postfach und schreibt Antwortentwürfe, mit `Application Mail.Send` sendet es. Nutzen Automatisierungen den Kalender oder die Kontakte des Postfachs, weise auf dieselbe Weise `Application Calendars.ReadWrite` oder `Application Contacts.Read` zu. Bis Exchange eine neue Zuweisung anwendet, können bis zu zwei Stunden vergehen.
3. Wähle in Tale **Zugangsdaten hinzufügen** und dann **Microsoft Outlook**. Gib im Formular die Verzeichnis-ID (Tenant), die Anwendungs-ID (Client), das Client-Secret und unter **Postfach** die freigegebene Adresse ein und füge die Zugangsdaten hinzu. Ihre Zeile zeigt **App-Anmeldung** und anhand von Anwendungs-ID und Verzeichnis, welche App sie verwendet. Vom Client-Secret zeigt sie nur die ersten und letzten Zeichen.
4. Sende eine Testnachricht an die freigegebene Adresse und prüfe, ob sie im Posteingang erscheint. Damit die Konversationen beim zuständigen Team landen, lege für das Postfach eine Regel im [Konversations-Routing](/de/platform/admin/governance/policies-and-limits#konversations-routing) an.

Läuft das Client-Secret ab, ersetze es im Menü der Zeile mit **App-Zugangsdaten ersetzen**. Verzeichnis-ID und Anwendungs-ID sind im Formular schon eingetragen, du gibst nur das neue Client-Secret ein. Name, Postfach und Verweise der Zugangsdaten bleiben erhalten.

Betreut stattdessen eine Person das Postfach, wähle **Zugangsdaten hinzufügen** und dann **Microsoft Outlook**. Trage im Feld über dem Formular unter **Postfach** die freigegebene Adresse ein, wähle **Verbinden** und melde dich als diese Person an. Weil ein Postfach angegeben ist, fragt die Freigabe auch nach Zugriff auf die Postfächer, die dieses Konto öffnen kann, und die neuen Zugangsdaten arbeiten ab der ersten Synchronisierung im freigegebenen Postfach. Die Person braucht Vollzugriff auf das Postfach und zum Senden die Berechtigung „Senden als“. Lässt du **Postfach** leer, verbindest du das eigene Postfach der Person.

## GitHub mit einer GitHub App verbinden

Mit einem persönlichen Zugangstoken erscheint alles, was Tale auf GitHub anlegt, unter dem Konto der Person, der das Token gehört. Eine GitHub App gibt Tale eine eigene Identität: Deine Organisation registriert aus Tale heraus ihre eigene App und installiert sie auf den Repositorys, in denen Tale arbeiten soll. Die GitHub-Aktionen von Tale für Issues, Pull Requests, Reviews, Kommentare, Merges und Importe authentifizieren sich dann mit Installationstokens, die Tale bei Bedarf erzeugt. Jedes gilt eine Stunde und trägt nur die unten aufgeführten Berechtigungen. Was Tale anlegt, erscheint als Bot der App, `<app-slug>[bot]`, mit Namen und Logo der App statt unter dem Konto einer Person.

Die App ist optional, und Token-Zugangsdaten funktionieren unverändert weiter. Nur Inhaber und Admins registrieren, installieren oder ändern sie.

<Note>

Agentenläufe erhalten das Token der App noch nicht. `git` und `gh` in der Sandbox eines Laufs verwenden weiterhin Token-Zugangsdaten. Commits, die ein Agent aus seiner Sandbox pusht, erscheinen deshalb unter dem Konto dieses Tokens, nicht als Bot der App. Issue [#5295](https://github.com/tale-project/tale/issues/5295) verfolgt, dass Läufe pro Zug ein eigenes Installationstoken und die Bot-Identität der App erhalten.

</Note>

### Die App registrieren

1. Wähle **Zugangsdaten hinzufügen** und dann **GitHub**. Über dem Token-Formular registriert ein eigener Bereich die App und listet die Berechtigungen auf, die sie bei GitHub anfragt. Wer weder Inhaber noch Admin ist, sieht dort nur den Hinweis, einen Admin zu fragen.
2. Prüfe **Name der Zugangsdaten** und **App-Name auf GitHub**. Der Name der Zugangsdaten enthält zunächst den Namen des Connectors und wird wie jeder andere nummeriert: `GitHub`, dann `GitHub 2`. Als App-Name ist Tale mit dem Namen deiner Organisation vorgegeben. Er hat höchstens 34 Zeichen und muss auf GitHub eindeutig sein; der Name des Bots leitet sich von ihm ab.
3. Gib unter **GitHub-Organisation** den Login der GitHub-Organisation ein, deren Repositorys Tale erreichen soll. Du musst Inhaber dieser Organisation sein. Lässt du das Feld leer, registrierst du die App stattdessen auf deinem persönlichen GitHub-Konto. Die App ist privat, und GitHub installiert eine private App nur auf dem Konto, dem sie gehört. Registriere sie deshalb auf dem Konto, zu dem die Repositorys gehören.
4. Wähle **Auf GitHub registrieren**. GitHub zeigt die App, die es anlegen wird, und die Berechtigungen, die sie anfragt; ist der Name schon vergeben, kannst du ihn dort ändern. Wähle **Create GitHub App**. GitHub öffnet dann die Installationsseite der App, die der nächste Abschnitt beschreibt.

Schließe die Schritte auf GitHub innerhalb von 15 Minuten ab. Tale schließt eine Registrierung nur einmal ab, und nur für den Admin, der sie begonnen hat; nach 15 Minuten registrierst du erneut.

Die App hat keinen Webhook und fordert bei der Installation keine OAuth-Autorisierung an. GitHub erzeugt mit ihr einen privaten Schlüssel, den Tale verschlüsselt speichert und nie anzeigt: Der Schlüssel erscheint weder in einem Log noch in einer API-Antwort noch in einer Agenten-Sandbox. Das Client-Secret und das Webhook-Secret, die GitHub ebenfalls ausgibt, behält Tale nicht.

Eine gemeinsame Tale-App gibt es nicht: Jede Organisation registriert ihre eigene, auf jeder Bereitstellung. GitHub schickt deinen Browser an die öffentliche Adresse von Tale zurück. Öffne Tale deshalb unter dieser Adresse, wenn du die App registrierst und installierst. GitHub selbst ruft Tale nie auf. Der [Entwicklerleitfaden für Connectors](/de/develop/connectors#eine-github-app-registrieren) nennt die Adressen, an die GitHub zurückkehrt.

### Die App auf ausgewählten Repositorys installieren

Wähle auf der Installationsseite von GitHub das Konto und **Only select repositories**, wähle die Repositorys, in denen Tale arbeiten soll, und dann **Install**. GitHub bringt dich zurück zu Tale. Dort verlinkt die Zeile der Zugangsdaten die App auf GitHub und zeigt **Installiert auf** mit dem Konto. Wähle in dieser Zeile **Repositorys anzeigen**, um **Repositorys, die diese App erreicht** zu öffnen: Dort stehen die Repositorys, private mit **Privat** gekennzeichnet. Wie jede GitHub App kann sie außerdem öffentliche Repositorys lesen.

Solange die App nicht installiert ist, zeigt die Zeile das Badge **Nicht installiert** und den Text **Auf GitHub registriert, noch nicht installiert.**, und die GitHub-Aktionen von Tale können die Zugangsdaten nicht verwenden. Hast du GitHub vor der Installation verlassen oder länger als 15 Minuten gebraucht, wähle im Menü der Zeile **Auf GitHub installieren**, um fortzufahren. Bittet GitHub stattdessen einen Inhaber der Organisation, die Installation zu genehmigen, wähle nach der Genehmigung erneut **Auf GitHub installieren**. Tale findet die Installation dann auf GitHub und übernimmt sie, ohne dich dorthin zu schicken. Genauso verfährt Tale, wenn jemand die App direkt auf GitHub installiert hat, etwa ein Inhaber.

Wird die App auf GitHub deinstalliert, bemerkt Tale das, sobald es die App das nächste Mal verwendet. Die Zeile zeigt dann das Badge **Nicht mehr installiert** und den Text **Nicht mehr auf … installiert.** mit dem Konto, und die GitHub-Aktionen von Tale können die Zugangsdaten erst wieder verwenden, wenn du **Auf GitHub installieren** wählst und die App erneut installierst.

Wählst du **All repositories**, erreicht die App jedes Repository des Kontos, auch später hinzugefügte, und **Repositorys, die diese App erreicht** warnt davor. Um den Zugriff einzugrenzen, wähle in der Warnung **Auf GitHub öffnen** und dann **Only select repositories**.

Hat der Connector schon einen Standard, wähle im Menü der Zugangsdaten der App **Zum Standard machen**, damit Aktionen ohne ausdrückliche Auswahl die App verwenden.

### Das Logo hochladen

GitHub kann bei der Registrierung kein Logo übernehmen, deshalb zeigt eine neue App ein erzeugtes Muster. Damit neben allem, was die App anlegt, das Logo von Tale erscheint, lade es auf GitHub hoch:

1. Lade das Logo von Tale unter deiner Tale-Adresse bei `/assets/pwa-512x512.png` herunter, oder nimm `services/platform/public/assets/pwa-512x512.png` aus dem Quellcode von Tale.
2. Wähle auf GitHub dein Profilbild und dann **Settings**. Gehört die App einer Organisation, wähle stattdessen **Your organizations** und die **Settings** der Organisation. Wähle dann **Developer settings**, **GitHub Apps** und neben der App **Edit**.
3. Wähle unter „Display information“ **Upload a logo** und die Datei. Schneide sie bei Bedarf zu und wähle **Set new avatar**.

GitHub nimmt PNG, JPG oder GIF unter 1 MB an und empfiehlt 200 × 200 Pixel. Das Logo von Tale ist ein PNG mit 512 × 512 Pixeln und etwa 3 KB.

### Die Berechtigungen der App

Die App fragt nur Repository-Berechtigungen an, jeweils für das, was die GitHub-Aktionen von Tale tun:

| Berechtigung | Stufe | Wofür |
| --- | --- | --- |
| Metadata | Nur lesen | Von GitHub vorgeschrieben; Repositorys auflisten und lesen |
| Contents | Lesen und schreiben | Pull Requests mergen, Commits lesen, Code durchsuchen |
| Issues | Lesen und schreiben | Issues anlegen, ändern, mit Labels versehen und kommentieren; sie lesen und importieren |
| Pull requests | Lesen und schreiben | Pull Requests anlegen, reviewen und kommentieren; sie mit ihren Dateien und Diffs lesen |
| Code scanning alerts (`security_events`) | Nur lesen | Sicherheitswarnungen importieren |
| Dependabot alerts (`vulnerability_alerts`) | Nur lesen | Sicherheitswarnungen importieren |
| Secret scanning alerts (`secret_scanning_alerts`) | Nur lesen | Sicherheitswarnungen importieren |

Berechtigungen für Administration oder Workflows fragt sie nicht an, ebenso wenig Organisations- oder Kontoberechtigungen.

<Warning>

Ohne die Workflows-Berechtigung kann die App keine Dateien unter `.github/workflows/` ändern, und GitHub lehnt es ab, über die App einen Pull Request zu mergen, der eine solche Datei ändert. Erteilst du sie ihr auf GitHub, kann alles, was ein Token der App besitzt, deine CI ändern. Füge sie deshalb nur bewusst hinzu.

</Warning>

### Die Repositorys ändern

Wähle im Menü der Zugangsdaten oder unten in **Repositorys, die diese App erreicht** die Option **Repositorys ändern**, um die Installationseinstellungen der App auf GitHub zu öffnen. Füge unter „Repository access“ Repositorys hinzu oder entferne sie und wähle **Save**. GitHub bringt dich zurück zu Tale, und **Repositorys, die diese App erreicht** listet die Repositorys auf, die die App jetzt erreicht.

Du kannst die Installationseinstellungen auch direkt auf GitHub öffnen. Für eine Organisation öffnest du ihre **Settings**, wählst unter „Third-party Access“ **GitHub Apps** und neben der App **Configure**. Für dein persönliches Konto öffnest du **Settings**, dann **Applications**, **Installed GitHub Apps** und **Configure**. Auch nach einer Änderung dort bringt GitHub dich zurück zu Tale. Ist dieser Browser bei Tale als Inhaber oder Admin deiner Organisation angemeldet, hält Tale einen Wechsel zwischen allen und gewählten Repositorys fest, aber keine Änderung, die nur betrifft, welche Repositorys gewählt sind.

### Trennen oder zum Token zurückkehren

Zum Trennen wählst du im Menü der Zugangsdaten **Löschen**; das Audit-Log hält das Löschen fest. Die App auf GitHub lässt Tale bestehen, entferne sie deshalb auch dort: **Uninstall** in ihren Installationseinstellungen entfernt sie vom Konto, und **Delete GitHub App** unter **Advanced** in den Einstellungen der App löscht sie samt aller Installationen.

Zugangsdaten einer GitHub App haben keine Ersetzen-Aktion und kein **Neu verbinden**. Um neu anzufangen, etwa mit einem neuen privaten Schlüssel, lösche die Zugangsdaten und die App und registriere eine neue.

Um zu einem Token zurückzukehren, füge GitHub-Zugangsdaten mit der Methode **Token** hinzu und wähle in ihrem Menü **Zum Standard machen**.

### Was das Audit-Log festhält

Das [Audit-Log](/de/platform/admin/governance/audit-logs) hält fest, wer die App wann verbunden, geändert und getrennt hat, jeweils mit der App-ID. Der Eintrag jeder Installation und jeder Änderung, die Tale festhält, wenn GitHub dich zu Tale zurückbringt, enthält zusätzlich Installations-ID, Konto und Repository-Auswahl und listet die gewählten Repositorys auf, wenn die App nur einige erreicht. Eine Änderung, die Tale erst beim nächsten Erzeugen eines Tokens bemerkt, etwa ein umbenanntes Konto oder ein auf GitHub vorgenommener Wechsel zwischen allen und gewählten Repositorys, hält es mit **System** als Akteur fest. Der Eintrag zum Trennen enthält ebenfalls Installations-ID und Repository-Auswahl. Tale hat keinen Webhook, deshalb kann dem Audit-Log eine Änderung entgehen, die nur betrifft, welche Repositorys gewählt sind; **Repositorys, die diese App erreicht** listet sie immer so auf, wie GitHub sie gerade hat. Das Server-Log hält jedes Token fest, das Tale erzeugt, auch die für **Repositorys, die diese App erreicht**, mit App, Installation, Repository-Auswahl und Ablauf, aber nie das Token selbst.

## Eine Verbindung reparieren

**Neu verbinden nötig** bedeutet, dass die gespeicherte OAuth-Berechtigung nicht mehr erneuert werden kann. Wähle im Menü dieser Zeile **Neu verbinden** und gib dasselbe Konto erneut frei. Tale erneuert genau diese Zugangsdaten: Name, Standard und Verweise bleiben erhalten, alle anderen Zugangsdaten bleiben unverändert. Bewusst deaktivierte Zugangsdaten aktiviert **Neu verbinden** nicht wieder; dafür gibt es **Aktivieren**.

Werden die Zugangsdaten entfernt, bevor die Freigabe abgeschlossen ist, oder erlaubt dir deine Rolle das Verwalten von Zugangsdaten nicht mehr, speichert Tale nichts und nennt den Grund. Gib den Slack-Workspace frei, den die Zugangsdaten bereits verbinden. Einen anderen Slack-Workspace lehnt Tale ab; verbinde ihn stattdessen über **Zugangsdaten hinzufügen**.

Kann die Verbindung nicht starten, prüfe die OAuth-App. Lehnt der Anbieter die Rückkehr zu Tale ab, vergleiche die registrierte Weiterleitungsadresse mit der exakt in Tale gezeigten Adresse. Scheitert nach der Verbindung eine Aktion, prüfe die Kontorechte und den benötigten Berechtigungsumfang.

Eine App-Anmeldung hat kein **Neu verbinden**. Lehnt der Anbieter die App ab, scheitert die Aktion oder die Postfach-Synchronisierung mit der Meldung, dass der Token-Endpunkt die Anmeldung der App abgelehnt hat, gefolgt vom Grund des Anbieters, etwa `invalid_client` bei einem falschen oder abgelaufenen Client-Secret. Prüfe dann Verzeichnis-ID, Anwendungs-ID und Client-Secret und ersetze sie. Ist der Token-Endpunkt nicht erreichbar oder ausgelastet, sagt die Meldung das stattdessen, und der nächste Versuch probiert es erneut. Verweigert Microsoft Graph den Zugriff auf ein freigegebenes Postfach, nennt der Fehler das Postfach und die Exchange-Rolle, die die Aktion braucht, zum Senden etwa `Application Mail.Send`.

Steht auf der Seite **Die Connectors konnten nicht geladen werden.** oder zeigt die Zugangsdaten-Tabelle statt ihrer Zeilen einen Fehler, konnte Tale sie nicht lesen; gelöscht wurde nichts. Wähle **Erneut versuchen**. Solange die Connectors nicht lesbar sind, zeigt **Zugangsdaten hinzufügen** denselben Hinweis statt des Katalogs.

Für Dienste ohne mitgelieferten Connector siehe [MCP und eigene Integrationen](/de/platform/connectors/mcp-servers). Beliebige ausgehende MCP-Server werden nicht auf dieser Zugangsdaten-Seite registriert.
