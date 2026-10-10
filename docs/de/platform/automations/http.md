---
title: Eine API aus einer Automatisierung aufrufen
description: Lies mit den Schritten http.get und http.send aus jeder HTTPS-API oder sende an sie, mit gespeicherten Zugangsdaten oder ohne, und erfahre, was Tale ablehnt.
---

Verwende einen HTTP-Schritt, wenn eine Automatisierung eine externe API braucht, für die es keinen eigenen Connector gibt. `http.get` liest, `http.send` schreibt mit POST, PUT, PATCH oder DELETE. Ein Senden ändert Daten außerhalb von Tale, deshalb fragt ein Live-Lauf zuerst nach einer [Freigabe](/de/platform/approvals/concepts), wie bei jedem Schreiben. Ein Testlauf sendet nie: Er antwortet mit einem Mock.

## Aus einer API lesen

```yaml
nodes:
  - id: orders
    type: http.get
    credential: Shop API
    input:
      url: /orders
      query: { status: open }
```

| Eingabe        | Was sie enthält                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `url`          | Eine vollständige `https://`-Adresse oder, mit Zugangsdaten, ein Pfad unter deren Basis-URL, etwa `/orders`.       |
| `query`        | Query-Parameter, die an die Adresse angehängt werden.                                                              |
| `headers`      | Request-Header. `Authorization`, `Cookie` und der API-Key-Header kommen aus den Zugangsdaten, nie von hier.        |
| `timeoutMs`    | Wie lange auf die ganze Antwort gewartet wird: 1.000 bis 30.000 Millisekunden, standardmäßig 15.000.               |
| `responseType` | `json` oder `text`. Ohne Angabe wird die Antwort als JSON gelesen, wenn ihr Content-Type JSON ist, sonst als Text. |
| `okStatuses`   | Status außerhalb von 200–299, die den Schritt nicht scheitern lassen, etwa `[404]`.                                |

Der Schritt gibt `{ status, ok, headers, body }` zurück. `body` enthält das geparste JSON oder den Text, bei einer leeren Antwort `null`. `headers` behält `content-type`, `etag`, `last-modified`, `location`, `link`, `retry-after` und die `x-ratelimit-`-Header und verwirft die übrigen. Ein Status außerhalb von 200–299 lässt den Schritt scheitern, es sei denn, `okStatuses` nennt ihn; dann ist `ok` gleich `false`, und ein späterer Schritt entscheidet, was mit der Antwort geschieht.

## An eine API senden

`http.send` nimmt dieselben Eingaben und drei weitere: `method` (POST, PUT, PATCH oder DELETE, erforderlich), `body` und `contentType`. Ein JSON-Wert in `body` wird als JSON gesendet. Ein String wird so gesendet, wie er ist, mit `contentType` oder ohne Angabe als `text/plain`.

```yaml
nodes:
  - id: create_order
    type: http.send
    credential: Shop API
    input:
      url: /orders
      method: POST
      body:
        item: '{{ input.item }}'
        quantity: 2
```

## Mit Zugangsdaten anmelden

Füge unter **Einstellungen › Connectors** Zugangsdaten zu **HTTP** hinzu. Wähle, wie sie sich anmelden: mit einem Bearer-Token, einem API-Key in einem Header oder mit Benutzername und Passwort. Gib ihre **Base URL** ein, etwa `https://api.example.com/v2`; bei einem API-Key nennt **API key header** den Header, standardmäßig `X-Api-Key`. Gib den Zugangsdaten einen Namen und nenne ihn im Feld `credential` des Schritts.

Ein Schritt mit Zugangsdaten bleibt unter der Basis-URL. Ein Pfad wird darunter gesetzt, eine vollständige Adresse muss mit ihr beginnen, und eine Weiterleitung darf sie nicht verlassen. Nur die Zugangsdaten melden die Anfrage an. Wo eine Antwort einen ihrer Werte zurückgeben würde, ersetzt Tale ihn durch `[redacted]`, sodass er nie in die Aufzeichnung eines Laufs gelangt.

Ein Schritt ohne Zugangsdaten trägt keine, nie die Standard-Zugangsdaten der Organisation, und ruft nur öffentliche `https://`-Adressen auf.

## Was Tale ablehnt

- Eine Adresse in einem privaten Netzwerk oder eine Metadatenadresse einer Cloud, mit oder ohne Zugangsdaten.
- Eine einfache `http://`-Adresse. Der Editor warnt vor dem Speichern davor.
- Einen Benutzernamen oder ein Passwort in der Adresse oder Zugangsdaten in einem ihrer Query-Parameter: Der Editor lehnt das Speichern ab. Speichere die Zugangsdaten stattdessen unter **Einstellungen › Connectors**.
- Einen `Authorization`- oder `Cookie`-Header, den der Schritt setzt. Auch das lehnt der Editor ab.
- Eine Antwort über 1 MB.

Die HTTP-Schritte einer Organisation machen höchstens 120 Aufrufe pro Minute im ganzen Deployment und 10 gleichzeitig auf einem Server. Ein Aufruf über dem Budget der Minute scheitert; einer über der Zahl gleichzeitiger Aufrufe wartet auf einen freien Platz, solange sein `timeoutMs` es zulässt.

## Wenn ein Schritt scheitert

Die Seite des Laufs sagt, warum ein HTTP-Schritt gescheitert ist und wie du es behebst. Die [Ausführungsprotokolle](/de/platform/automations/execution-logs#failures) erklären, wie du den Fehler liest.

| Fehler                                           | Was geschehen ist                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Die API hat mit einem Fehler geantwortet**     | Der Status lag außerhalb von 200–299, und `okStatuses` nennt ihn nicht.                                              |
| **Die API hat zu lange gebraucht**               | Innerhalb von `timeoutMs` kam keine vollständige Antwort.                                                            |
| **Die API war nicht erreichbar**                 | Der Name ließ sich nicht auflösen, oder die Verbindung oder ihr TLS ist fehlgeschlagen.                              |
| **Die Adresse ist nicht erlaubt**                | Die Adresse ist privat, eine Metadatenadresse einer Cloud oder einfaches `http://`.                                  |
| **Die Adresse liegt außerhalb der Zugangsdaten** | Ein Aufruf mit Zugangsdaten oder eine seiner Weiterleitungen hat die Basis-URL verlassen.                            |
| **Die Adresse kann nicht aufgerufen werden**     | Die URL ist keine Adresse, ist kein `https`, ist ein Pfad ohne Zugangsdaten oder enthält Benutzername oder Passwort. |
| **Ein Header gehört zu den Zugangsdaten**        | Der Schritt hat `Authorization`, `Cookie` oder den API-Key-Header gesetzt.                                           |
| **Die Antwort ist zu groß**                      | Die Antwort war größer als 1 MB.                                                                                     |
| **Die Antwort ist kein JSON**                    | `responseType` ist `json`, und die Antwort war etwas anderes.                                                        |
| **Zu viele API-Aufrufe auf einmal**              | Die Schritte der Organisation haben ihr Budget an Aufrufen verbraucht.                                               |
