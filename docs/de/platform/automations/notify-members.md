---
title: Mitglieder aus einer Automatisierung benachrichtigen
description: Teile Mitgliedern mit dem Schritt notify.member etwas aus einer Automatisierung mit — Titel, Text und Link, in ihren Benachrichtigungen und per E-Mail — und erfahre, wer übersprungen und was abgelehnt wird.
---

Verwende einen `notify.member`-Schritt, wenn eine Automatisierung Leuten etwas mitteilen soll: ein Bericht ist fertig, drei Rechnungen brauchen einen Blick, ein Import ist abgeschlossen. Jedes Mitglied, das er nennt, bekommt die Nachricht in seinen Benachrichtigungen und per E-Mail, in einem Rahmen, der die Automatisierung nennt. Ein Live-Lauf schickt sie, ein Testlauf antwortet mit einem Mock und benachrichtigt niemanden.

## Eine Nachricht schicken

```yaml
nodes:
  - id: tell
    type: notify.member
    input:
      to: [ada@example.com, '{{ input.ownerId }}', run-starter]
      title: Weekly report ready
      message: '{{ nodes.summary.output.text }}'
      link: '{{ nodes.report.output.url }}'
```

| Eingabe   | Was sie enthält                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`      | Bis zu 20 Mitglieder, per E-Mail-Adresse oder Benutzer-ID, oder `run-starter` für die Person, die den Lauf gestartet hat.                                                                                            |
| `title`   | Worum es geht, in einer Zeile mit höchstens 120 Zeichen. Er steht über der Benachrichtigung und ist der Betreff der E-Mail.                                                                                          |
| `message` | Der Text unter dem Titel, als reiner Text, höchstens 2000 Zeichen.                                                                                                                                                   |
| `link`    | Eine Seite deiner Organisation, als Pfad, der mit `/dashboard/` beginnt, oder eine `https://`-Adresse. Eine Seite öffnet sich in Tale, eine Adresse in einem neuen Tab, und die Benachrichtigung nennt ihre Website. |

Eine leere `message` oder ein leerer `link` — eine Vorlage, die nichts gefunden hat — wird weggelassen.

Der Schritt gibt `{ delivered, skipped }` zurück: `delivered` listet jedes erreichte Mitglied als `{ to, userId }` unter dem Namen, den der Schritt ihm gab, und `skipped` listet `{ to, userId, reason }` für jedes nicht erreichte.

## Wer sie bekommt

Jedes Mitglied bekommt eine Benachrichtigung, auch wenn der Schritt es zweimal nennt — per E-Mail-Adresse und per Benutzer-ID. Die E-Mail folgt eine Minute später, außer es hat die Nachricht bis dahin in Tale gelesen oder **Handlungsrelevante Alerts per E-Mail** unter Einstellungen › Benachrichtigungen ausgeschaltet. Sie geht über das verbundene Gmail-, Outlook- oder SMTP-Postfach deiner Organisation hinaus; ohne eines bleibt es bei der Benachrichtigung in Tale.

Zwei Fälle werden übersprungen und in `skipped` mit ihrem Grund aufgeführt:

| Grund        | Warum                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `preference` | Sie haben **Nachrichten von Automatisierungen** unter Einstellungen › Benachrichtigungen ausgeschaltet.                                 |
| `no_starter` | `run-starter` bei einem Lauf, den keine Person gestartet hat: ein Trigger hat ihn gestartet, oder die Person, die es tat, ist gegangen. |

## Einmal pro Ausführung des Schritts

Der Schritt schickt seine Nachricht einmal pro Ausführung: einmal pro Lauf, und einmal pro Eintrag oder Durchgang in einer Schleife. Wird ein Lauf unterbrochen, nachdem die Nachricht hinausging, und läuft dann weiter, benachrichtigt der Schritt niemanden zweimal und antwortet mit den Mitgliedern, die er schon erreicht hat.

Ein Lauf schickt höchstens 100 Nachrichten, damit ein Schritt in einer Schleife niemandes Benachrichtigungen überflutet. Um jemandem viele Einträge mitzuteilen, schicke eine Nachricht, die sie auflistet.

## Wenn ein Schritt fehlschlägt

| Fehler                                          | Was passiert ist                                                                                                                         |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Eine genannte Person ist kein Mitglied**      | Jemand, den der Schritt nennt, ist kein Mitglied der Organisation, oder die Mitgliedschaft ist deaktiviert. Niemand wird benachrichtigt. |
| **Der Lauf hat zu viele Nachrichten geschickt** | Mit dem Schritt hätte der Lauf mehr als 100 Nachrichten geschickt. Er hat gar nichts geschickt.                                          |

Ein Link, der weder eine Seite deiner Organisation noch eine `https://`-Adresse ist, lässt den Schritt fehlschlagen, bevor etwas geschickt wird.
