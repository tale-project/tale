---
title: Bildgenerierungs-Agents
description: Agents konfigurieren, die Bilder mit FLUX, Imagen, Nano Banana, GPT-Image oder einem kompatiblen Modell erzeugen oder bearbeiten.
---

Bildgenerierungs-Agents nehmen einen Prompt, optional ein Referenzbild, und liefern als Assistant-Antwort ein Bild. Sie nutzen die Standard-Agent-Konfiguration — Anweisungen, Wissen, Tools, Gesprächseinstiege — sind aber an ein Modell mit Tag `image-generation` oder `image-edit` gebunden statt an ein Chat-Modell. Stell dir einen Agent für Marketing-Thumbnails, Produkt-Mockups, Social-Cards oder schnelle Concept-Art vor — was das Team in einer Ein-Nachricht-Hin-und-Rück erledigen will statt in einem vollen Bildbearbeitungs-Workflow.

Der Modell-Picker im Chat zeigt Bildgenerierungs-Agents neben Chat-Agents. Wählt ein Nutzer einen, schaltet der Composer in einen bildbewussten Modus: einen Thumbnail-Picker für Referenzbilder, einen Platzhalter mit dem Text _Beschreibe ein Bild, das erstellt werden soll…_ und einen Vorschau-Bereich an den Assistant-Antworten.

## Die zwei Aufruf-Modi

Jedes Bild-Modell ist auf einen von zwei Aufruf-Modi verdrahtet. Der Modus wird pro Modell auf der Konfigurationsseite des Anbieters gesetzt und entscheidet, welchen OpenAI-kompatiblen Endpunkt Tale anspricht.

| Modus             | Endpunkt                 | Verwendet von                  | Bearbeitungspfad                                     |
| ----------------- | ------------------------ | ------------------------------ | ---------------------------------------------------- |
| `images-api`      | `/v1/images/generations` | FLUX, Imagen, OpenAI DALL-E    | `/v1/images/edits` mit Referenzbild.                 |
| `chat-multimodal` | `/v1/chat/completions`   | Nano Banana, GPT-Image, Gemini | Referenzbild als Content-Part in der User-Nachricht. |

Wähle den Modus, den die Dokumentation deines Anbieters beschreibt. `images-api` ist einfacher — Eingabe ist ein String, Ausgabe ein Bild — und funktioniert für jeden Anbieter, der das Schema des OpenAI-Images-Endpunkts ausspielt. `chat-multimodal` ist nötig für Modelle wie Gemini, die Bilder direkt aus dem Chat-Completion-Endpunkt emittieren und Referenzbilder als Inline-Message-Parts annehmen.

## Modell beim Anbieter registrieren

Öffne **Einstellungen > KI-Anbieter**, bearbeite den Anbieter und füge ein Modell mit dem Tag `image-generation` hinzu (oder `image-edit`, wenn das Modell ein vorhandenes Bild überarbeiten kann). Setze für jedes Bild-Modell den **Image-Generation-Modus** — `images-api` oder `chat-multimodal` — und trage im Abschnitt **Default-Modelle** das bevorzugte Bild-Modell des Anbieters ein, damit Nutzer beim Öffnen des Agents auf dem richtigen Modell landen.

Bild-Modelle werden pro erzeugtem Bild abgerechnet, nicht pro Token. Das Usage-Ledger erfasst die Bild-Anzahl und etwaige anbieterseitige Kosten getrennt von Chat-Tokens.

## Bildgenerierungs-Agent anlegen

Öffne **Agents > Agent erstellen** und fülle die Basis aus — Anzeigename, Name, Beschreibung. Wähle auf dem Tab **Anweisungen & Modell** das oben registrierte Bild-Modell als Modell des Agents; im Picker erscheinen nur Modelle mit Tag `image-generation` oder `image-edit`. Schreibe einen System-Anweisungs-Block, der beschreibt, worin der Agent gut sein soll — _„Du erzeugst minimalistische Marketing-Thumbnails: flache Farben, ein Motiv, kein Text-Overlay"_ steuert deutlich verlässlicher als gar keine Anweisungen.

Wissen, Tools, Starter, Delegation und Workers funktionieren wie bei Chat-Agents. Siehe [Agent erstellen](/de/platform/agents/create) für den vollen Bau-Flow.

## Im Chat nutzen

Wähle den Bildgenerierungs-Agent im Agent-Selector, und das Composer-Verhalten passt sich an. Im **Erstellen-Modus** lautet der Platzhalter _Beschreibe ein Bild, das erstellt werden soll…_; tippe einen Prompt und sende. Um in den **Bearbeiten-Modus** zu wechseln, klicke auf ein Bild weiter oben im Thread oder hänge ein Referenzbild über den Thumbnail-Picker an; der Platzhalter wechselt zu _Beschreibe die Änderung…_ und das Referenzbild geht an den Edit-Endpunkt (oder als Content-Part bei `chat-multimodal`-Modellen). Wenn das aktive Modell nur Erzeugung unterstützt, liest der Composer _Dieses Modell erzeugt nur neue Bilder. Wechsle zu einem Editing-Modell, um Änderungen anzuwenden._ — wähle dann ein Modell mit dem Tag `image-edit`.

Erzeugte Bilder werden als Nachrichten-Anhänge gespeichert, folgen derselben Aufbewahrungsrichtlinie wie andere Anhänge und können heruntergeladen, in Canvas geöffnet oder als Bearbeitungseingabe für Folge-Runden wiederverwendet werden.

## Wo das einsetzt

Bildgenerierungs-Agents sind die Ein-Runden-Bild-Oberfläche im Chat — ein schneller Weg, ein Marketing-Thumbnail, ein Produkt-Mockup, eine Konzept-Skizze zu erzeugen. Sie ersetzen kein dediziertes Bildbearbeitungs-Tool; der Tradeoff ist Geschwindigkeit und konversationelle Erreichbarkeit, nicht Pixel-genaue Kontrolle. Für teamweite Bild-Workflows, die Iterations-Tracking brauchen, ist ein Agent, der per [Integration](/de/platform/integrations/overview) an einen externen Bild-Dienst übergibt, die bessere Wahl.

Um die zugrunde liegenden Modelle zu konfigurieren, richtet ein Admin Modell-Tags `image-generation` und `image-edit` unter [KI-Anbieter](/de/platform/admin/providers) ein.
