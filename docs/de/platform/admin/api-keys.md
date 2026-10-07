---
title: API-Schlüssel
description: Erstelle, prüfe, rotiere und widerrufe Zugangsdaten für Software, die Tale aufruft.
---

Erstelle einen API-Schlüssel, wenn ein Skript oder Dienst die REST-API von Tale aufrufen soll. Ein Schlüssel, den du für dich selbst erstellst, gehört dir, nicht der Organisation, auf deren Einstellungsseite er entstand: Er handelt in deinem Namen, verwendet deine aktuellen Rechte und gilt in jeder Organisation, der du angehörst. Eine REST-Anfrage nennt die angesprochene Organisation im Header `X-Organization-Slug`; gehört der Inhaber nur einer Organisation an, darf er entfallen. Inhaber, Admins und Entwickler verwalten ihre Schlüssel unter **Einstellungen > API > REST**, ebenso ein Mitglied, dem ein Admin eine Kompetenz zugewiesen hat, die mit einem Schlüssel genutzt wird: **Modelle über die API aufrufen**, **Benachrichtigungen exportieren** oder **Für ein anderes Mitglied handeln**. Allen anderen verweigert Tale einen neuen Schlüssel mit `403 API_KEY_CREATE_FORBIDDEN`.

Inhaber und Admins können auch einen Schlüssel für ein anderes Mitglied, ein Team, ein Projekt oder die Organisation selbst erstellen. Ein solcher Schlüssel gilt nur in dieser einen Organisation; [Einen Schlüssel für andere erstellen](#create-a-key-for-someone-else) erklärt, als wer er handelt und was er erreicht. Ein Mitglied, für das ein Admin einen Schlüssel erstellt hat, findet ihn ebenfalls unter **Einstellungen > API > REST**.

<Frame caption="Einstellungen > API > REST — wo Schlüssel erstellt, rotiert und widerrufen werden.">

![Im Dialog zum Erstellen eines API-Schlüssels legst du vor der Erstellung einen Namen, die Zugehörigkeit des Schlüssels und die Gültigkeitsdauer fest.](/images/get-started/settings-api-keys.webp)

</Frame>

## Einen Schlüssel erstellen

1. Wähle **API-Schlüssel erstellen**.
2. Gib unter **Schlüsselname** einen Namen ein, der den aufrufenden Dienst erkennen lässt, etwa `Abrechnungssynchronisation` oder `Dokumentimport`.
3. Wähle als Inhaber oder Admin unter **Gehört zu**, für wen der Schlüssel ist. Voreingestellt ist **Dir**; die übrigen Möglichkeiten beschreibt der [nächste Abschnitt](#create-a-key-for-someone-else).
4. Wähle die **Ablaufzeit**: 7, 30 oder 90 Tage, ein Jahr, **Eigenes Datum** oder nie. Voreingestellt sind 30 Tage; unter dem Feld steht, an welchem Tag der Schlüssel abläuft. Mit **Eigenes Datum** wählst du diesen Tag im Kalender **Ablaufdatum**, frühestens morgen und höchstens ein Jahr im Voraus.
5. Erstelle den Schlüssel und kopiere den geheimen Wert in den vorgesehenen sicheren Schlüsselspeicher des Dienstes, bevor du die Bestätigung schließt.

Der vollständige Wert wird nur einmal angezeigt. Später siehst du in der Tabelle nur ein maskiertes Fragment, wem der Schlüssel gehört, das Ablaufdatum, das Erstellungsdatum und die letzte Nutzung. Die Liste enthält deine eigenen Schlüssel und die Schlüssel, die ein Admin in dieser Organisation für dich erstellt hat; Inhaber und Admins sehen zusätzlich jeden Schlüssel, der hier für ein Mitglied, ein Team, ein Projekt oder die Organisation erstellt wurde, nie aber die Schlüssel, die Mitglieder für sich selbst erstellt haben. Unter **Gehört zu** zeigt der Schlüssel eines Teams, eines Projekts oder der Organisation die Rolle, als die er handelt, und ein für ein Mitglied erstellter Schlüssel, wer ihn erstellt hat.

<Warning>

Wer einen Schlüssel besitzt, kann mit den Rechten seines Inhabers handeln. Halte ihn aus Quellcode, Chatnachrichten, Screenshots und Protokollen heraus. Nutze ein Konto mit genau den Zugriffsrechten, die die Integration braucht.

</Warning>

## Einen Schlüssel für andere erstellen {#create-a-key-for-someone-else}

Inhaber und Admins wählen unter **Gehört zu**, für wen ein neuer Schlüssel ist:

- **Einem anderen Mitglied**: Der Schlüssel handelt als dieses Mitglied, mit dessen aktueller Rolle und dessen Teams, nur in dieser Organisation, und seine Nutzung zählt für die Grenzen des Mitglieds. Du kannst ein Mitglied wählen, dessen Rolle unter deiner liegt. Der Schlüssel funktioniert nur, solange du Inhaber oder Admin über diesem Mitglied bleibst: Er hört auf, wenn du gehst, diese Rolle verlierst oder das Mitglied deine Rolle erreicht. Das Mitglied wird benachrichtigt, sieht den Schlüssel in seiner Liste und kann ihn widerrufen. Gib ihm den geheimen Wert über einen sicheren Kanal weiter.
- **Einem Team**, **Einem Projekt** oder **Der Organisation**: Der Schlüssel gehört diesem Team, diesem Projekt oder der Organisation statt einer Person und funktioniert weiter, wenn du gehst. Er handelt mit der Rolle, die du unter **Handelt als** wählst: Mitglied, Redakteur oder Entwickler, Admin nur beim Schlüssel der Organisation. Die Rolle kann nicht höher sein als deine eigene.

<Frame caption="Ein Schlüssel der Organisation selbst handelt mit der Rolle, die unter Handelt als gewählt ist.">

![Der Dialog zum Erstellen eines API-Schlüssels für einen Schlüssel, der der Organisation selbst gehört, als Entwickler handelt und nach 30 Tagen abläuft.](/images/platform/settings-api-keys-organization.webp)

</Frame>

| Ein Schlüssel | Erreicht |
| --- | --- |
| eines Teams | Was ein Mitglied dieses Teams mit der gewählten Rolle erreicht: die Projekte, Dokumente und den Posteingang des Teams sowie alles, was die Organisation mit allen Mitgliedern teilt |
| eines Projekts | Nur dieses Projekt: die Routen unter `/api/v1/projects/{projectId}`, `GET /api/v1/projects`, das nur dieses Projekt auflistet, `GET /api/v1/me` und die Modell-Endpunkte. Jede andere Route antwortet mit `403 API_KEY_SCOPE_FORBIDDEN`. Über den Chat-Assistenten liest er die Dateien und Aufgaben seines Projekts, aber keine Kontakte, Produkte, Websites und keinen Posteingang der Organisation |
| der Organisation | Was ein Mitglied mit der gewählten Rolle in der ganzen Organisation erreicht |

Diese Schlüssel brauchen keinen `X-Organization-Slug`; ein Header, der eine andere Organisation nennt, wird mit `403 ORG_FORBIDDEN` beantwortet. Ein Schlüssel endet mit dem, dem er gehört: Verlässt sein Mitglied die Organisation oder wird sein Team oder Projekt gelöscht, wird er widerrufen, und das Audit-Log hält den Grund fest; wird die Organisation gelöscht, werden ihre Schlüssel mit ihr gelöscht.

## Den Aufruf prüfen

Führe die authentifizierte Anfrage aus dem [API-Schnellstart](/de/get-started/developers) aus. Prüfe die zurückgegebene Identität und Organisation, bevor du Daten schreibst oder importierst. Kontrolliere anschließend **Zuletzt verwendet** in der Schlüsseltabelle.

Eine erfolgreiche Anmeldung erlaubt nicht automatisch den Zugriff auf jede Ressource. Projektfreigaben und die aktuelle Rolle des Schlüsselinhabers gelten weiterhin. Unterscheide anhand der API-Fehlermeldung zwischen einem abgelaufenen oder widerrufenen Schlüssel und fehlenden Ressourcenrechten.

## Ohne Unterbrechung rotieren

1. Erstelle vor Ablauf des alten Schlüssels einen Ersatz. Wann er abläuft, zeigt die Spalte **Läuft ab**.
2. Aktualisiere den sicheren Schlüsselspeicher des aufrufenden Dienstes. Starte ihn neu oder lade seine Konfiguration neu, falls erforderlich.
3. Prüfe eine authentifizierte Anfrage mit dem neuen Schlüssel.
4. Widerrufe den alten Schlüssel erst, wenn alle abhängigen Aufrufer umgestellt sind.

Tale rotiert Schlüssel nicht automatisch. Erstellen und Widerrufen erfolgen in dieser Oberfläche, nicht über `/api/v1`. Ein Aufrufer kann Name und Ablaufzeit seines Schlüssels mit `GET /api/v1/me` auslesen und die verantwortliche Person rechtzeitig benachrichtigen.

## Einen Schlüssel widerrufen

Öffne das Zeilenmenü, wähle **Schlüssel widerrufen** und bestätige. Weitere Anfragen können sich mit diesem Schlüssel nicht mehr authentifizieren, auch Aufrufe der Modell-Endpunkte; eine Antwort, die bereits gestreamt wird, läuft zu Ende. Der Widerruf ist endgültig. Erstelle einen neuen Schlüssel, falls du den falschen widerrufen hast. Das Erstellen und das Widerrufen eines Schlüssels hinterlassen je einen Eintrag im Audit-Log unter **Einstellungen > Richtlinien > Protokolle**, und zwar in jeder Organisation, der du angehörst.

Inhaber und Admins können jeden Schlüssel widerrufen, der hier für ein Mitglied, ein Team, ein Projekt oder die Organisation erstellt wurde, und ein Mitglied die Schlüssel, die ein Admin für es erstellt hat. Die eigenen Schlüssel eines Mitglieds widerruft nur das Mitglied selbst; um sie in dieser Organisation zu sperren, deaktiviere oder entferne das Mitglied. Ein solcher Schlüssel wird nur in seiner Organisation verwaltet: Sein Erstellen und sein Widerruf werden dort protokolliert, mit der Person, die ihn erstellt oder widerrufen hat.

Ein altes Datum unter **Zuletzt verwendet** reicht allein nicht als Grund zum Widerruf. Ein monatlicher Auftrag oder ein Wiederherstellungsverfahren kann längere Zeit ungenutzt bleiben. Prüfe zuerst den Dienst, den der Name bezeichnet.

## Rechte und Limits verstehen

Rollenänderungen gelten bei folgenden Anfragen auch für bestehende Schlüssel. Wird die Mitgliedschaft des Inhabers deaktiviert, endet sein Zugriff. Der Schlüssel behält nicht die Rolle vom Erstellungszeitpunkt. Verlierst du die Rolle oder Kompetenz, mit der du Schlüssel erstellen durftest, bleiben deine bestehenden Schlüssel erhalten: **Einstellungen > API > REST** listet sie weiter, damit du sie widerrufen kannst, bietet aber keinen neuen an.

Gib einer Integration nur den Zugriff, den sie braucht. Ein Dienst, der Benachrichtigungen spiegelt, benötigt zum Beispiel kein Admin-Konto: Ein Admin kann einem gewöhnlichen Mitglied die Berechtigung `tale:notifications.export` erteilen. Sie erlaubt diesen Export, aber keines der übrigen Rechte der Admin-Rolle, gilt nur in der Organisation, kann ablaufen und endet, wenn das Mitglied entfernt wird. Weise sie unter [Kompetenzen](/de/platform/admin/governance/competences) zu. Dort erhält auch eine Integration, die Antworten und Prüfentscheidungen von Personen weiterreicht, auf dieselbe Weise `tale:rest.act-as`; [Export ohne Admin-Rolle delegieren](/de/develop/api-reference#export-ohne-admin-rolle-delegieren) beschreibt die API-Seite.

REST-Ratenlimits gelten für den authentifizierten Schlüsselinhaber. Mehrere Schlüssel derselben Person erhalten keine getrennten Kontingente; ein Schlüssel, den ein Inhaber oder Admin für ein Mitglied, ein Team, ein Projekt oder die Organisation erstellt hat, hat ein eigenes. Siehe [Ratenlimits](/de/develop/rate-limits). Eine [Budgetregel](/de/platform/admin/governance/policies-and-limits) kann zusätzlich begrenzen, was mit einem einzelnen Schlüssel authentifizierte Anfragen ausgeben dürfen: Ihre Nutzung wird dem Schlüssel angerechnet, und ein Senden oder ein Modellaufruf über der Grenze wird mit `429 BUDGET_EXCEEDED` abgelehnt. Auch Automatisierungsläufe, die mit dem Schlüssel gestartet wurden, zählen für ihn, zusätzlich zu den persönlichen Grenzen des Mitglieds, für das der Schlüssel handelt. Ein für ein Mitglied erstellter Schlüssel zählt für die Grenzen dieses Mitglieds, wie sein eigener. Der Schlüssel eines Teams, eines Projekts oder der Organisation gibt unter eigenem Namen aus: Für ihn gilt keine persönliche, Rollen- oder Standardgrenze, wohl aber die Grenzen der Organisation und jede Regel für den Schlüssel selbst, und der Schlüssel eines Teams zählt zusätzlich für die Grenze seines Teams und wird von ihr begrenzt. Die Nutzungsanalyse führt einen solchen Schlüssel als eigene Zeile, nie als aktive Person. [So wird die Nutzung gezählt](/de/platform/admin/governance/usage-attribution) beschreibt die Regel vollständig.

Ein Schlüssel kann außerdem die Modelle der Organisation aus Tools wie opencode oder Claude Code aufrufen, über die [Modell-Endpunkte](/de/develop/use-tale-from-your-editor#model-endpoints), sobald ein Admin sie unter [Modelle](/de/platform/admin/governance/content-models#model-endpoints) eingeschaltet hat. Die Person, der er gehört, muss Inhaber, Admin oder Entwickler sein oder die Kompetenz **Modelle über die API aufrufen** haben. Diese Aufrufe zählen wie seine Chatnachrichten für die Budgetregeln des Schlüssels und erscheinen in der Nutzungsanalyse als **Direkter API-Aufruf**, unter der Person und dem Schlüssel.

API-Schlüssel authentifizieren Software, die Tale aufruft. [Connector-Zugangsdaten](/de/platform/admin/connectors) dienen der Gegenrichtung: Damit ruft Tale einen externen Dienst auf. [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor) zeigt, wo ein Schlüssel in opencode, Claude Code und einem Shell-Skript hingehört.
