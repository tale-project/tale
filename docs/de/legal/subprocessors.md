---
title: Unterauftragsverarbeiter
description: Finde die maßgebliche Liste für Tale Cloud und unterscheide Hosting, Modellanbieter und eigene Integrationen.
noindex: true
---

Ein Unterauftragsverarbeiter ist ein Dritter, der im Auftrag eines Kunden personenbezogene Daten verarbeitet. **Anhang A des [Auftragsverarbeitungsvertrags (DPA)](https://tale.dev/de/legal/data-processing-agreement)** ist die maßgebliche Liste für Tale Cloud. Er nennt die juristischen Personen, Dienste, Verarbeitungsorte und Datenkategorien. Verwende diesen Anhang zusammen mit deinem Vertrag für Beschaffung und Datenschutzprüfung.

## Die Liste nach Dienst lesen

Der veröffentlichte Anhang unterscheidet Plattformhosting und KI-Verarbeitung. Er führt **Akenes SA (Exoscale)** für Infrastruktur und **OpenRouter, Inc.** für KI-Aufrufe über diesen Dienst auf. Der eingetragene Sitz eines Anbieters ist nicht dasselbe wie der vertragliche Verarbeitungsort.

| Was du prüfst | Wo du nachsiehst |
| --- | --- |
| Hostingregion und Wiederherstellungsstandort | In den Tabellen für Kunden in EU/EWR und Schweiz sowie in deinem Servicevertrag |
| Daten für Modellaufrufe, Transkription oder Bildfunktionen | In den Spalten zu Diensten und Datenkategorien sowie im KI-Abschnitt des DPA |
| Über einen Vermittler erreichte Modellanbieter | In den Hinweisen zu nachgelagerten Anbietern und in den Bedingungen des Vermittlers |
| Einschränkungen beim Modelltraining | In Abschnitt 5 des DPA, einschließlich der gesonderten schriftlichen Einwilligung |
| Änderungen der Liste und Widerspruchsverfahren | In Abschnitt 6 des DPA; beachte die Bedingungen für Mitteilungen und deren Bezug |
| Sicherheitsnachweise | Bei den Trust-Links im Anhang und im [Vertrauensleitfaden von Tale](/de/cloud/trust-and-compliance) |

## Integrationen deiner Organisation berücksichtigen

Die Administration kann weitere Modellanbieter und Connectors einrichten. Prüfe deren Ziele und Bedingungen im Rahmen der Datenverarbeitung deiner Organisation. Tales vertragliche Cloud-Liste ist kein Verzeichnis aller Dienste, die deine Organisation selbst verbinden kann.

Ein Chat mit einem externen Modell sendet beispielsweise die für den Aufruf benötigten Eingaben an den eingerichteten Anbieter. Ein Connector kann eine Suchanfrage oder Aktionsparameter an ein anderes System senden. Hochgeladene Dokumente können außerdem vom konfigurierten Embedding-Dienst verarbeitet werden. Der [Leitfaden zur Datenresidenz](/de/cloud/data-residency) erklärt diese getrennten Wege.

## Wenn du Tale selbst betreibst

Dein Betreiber wählt Hosting, Modellanbieter, Objektspeicher und Integrationen. Die Cloud-Anbieterliste beschreibt diese Installation nicht automatisch. Nutze die [Referenz zur Datenresidenz selbst betriebener Instanzen](/de/self-hosted/configuration/data-residency), um die Konfiguration zu prüfen und eure Verarbeitungsorte zu dokumentieren.

Stelle für eine Prüfung den aktuellen DPA, deinen Servicevertrag, die geltenden Datenschutzhinweise und die passenden Sicherheitsnachweise zusammen. Für Rückfragen oder zusätzliche Nachweise nutze den im DPA genannten Kontaktweg zu Tale.
