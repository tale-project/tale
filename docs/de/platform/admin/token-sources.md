---
title: Token-Quellen
description: Einstellungen > Token-Quellen ist der Ort, an dem Admins einen Bring-your-own-key-Agenten auf einen externen Broker richten, der einen Pool aus LLM-Anmeldedaten ausgibt. Der Agent zieht pro Lauf ein Token und fällt bei einem Rate-Limit- oder Auth-Fehler auf ein anderes zurück, sodass ein einzelner gedrosselter oder abgelaufener Schlüssel den Lauf nie blockiert.
---

Einstellungen > Token-Quellen ist für den Fall, dass ein einzelner statischer API-Schlüssel nicht reicht: Statt einen Bring-your-own-key-Agenten an ein einziges Geheimnis zu binden, richtest du ihn auf einen externen Broker, der einen _Pool_ aus Anmeldedaten zurückgibt. Der Agent wählt pro Lauf ein Token und fällt, wenn dieses Token rate-limited oder abgelaufen zurückkommt, auf ein anderes aus demselben Pool zurück — bis zu drei Versuche, bevor der Lauf scheitert. Es ist die Rotations-Schicht unter einem BYO-[External Agent](/de/platform/agents/external-agent), nicht mehr: Managed Agents nutzen weiterhin das Org-Gateway und ignorieren diese Seite vollständig.

Diese Seite behandelt die Oberfläche — was die Liste zeigt, die Felder beim Hinzufügen einer Quelle, wie eine Quelle an einen Agenten bindet und was die Rotation zur Laufzeit tatsächlich tut. Das Auth-Geheimnis des Brokers ist hier write-only; seine Datei- und Umgebungsvariablen-Form liegt einen Tab weiter unter der [Self-hosted-Konfigurations](/de/self-hosted/configuration/environment-reference)-Referenz.

## Was die Liste zeigt

Öffne **Einstellungen > Token-Quellen** und du landest auf der Tabelle der Quellen, die die Organisation konfiguriert hat. Jede Zeile nennt die Quelle, zeigt ihren Broker-**Endpunkt-URL** und zeigt die Ziel-Umgebungsvariable, unter der die Rotations-Engine das gewählte Token injiziert (für einen Claude-Code-Agenten ist das meist `CLAUDE_CODE_OAUTH_TOKEN`). Die Suche filtert nach Name oder Endpunkt; das **···**-Menü an einer Zeile bearbeitet oder löscht sie, und Zeilen auszuwählen blendet eine Sammellösch-Leiste ein.

Eine Quelle ist reine Konfiguration — sie speichert, _wie_ der Broker erreicht und _wie_ seine Antwort gelesen wird, nie die Tokens selbst. Tokens werden bei jedem Agentenlauf frisch vom Broker geholt, sodass die Liste gegenüber dem aktuellen Pool des Brokers nie veraltet.

## Eine Quelle hinzufügen

Klick auf **Neue Token-Quelle** und füll das Seitenpanel aus. Die Felder fallen in drei Gruppen:

- **Identität** — ein `slug` (kleingeschrieben, stabil; er benennt die Konfigurationsdatei und das Geheimnis), ein **Anzeigename** und die **Endpunkt-URL** des Brokers mit ihrer **HTTP-Methode**.
- **Broker-Authentifizierung** — wie Tale sich _gegenüber dem Broker_ authentifiziert: **Keine**, ein **Bearer-Token** oder ein **Eigener Header**. Für Bearer oder Header gibst du das **Broker-Geheimnis** ein. Das Geheimnis ist write-only — es wird nie an den Browser zurückgegeben, daher zeigt das Feld beim Bearbeiten leer und es leer zu lassen behält den gespeicherten Wert.
- **Antwort-Zuordnung** — wie die JSON-Antwort des Brokers gelesen wird. **Tokens-Pfad** ist ein JSONPath zum Array der Tokens (z. B. `$.tokens`); **Token-Feld** benennt die Eigenschaft, die jedes Token hält. Das optionale **Statusfeld (optional)** / **Aktiver Statuswert (optional)** filtert inaktive Tokens heraus, und **Ablauffeld (optional)** (ein ISO-Zeitstempel oder Epoch-Sekunden/-ms) verwirft bereits abgelaufene, bevor der Pool genutzt wird.

