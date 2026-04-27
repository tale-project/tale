---
title: Bildgenerierungs-Agents
description: Agents konfigurieren, die mit FLUX, Imagen, Nano Banana, GPT-Image oder anderen kompatiblen Modellen Bilder erzeugen oder bearbeiten.
---

Bildgenerierungs-Agents nehmen einen Prompt, optional ein Referenzbild, und liefern als Assistant-Antwort ein neues Bild. Sie nutzen dieselbe Agent-Konfiguration wie Chat-Agents (Instructions, Wissen, Tools, Gesprächseinstiege), binden aber an ein Modell mit dem Tag `image-generation` oder `image-edit` statt an ein Chat-Modell. Denk an einen Agent für Marketing-Thumbnails, Produkt-Mockups, Social Cards oder schnelle Concept-Art — alles, was das Team in einer Nachricht erledigen will, statt einen vollen Bild-Editing-Workflow zu starten.

Im Chat-Modell-Picker erscheinen Bildgenerierungs-Agents neben den Chat-Agents. Sobald jemand einen wählt, schaltet der Composer in einen bildbewussten Modus: einen Thumbnail-Picker für Referenzbilder, einen Platzhalter mit dem Text _Beschreibe ein Bild, das erstellt werden soll…_ und eine Vorschau in der Assistant-Antwort.

## Bildgenerierungsmodi

Jedes Bild-Modell ist auf einen von zwei Aufruf-Modi verdrahtet. Der Modus wird pro Modell in **Einstellungen > KI-Anbieter** gesetzt und bestimmt, welchen OpenAI-kompatiblen Endpunkt Tale anspricht.

| Modus             | Endpunkt                 | Verwendet von                  | Bearbeitungspfad                                    |
| ----------------- | ------------------------ | ------------------------------ | --------------------------------------------------- |
| `images-api`      | `/v1/images/generations` | FLUX, Imagen, OpenAI DALL-E    | `/v1/images/edits` mit Referenzbild                 |
| `chat-multimodal` | `/v1/chat/completions`   | Nano Banana, GPT-Image, Gemini | Referenzbild als Content-Part in der User-Nachricht |

Wähle den Modus, den dein Anbieter dokumentiert. `images-api` ist einfacher — Input ist ein String, Output ein Bild — und funktioniert für jeden Anbieter, der das Schema des OpenAI-Images-Endpunkts ausspielt. `chat-multimodal` ist für Modelle wie Gemini erforderlich, die Bilder direkt aus dem Chat-Completion-Endpunkt liefern und Referenzbilder als Inline-Message-Parts erwarten.

## Modell beim Anbieter konfigurieren

Öffne **Einstellungen > KI-Anbieter**, bearbeite den Anbieter und füge ein Modell mit dem Tag `image-generation` hinzu (oder `image-edit`, wenn es bestehende Bilder überarbeiten kann). Für jedes Bild-Modell setzt du:

- **Image generation mode** — entweder `images-api` oder `chat-multimodal`. Tale zeigt unter dem Feld eine Hilfe-Zeile, die jeden Modus beschreibt; wähle den, den dein Anbieter dokumentiert.
- **Default-Modelle** — trage das bevorzugte Bild-Modell des Anbieters im Abschnitt **Default-Modelle** ein, damit Nutzer beim Wählen des Agents auf dem richtigen Modell landen.

Bild-Modelle werden pro generiertem Bild und nicht pro Token abgerechnet. Das Usage-Ledger erfasst Bildanzahl und etwaige Anbieter-Kosten daher getrennt von den Chat-Tokens.

## Bildgenerierungs-Agent anlegen

Starte mit **Agents > New Agent** und fülle die Basis aus — Name, Slug, Beschreibung. Im Tab **Instructions**:

- **Modell-Preset** — wähle das oben registrierte Bild-Modell. Im Picker erscheinen nur Modelle mit dem Tag `image-generation` oder `image-edit`.
- **System Instructions** — beschreibe, worin der Agent gut sein soll. _„Du erstellst minimalistische Marketing-Thumbnails: flache Farben, ein Motiv, kein Text-Overlay"_ steuert deutlich verlässlicher als gar keine Instructions.

Wissen, Tools, Gesprächseinstiege, Delegation und Webhook funktionieren wie bei Chat-Agents — siehe [Agent erstellen](/de/platform/agents/create).

## Im Chat verwenden

Wähle den Bildgenerierungs-Agent im Agent-Selector. Das Composer-Verhalten passt sich an:

- **Erstellen-Modus** — der Platzhalter lautet _Beschreibe ein Bild, das erstellt werden soll…_. Tippe einen Prompt und sende ihn.
- **Bearbeiten-Modus** — klicke auf ein Bild weiter oben im Thread, oder hänge ein Referenzbild über den Thumbnail-Picker an, dann wechselt der Platzhalter zu _Beschreibe die Änderung…_. Das Referenzbild geht an den Edit-Endpunkt (oder als Content-Part bei `chat-multimodal`-Modellen).
- **Modell kann nicht bearbeiten** — wenn das gewählte Modell nur `image-generation` ist, zeigt der Composer _Dieses Modell erstellt nur neue Bilder. Wechsle zu einem Editing-Modell, um Änderungen anzuwenden._ Wähle dann ein Modell mit dem Tag `image-edit`.

Erzeugte Bilder werden als Message-Anhänge gespeichert, folgen derselben Aufbewahrungsrichtlinie wie andere Anhänge und können heruntergeladen, im Canvas geöffnet oder als Edit-Vorlage für Folgeanfragen wiederverwendet werden.
