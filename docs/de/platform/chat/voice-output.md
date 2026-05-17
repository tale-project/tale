---
title: Sprachausgabe
description: Lass den Assistenten Antworten beim Streamen vorlesen — mit Pro-Thread-Override und einem konfigurierten Text-zu-Sprache-Anbieter.
---

Die Sprachausgabe liest die Antworten des Assistenten vor, während sie streamen. Jeder Satz wird synthetisiert, sobald er erscheint, sodass die Wiedergabe innerhalb von ein bis zwei Sekunden nach den ersten Worten startet — du wartest nicht auf die vollständige Antwort.

## Einschalten

Die Sprachausgabe ist standardmäßig aus. Es gibt zwei Stellen, an denen du sie steuerst:

- **Pro-Thread-Schalter.** Ein Lautsprecher-Symbol in der Chat-Kopfzeile (oben rechts, neben „Teilen"). Der Klick wechselt drei Zustände: _Folgt Standard_ (deine globale Voreinstellung), _explizit an_ (nur dieser Thread) und _explizit aus_ (nur dieser Thread).
- **Globaler Standard.** Unter **Einstellungen → Personalisierung → Sprachausgabe** kannst du den Standard einschalten. Neue Konversationen lesen dann Antworten vor, bis du sie in der Chat-Kopfzeile überschreibst.

Wenn du die Sprachausgabe in einer Sitzung zum ersten Mal aktivierst, schaltet der Klick gleichzeitig das Audio-System des Browsers frei. Ohne diese Geste verweigern Mobile Safari und strengere Chromium-Builds die automatische Wiedergabe; der Indikator auf jeder Nachricht zeigt dann „Sprachwiedergabe blockiert — tippe zum Abspielen", bis du tippst.

## Was vorgelesen wird

Die Sprachausgabe liest Antworten des Assistenten in deiner Oberflächensprache vor. Markdown-Auszeichnungen (fett, kursiv, Überschriften, Link-Syntax) werden entfernt und Codeblöcke übersprungen, damit du nicht „Sternchen Sternchen hallo Sternchen Sternchen" hörst oder ein Python-Skript vorgelesen bekommst. Satzzeichen, Zahlen und Abkürzungen bleiben erhalten.

## Wenn kein Anbieter konfiguriert ist

Die Sprachausgabe nutzt einen serverseitigen Text-zu-Sprache-Anbieter — einen Browser-`speechSynthesis`-Fallback gibt es nicht. Wenn deine Organisation kein TTS-Modell konfiguriert hat, ist der Schalter in der Personalisierung deaktiviert und der Link führt zu **Einstellungen → KI-Anbieter**, wo eine administrative Person einen hinzufügen kann. Siehe [Text-zu-Sprache-Anbieter konfigurieren](/de/self-hosted/configuration/providers#openai) für die Konfigurationsform.

Wenn die Synthese für einen einzelnen Satz fehlschlägt (Anbieter-5xx, vorübergehendes Timeout etc.), wird dieser Satz still übersprungen und die Wiedergabe läuft mit dem nächsten weiter. Der Antworttext am Bildschirm bleibt unabhängig davon lesbar.

## Stoppen und erneut abspielen

Während eine Nachricht vorgelesen wird, erscheint ein Stopp-Symbol in deren Toolbar. Stoppen pausiert sofort; eine später eintreffende neue Assistentennachricht wird trotzdem automatisch vorgelesen (der Schalter bleibt aktiv, bis du ihn umlegst).

Wenn du den Thread mitten in der Wiedergabe wechselst, stoppt das Audio sauber. Frühere Assistentennachrichten werden bei der Rückkehr **nicht** automatisch erneut abgespielt — du würdest denselben Inhalt zweimal hören. Nutze die Wiedergabe-Schaltfläche am Indikator, um eine einzelne Nachricht manuell erneut abzuspielen.

## Wie Fehler aussehen

| Indikator-Zustand                                    | Bedeutung                                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Animierter Lautsprecher                              | Wird gerade vorgelesen.                                                                                                                                                            |
| Ladekreisel                                          | Synthese läuft; noch kein Audio bereit.                                                                                                                                            |
| Stopp-Symbol                                         | Audio abspielbar; Vorlesen läuft.                                                                                                                                                  |
| Einfacher Lautsprecher                               | Audio bereit oder fertig; tippen zum (erneuten) Abspielen.                                                                                                                         |
| Bernsteinfarbener Lautsprecher „Tippe zum Abspielen" | Browser hat Autoplay blockiert. Tippe den Indikator an, um die Wiedergabe zu starten.                                                                                              |
| Rotes Warn-Symbol, „… fehlgeschlagen"                | Synthese ist bei jedem Versuch gescheitert. Hover für den klassifizierten Grund (kein Anbieter, Rate-Limit, Budget erreicht, vorübergehender Ausfall). Klick zum erneuten Versuch. |

Rate-Limit- und Rate-Limiter-Contention-Fehler werden bis zu zweimal mit exponentiellem Backoff automatisch wiederholt. Anbieter-5xx, Timeouts und andere Fehler (kein Anbieter konfiguriert, falsche Anmeldedaten, Budget überschritten) werden nicht automatisch wiederholt; der Indikator zeigt sie per Tooltip und du tippst zum erneuten Versuch. Der Antworttext bleibt am Bildschirm lesbar.

## Kosten und Quota

Jedes synthetisierte Zeichen wird beim konfigurierten Anbieter abgerechnet. Tales Budget-Richtlinie gilt für die Sprachausgabe genauso wie für den Chat: Die Synthese wird blockiert, sobald die Pro-Zeitraum-Kosten- oder Anfrage-Obergrenze erreicht ist. Die Plattform setzt zusätzlich Pro-Benutzer- und Pro-Organisations-Rate-Limits auf TTS durch, damit ein skriptbasierter Missbrauch ein Anbieter-Kontingent nicht erschöpfen kann.

Audio wird etwa sieben Tage lang im Convex-Speicher zwischengespeichert, das erneute Abspielen einer kürzlichen Nachricht löst also keine erneute Abrechnung aus. Danach werden Zeile und Blob durch einen täglichen Hintergrund-Sweep entfernt (mit einer opportunistischen Pro-Thread-Bereinigung über den Write-Pfad); die nächste Wiedergabe synthetisiert neu.

## Barrierefreiheit

Der Indikator meldet seinen Zustand über eine Screenreader-Live-Region („Spricht", „Gestoppt", „Sprachausgabe fehlgeschlagen"). Animationen respektieren `prefers-reduced-motion` — sowohl der Sprech-Puls als auch der Lade-Kreisel werden statisch, wenn reduzierte Bewegung aktiv ist. Der Schalter verwendet `aria-pressed="mixed"` für den Folgt-Standard-Zustand, damit assistive Technik die drei Positionen unterscheiden kann.

Wenn du einen Screenreader nutzt, lässt du die Sprachausgabe vielleicht besser aus — Screenreader und Assistentenstimme würden denselben Text vorlesen und sich gegenseitig überlagern.
