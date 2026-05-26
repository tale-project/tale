---
title: Tutorials
description: Aufgabenorientierte End-to-End-Anleitungen für jede Tale-Rolle.
---

Der Tutorials-Bereich ist die Schicht der durchgespielten Beispiele in der Tale-Dokumentation. Jede Seite nimmt ein einzelnes Ergebnis — einen Agent, der Produkt-Support-Fragen beantwortet, ein Skript, das Tale aus einem CI-Job aufruft, ein Office-Add-in, das durch deine Instanz läuft — und führt jeden Schritt durch, der nötig ist, um auf einer frischen Instanz dort anzukommen. Die Tutorials stehen neben der Referenz unter [Platform](/de/platform): die Referenz beschreibt, was jede Funktion isoliert tut, die Tutorials zeigen, wie man Funktionen zu einem konkreten Ergebnis kombiniert.

Die Tutorials sind nach der Rolle gruppiert, der die Aufgabe gehört, damit du auf Inhalt landest, den du mit deinen Berechtigungen wirklich ausführen kannst. Berechtigungen folgen dem [Sechs-Rollen-Modell](/de/platform/admin/members-and-roles) — liegt ein Tutorial unter Admin, brauchst du einen Admin- oder Inhaber-Platz, um es abzuschliessen.

## Wie ein Tutorial aufgebaut ist

Jedes Tutorial folgt derselben Form: eine kurze Einleitung, die Ergebnis und Voraussetzungen benennt, ein **Bevor du beginnst**-Abschnitt mit den genauen Anforderungen, nummerierte Schritte mit jeweils einer Aktion und einer Verifikationszeile, ein **Fehlerbehebung**-Abschnitt für die drei oder vier Probleme, die wirklich auftreten, und ein Abschluss, der nennt, wo der Baustein als Nächstes greift. Integrationen-Tutorials (Office-Add-in, Meetily, lokaler Anbieter) tragen einen zusätzlichen **Datenschutz-Hinweise**- oder **Vertrauensgrenze**-Abschnitt, der benennt, was in jede Richtung über das Netz geht.

Wenn ein Schritt aussieht, als täte er zwei Dinge gleichzeitig, lies ihn nochmal — jeder Schritt hat eine Aktion und eine Verifikation. Einen Abschnitt zu überspringen in der Annahme, die Voraussetzung sei schon erfüllt, ist die häufigste Art, wie ein Tutorial auf halber Strecke kippt; der nächste Schritt hängt meist an genau dem Feld, das der übersprungene konfiguriert.

## Seiten in diesem Bereich

- **[Effektiv chatten](/de/tutorials/member/chat-effectively)** — Tutorial für die Mitglied-Rolle, das Agent-Auswahl, Anhänge, Diktat und Canvas zu einem täglichen Chat-Workflow verbindet.
- **[Den ersten Agent end-to-end bauen](/de/tutorials/editor/first-agent-end-to-end)** — Tutorial für die Redakteur-Rolle, das dich von einer leeren Agent-Seite zu einem versionierten, wissensgescopten Agent führt, den dein Team im Chat auswählen kann.
- **[Tale aus einem Skript aufrufen](/de/tutorials/developer/call-tale-from-a-script)** — Tutorial für die Entwickler-Rolle, das eine Chat-Anfrage aus cURL und Python gegen Tales OpenAI-kompatible API absetzt.
- **[Eine Automatisierung per Webhook auslösen](/de/tutorials/developer/trigger-automation-via-webhook)** — Tutorial für die Entwickler-Rolle, das ein externes System über die eindeutige Webhook-URL in einen Tale-Workflow einbindet.
- **[Word- & Excel-Add-in](/de/tutorials/admin/office-add-in)** — Integrationen-Tutorial für die Admin-Rolle, das ein sideloaded KI-Panel in Microsoft 365 durch einen Tale-Agent routet.
- **[Meeting-Transkription](/de/tutorials/admin/meeting-transcription)** — Integrationen-Tutorial für die Admin-Rolle, das Tale mit Meetily verbindet, sodass das rohe Audio auf dem Laptop bleibt und nur das Transkript deine Instanz erreicht.
- **[Lokalen Anbieter verbinden](/de/tutorials/admin/connect-local-provider)** — Integrationen-Tutorial für die Admin-Rolle, das Ollama oder vLLM als Tale-KI-Anbieter hinzufügt, sodass die Modell-Inferenz in deinem Netzwerk bleibt.

## Wo das einsetzt

Die Tutorials decken die vier kanonischen Einstiege in Tale ab — Mitglied, Redakteur, Entwickler, Admin — plus drei Integrationen darauf. Für das konzeptionelle Modell hinter jedem Tutorial ist die entsprechende Seite unter [Platform](/de/platform) die Referenz; für die API- und SDK-Oberflächen, auf denen die Entwickler-Tutorials aufbauen, ist [Develop](/de/develop/api-reference) einen Tab weiter.
