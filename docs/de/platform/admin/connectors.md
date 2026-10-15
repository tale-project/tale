---
title: Connector-Zugangsdaten
description: Verbinde Dienstkonten, wähle Standards und erneuere ihre Zugriffsberechtigung.
---

Hinterlege Connector-Zugangsdaten, damit Tale Dienste wie Postfächer, Dateiablagen oder Aufgabenverwaltung verwenden kann. Inhaber, Admins und Entwickler verwalten sie unter **Einstellungen > Connectors**. Wähle den benötigten Dienst und das passende Konto. Der [Connector-Katalog](/de/platform/connectors/overview) erklärt die verfügbaren Aktionen.

## Ein Konto verbinden

1. Wähle **Zugangsdaten hinzufügen** und den Connector. Bereits konfigurierte Connectors stehen zuerst und können weitere Zugangsdaten erhalten.
2. Prüfe das Feld **Name**. Es enthält bereits den Namen des Connectors. Heißen andere Zugangsdaten dieses Connectors schon so, hängt Tale eine Zahl an: `GitHub`, dann `GitHub 2`. Ein Name wie `Support-Postfach` oder `EU-Shop` ist beim Erstellen von Automatisierungen leichter zu erkennen. Eine OAuth-Verbindung hat kein Namensfeld. Tale benennt sie nach derselben Regel, sobald du den Zugriff erteilt hast (ein zweiter Slack-Workspace erhält den Namen des Workspace), und mit **Zugangsdaten bearbeiten** kannst du sie umbenennen.
3. Fülle die angebotene Authentifizierungsmethode aus. Bei OAuth wählst du **Verbinden** und erteilst den Zugriff beim Anbieter. Jedes **Verbinden** legt neue Zugangsdaten für das freigegebene Konto an und ersetzt nie bestehende. Melde dich beim Anbieter deshalb mit dem Konto an, das du hinzufügen willst.
4. Schließe das Formular ab und prüfe den neuen Eintrag mit Connector, Konto oder Instanz und Status.

Slack verbindet pro Workspace genau einen Satz Zugangsdaten. Gibst du einen bereits verbundenen Workspace erneut frei, erneuert Tale dessen Zugangsdaten, statt weitere anzulegen.

Starte jede Verbindung mit **Verbinden** in Tale. Einen Verbindungslink, der von einer anderen Website aus geöffnet wird, lehnt Tale ab. So kann ein Link, den dir jemand schickt, kein Konto und kein Postfach in deinem Namen verbinden.

Der Connector bestimmt die Felder. Verwende die tatsächlichen Zugangsdaten des Dienstkontos, keinen Tale-API-Schlüssel.