Wähl zuletzt die **Ziel-Umgebungsvariable**, unter der das Token injiziert wird, und die **Auswahlstrategie** — **Zufällig** (der Default, wählt pro Lauf gleichverteilt) oder **Erste** (deterministisch). Das Speichern validiert die Konfiguration, schreibt sie und macht die Quelle sofort im Umgebungs-Tab des Agenten auswählbar.

## Eine Quelle an einen Agenten binden

Eine Token-Quelle tut nichts, bis ein Agent aus ihr zieht. Öffne den **Umgebung**-Tab des Agenten, füg eine Zeile hinzu und ändere ihren Typ von **Wert** / **Geheim** auf **Token-Quelle** — ein zweites Dropdown lässt dich dann wählen, welche Quelle. Der Variablenname der Zeile ist die Umgebungsvariable, in der das gewählte Token landet, und überschreibt für diesen Agenten den eigenen Default der Quelle.

Die Bindung greift nur für Bring-your-own-key-Agenten. Ein Managed Agent authentifiziert sich über das Org-Gateway, daher wird eine Token-Quellen-Zeile an ihm mit einer Warnung ignoriert, statt stillschweigend zu ändern, wie der Agent abgerechnet wird.

## Was die Rotation zur Laufzeit tut

Wenn ein gebundener BYO-Agent startet, holt Tale den Broker-Pool, filtert inaktive und abgelaufene Tokens heraus und injiziert eine Auswahl. Endet der Lauf in einem rotierbaren Fehler — einem Rate-Limit (`429`/`529`) oder einem Auth-Fehler (`401`/`403`) — tauscht Tale ein anderes Token aus dem Pool ein und lässt erneut laufen, bis zu drei Tokens insgesamt, solange genug vom Lauf-Fenster übrig ist. Ein Auth-Fehler wird früh abgebrochen, statt ihn die internen Retries des Anbieters durchstürmen zu lassen. Scheitert jedes versuchte Token auf dieselbe Weise, scheitert der Lauf schnell mit einem klaren Fehler, statt zu schleifen.

Ist der Broker nicht erreichbar, gibt fehlerhaftes JSON zurück oder liefert kein aktives, unabgelaufenes Token, scheitert der Lauf sofort — es gibt keinen stillen Fallback auf einen statischen Schlüssel, weil ein BYO-Agent keinen hat.

## Eine Quelle entfernen

Öffne das **···**-Menü und wähl **Löschen**, oder wähl Zeilen aus und nutz die Sammellösch-Leiste. Das Löschen entfernt die Konfiguration und ihr gespeichertes Geheimnis. Jeder Agent, der noch an die gelöschte Quelle gebunden ist, scheitert bei seinem nächsten Lauf mit einem Konfigurationsfehler, statt zurückzufallen, also richte die Bindung im Umgebungs-Tab des Agenten zuerst um oder entferne sie.

## Wo das hingehört

Token-Quellen sitzen neben den [KI-Anbietern](/de/platform/admin/providers) als der zweite Weg, auf dem Tale Modell-Anmeldedaten beschafft: Anbieter sind der managed, über das Gateway geroutete Pfad; Token-Quellen sind der BYO-, über den Broker rotierte Pfad für Agenten, die ihre eigenen Schlüssel mitbringen. Die natürliche nächste Lektüre ist die [External-Agent](/de/platform/agents/external-agent)-Seite dafür, wie ein BYO-Agent gebaut wird, und die [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference) für die `TALE_TOKEN_SOURCE_`-Form des Broker-Geheimnisses, wenn du eine Quelle aus Dateien statt aus der UI konfigurierst.
