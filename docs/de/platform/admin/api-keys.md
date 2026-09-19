---
title: API-Schlüssel
description: Erstelle, prüfe, rotiere und widerrufe Zugangsdaten für Software, die Tale aufruft.
---

Erstelle einen API-Schlüssel, wenn ein Skript oder Dienst die REST-API von Tale aufrufen soll. Der Schlüssel handelt im Namen der Person, die ihn erstellt hat, und verwendet ihre aktuellen Rechte in der Organisation. Inhaber, Admins und Entwickler verwalten ihre Schlüssel unter **Einstellungen > API > REST**.

<Frame caption="Einstellungen > API > REST — wo Schlüssel erstellt, rotiert und widerrufen werden.">

![Im Dialog zum Erstellen eines API-Schlüssels legst du vor der Erstellung einen Namen und die Gültigkeitsdauer fest.](/images/get-started/settings-api-keys.webp)

</Frame>

## Einen Schlüssel erstellen

1. Wähle **API-Schlüssel erstellen**.
2. Gib unter **Schlüsselname** einen Namen ein, der den aufrufenden Dienst erkennen lässt, etwa `Abrechnungssynchronisation` oder `Dokumentimport`.
3. Wähle die **Ablaufzeit**: 7, 30 oder 90 Tage, ein Jahr oder nie. Voreingestellt sind 30 Tage.
4. Erstelle den Schlüssel und kopiere den geheimen Wert in den vorgesehenen sicheren Schlüsselspeicher des Dienstes, bevor du die Bestätigung schließt.

Der vollständige Wert wird nur einmal angezeigt. Später siehst du in der Tabelle nur ein maskiertes Fragment, das Erstellungsdatum und die letzte Nutzung. Die Liste enthält deine Schlüssel, nicht die anderer Mitglieder.

<Warning>

Wer einen Schlüssel besitzt, kann mit den Rechten seines Inhabers handeln. Halte ihn aus Quellcode, Chatnachrichten, Screenshots und Protokollen heraus. Nutze ein Konto mit genau den Zugriffsrechten, die die Integration braucht.

</Warning>

## Den Aufruf prüfen

Führe die authentifizierte Anfrage aus dem [API-Schnellstart](/de/get-started/developers) aus. Prüfe die zurückgegebene Identität und Organisation, bevor du Daten schreibst oder importierst. Kontrolliere anschließend **Zuletzt verwendet** in der Schlüsseltabelle.

Eine erfolgreiche Anmeldung erlaubt nicht automatisch den Zugriff auf jede Ressource. Projektfreigaben und die aktuelle Rolle des Schlüsselinhabers gelten weiterhin. Unterscheide anhand der API-Fehlermeldung zwischen einem abgelaufenen oder widerrufenen Schlüssel und fehlenden Ressourcenrechten.

## Ohne Unterbrechung rotieren

1. Erstelle vor Ablauf des alten Schlüssels einen Ersatz.
2. Aktualisiere den sicheren Schlüsselspeicher des aufrufenden Dienstes. Starte ihn neu oder lade seine Konfiguration neu, falls erforderlich.
3. Prüfe eine authentifizierte Anfrage mit dem neuen Schlüssel.
4. Widerrufe den alten Schlüssel erst, wenn alle abhängigen Aufrufer umgestellt sind.

Tale rotiert Schlüssel nicht automatisch. Erstellen und Widerrufen erfolgen in dieser Oberfläche, nicht über `/api/v1`. Ein Aufrufer kann Name und Ablaufzeit seines Schlüssels mit `GET /api/v1/me` auslesen und die verantwortliche Person rechtzeitig benachrichtigen.

## Einen Schlüssel widerrufen

Öffne das Zeilenmenü, wähle **Schlüssel widerrufen** und bestätige. Weitere Anfragen können sich mit diesem Schlüssel nicht mehr authentifizieren. Der Widerruf ist endgültig. Erstelle einen neuen Schlüssel, falls du den falschen widerrufen hast.

Ein altes Datum unter **Zuletzt verwendet** reicht allein nicht als Grund zum Widerruf. Ein monatlicher Auftrag oder ein Wiederherstellungsverfahren kann längere Zeit ungenutzt bleiben. Prüfe zuerst den Dienst, den der Name bezeichnet.

## Rechte und Limits verstehen

Rollenänderungen gelten bei folgenden Anfragen auch für bestehende Schlüssel. Wird die Mitgliedschaft des Inhabers deaktiviert, endet sein Zugriff. Der Schlüssel behält nicht die Rolle vom Erstellungszeitpunkt.

Gib einer Integration nur den Zugriff, den sie braucht. Ein Dienst, der Benachrichtigungen spiegelt, benötigt zum Beispiel kein Admin-Konto: Ein Admin kann einem gewöhnlichen Mitglied die Berechtigung `tale:notifications.export` erteilen. Sie erlaubt diesen Export, aber keines der übrigen Rechte der Admin-Rolle, gilt nur in der Organisation, kann ablaufen und endet, wenn das Mitglied entfernt wird. Siehe [Export ohne Admin-Rolle delegieren](/de/develop/api-reference#export-ohne-admin-rolle-delegieren).

REST-Ratenlimits gelten für den authentifizierten Schlüsselinhaber. Mehrere Schlüssel derselben Person erhalten keine getrennten Kontingente. Siehe [Ratenlimits](/de/develop/rate-limits). Eine [Budgetregel](/de/platform/admin/governance/policies-and-limits) kann zusätzlich begrenzen, was mit einem einzelnen Schlüssel authentifizierte Anfragen ausgeben dürfen: Ihre Nutzung wird dem Schlüssel angerechnet, und ein Senden über der Grenze wird mit `429 BUDGET_EXCEEDED` abgelehnt. Auch Automatisierungsläufe, die mit dem Schlüssel gestartet wurden, zählen für ihn, zusätzlich zu den persönlichen Grenzen des Mitglieds, für das der Schlüssel handelt. [So wird die Nutzung gezählt](/de/platform/admin/governance/usage-attribution) beschreibt die Regel vollständig.

API-Schlüssel authentifizieren Software, die Tale aufruft. [Connector-Zugangsdaten](/de/platform/admin/connectors) dienen der Gegenrichtung: Damit ruft Tale einen externen Dienst auf.