| Methode | Benötigte Angaben |
| --- | --- |
| API-Schlüssel | Der vom Dienst ausgegebene Schlüssel, etwa für Tavily oder Shopify. Jev decisions braucht einen OpenRouter-API-Schlüssel. |
| Token | Ein Dienst-Token, etwa ein persönlicher GitHub-Zugangstoken, ein Forgejo-Zugangstoken mit `read:repository` und `read:issue` (`write:issue`, um Issues zu ändern), ein Discord-Bot-Token oder ein GlitchTip-API-Token mit `project:read` und `event:read`. Ein GitHub-Token, das Sicherheitswarnungen synchronisiert, braucht zusätzlich Lesezugriff auf die Code-Scanning-, Dependabot- und Secret-Scanning-Warnungen des Repositorys. |
| Benutzername und Passwort | Das vom Dienst erwartete Paar, etwa Anmeldung und App-Passwort oder eine anbieterspezifische ID mit Token. |
| OAuth | Die Freigabe im Browser beim Anbieter. Tale speichert die zurückgegebene Berechtigung. |
| App-Anmeldung | Die eigene App-Registrierung deiner Organisation beim Anbieter: ihre Verzeichnis-ID (Tenant), Anwendungs-ID (Client) und ihr Client-Secret. Die App meldet sich selbst an, ohne eine Person; ihr Zugriffstoken holt und erneuert Tale. Outlook nutzt sie für ein [freigegebenes Postfach](#ein-freigegebenes-outlook-postfach-verbinden). |

Manche Connectors benötigen zusätzlich die Adresse der Instanz. Für Confluence ist das die Basisadresse der Atlassian-Site. Für Forgejo ist das der Ursprung der Instanz ohne Pfad, etwa `https://codeberg.org`, für GlitchTip der Ursprung der Instanz, etwa `https://app.glitchtip.com`; eine selbst gehostete Forgejo- oder GlitchTip-Instanz muss zusätzlich durch die Host-Richtlinie des Connectors erlaubt sein. Für Shopify verwendest du die `myshopify.com`-Adresse des Shops, nicht die öffentliche Shop-Domain.

## Einen Standard wählen

Die Tabelle zeigt eine Zeile je Zugangsdaten-Eintrag und aktualisiert sich ohne Neuladen, solange sie geöffnet ist: Was andere Admins hinzufügen, ändern oder löschen, siehst du sofort. **Standard** kennzeichnet den Eintrag für Aktionen ohne ausdrückliche Auswahl. Mit **Zum Standard machen** im Zeilenmenü änderst du ihn. Pro Connector ist ein Standard möglich.

Ein Connector mit mehreren Einträgen, aber ohne Standard funktioniert weiterhin für Aufrufer, die Zugangsdaten benennen. Ohne einen solchen Namen braucht der Aufruf einen Standard. Benenne Konten eindeutig, bevor du sie in Automatisierungen verwendest, damit später erkennbar bleibt, welches Konto gemeint ist.

Postfachsynchronisation und Eingangssichtung können alle aktiven Zugangsdaten eines Postfach-Connectors prüfen; eine E-Mail-Synchronisierung, die auf ein Postfach eingestellt ist, liest nur dieses. Ein zweites Postfach muss dafür nicht zuerst Standard werden. Beim Verfassen einer neuen E-Mail listet das Feld **Postfach** jedes Postfach mit seinem Namen auf; die E-Mail wird über das gewählte Postfach versendet. Auch Antworten in dieser Konversation werden über dieses Postfach versendet, ebenso ein erneuter Versuch nach einem fehlgeschlagenen Versand.

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

Ein freigegebenes Postfach wie `promotion@example.com` hat keine eigene Anmeldung. Tale erreicht es auf einem von zwei Wegen: Die eigene Microsoft-App deiner Organisation meldet sich selbst an und darf nur in dieses eine Postfach, oder eine Person mit Vollzugriff auf das Postfach verbindet ihr eigenes Konto. In beiden Fällen nennt das Feld **Postfach** der Zugangsdaten die freigegebene Adresse. Alle Outlook-Aktionen, die Postfach-Synchronisierung und der Posteingang arbeiten dann in diesem Postfach und verwenden seine Adresse als Absender. Das Postfach gibst du beim Hinzufügen der Zugangsdaten an, danach lässt es sich nicht mehr ändern: Was die Zugangsdaten gelesen und gesendet haben, gehört zu diesem Postfach. Für ein anderes Postfach fügst du weitere Zugangsdaten hinzu.

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

## Eine Verbindung reparieren

**Neu verbinden nötig** bedeutet, dass die gespeicherte OAuth-Berechtigung nicht mehr erneuert werden kann. Wähle im Menü dieser Zeile **Neu verbinden** und gib dasselbe Konto erneut frei. Tale erneuert genau diese Zugangsdaten: Name, Standard und Verweise bleiben erhalten, alle anderen Zugangsdaten bleiben unverändert. Bewusst deaktivierte Zugangsdaten aktiviert **Neu verbinden** nicht wieder; dafür gibt es **Aktivieren**.

Werden die Zugangsdaten entfernt, bevor die Freigabe abgeschlossen ist, oder erlaubt dir deine Rolle das Verwalten von Zugangsdaten nicht mehr, speichert Tale nichts und nennt den Grund. Gib bei Slack den Workspace frei, den die Zugangsdaten bereits verbinden. Einen anderen Workspace lehnt Tale ab; verbinde ihn stattdessen über **Zugangsdaten hinzufügen**.

Kann die Verbindung nicht starten, prüfe die OAuth-App. Lehnt der Anbieter die Rückkehr zu Tale ab, vergleiche die registrierte Weiterleitungsadresse mit der exakt in Tale gezeigten Adresse. Scheitert nach der Verbindung eine Aktion, prüfe die Kontorechte und den benötigten Berechtigungsumfang.

Eine App-Anmeldung hat kein **Neu verbinden**. Lehnt der Anbieter die App ab, scheitert die Aktion oder die Postfach-Synchronisierung mit der Meldung, dass der Token-Endpunkt die Anmeldung der App abgelehnt hat, gefolgt vom Grund des Anbieters, etwa `invalid_client` bei einem falschen oder abgelaufenen Client-Secret. Prüfe dann Verzeichnis-ID, Anwendungs-ID und Client-Secret und ersetze sie. Ist der Token-Endpunkt nicht erreichbar oder ausgelastet, sagt die Meldung das stattdessen, und der nächste Versuch probiert es erneut. Verweigert Microsoft Graph den Zugriff auf ein freigegebenes Postfach, nennt der Fehler das Postfach und die Exchange-Rolle, die die Aktion braucht, zum Senden etwa `Application Mail.Send`.

Für Dienste ohne mitgelieferten Connector siehe [MCP und eigene Integrationen](/de/platform/connectors/mcp-servers). Beliebige ausgehende MCP-Server werden nicht auf dieser Zugangsdaten-Seite registriert.
