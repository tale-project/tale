---
title: Genehmigungen konfigurieren
description: Referenz für die Genehmigungs-Regeln, die ein Admin oder Redakteur an einen Agent, eine Integration oder einen Workflow-Schritt hängen kann — wann eine Genehmigung verlangt wird, wer entscheidet, was bei Timeout passiert.
---

Genehmigungs-Regeln sind die Konfiguration hinter jeder Genehmigungs-Karte, die Tale zeigt. Sie benennen, was eine Genehmigung auslöst, wer im Genehmiger-Pool ist und was passiert, wenn niemand rechtzeitig entscheidet. Admins konfigurieren organisationsweite Richtlinien; Redakteure konfigurieren per-Agent- und per-Workflow-Gates. Diese Seite ist die Referenz für die Felder, die du auf jeder Regel setzt, und was sie am laufenden Produkt ändern.

Das Mentalmodell der Genehmigungen — was eine Karte ist, was eine Genehmigung hinterlässt, die vier Auslöser-Quellen — liegt auf [Genehmigungs-Konzepte](/de/platform/approvals/concepts). Was folgt, ist die Konfigurations-Oberfläche: wo die Regeln liegen, die Per-Regel-Felder und wie Regeln komponieren, wenn zwei gleichzeitig feuern.

## Eine durchgespielte Regel

Um eine Genehmigung zu verlangen, bevor ein Agent in die Kundendatenbank schreibt, öffne **Einstellungen > Richtlinien > Genehmigungs-Regeln** und klick auf **Neue Regel**. Wähl die Ressource (`Kunden — Schreiben`), wähl den Auslöser (`Jeder Agent`), wähl den Genehmiger-Pool (`Team: Betrieb`), setz den Timeout (`24h`) und die Timeout-Aktion (`Ablehnen`). Speichern. Beim nächsten Mal, wenn irgendein Agent einen Kunden anlegen oder bearbeiten will, wird der Schreibvorgang gehalten, eine Genehmigungs-Karte landet im Inbox des Betriebs-Teams, und der Lauf läuft nur weiter, wenn jemand innerhalb des Tages auf Genehmigen klickt.

Die Regel ist sofort wirksam; laufende Schreibvorgänge werden fertig, der nächste wird gehalten. Die Regel zu entfernen, hebt den Halt auf zukünftige Schreibvorgänge auf; bestehende ausstehende Genehmigungen bleiben ausstehend, bis sie aufgelöst werden.

## Wo Regeln liegen

Drei Konfigurations-Oberflächen erzeugen Genehmigungs-Regeln; jede schreibt in dieselbe darunterliegende Regel-Tabelle.

- **Einstellungen > Richtlinien > Genehmigungs-Regeln** ist die organisationsweite Oberfläche. Admins erstellen Regeln, die für eine Ressource gelten (Dokumente, Kunden, Produkte, Integrationen, MCP-Server, Agent-Erstellung, Skill-Installation), und wählen das Auslöser-Muster (beliebiger Akteur, bestimmte Rollen, bestimmte Teams, bestimmte Agents).
- **Der Governance-Tab des Agent-Editors** lässt einen Redakteur eine agent-spezifische Regel anhängen. Die Regel feuert nur für die Aufrufe dieses Agents; sie komponiert mit jeder organisationsweiten Regel, die ebenfalls greift.
- **Das Genehmigungs-Gate eines Workflow-Schritts** lässt den Workflow-Autor an einem bestimmten Schritt eine Genehmigung verlangen. Das ist die Oberfläche [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows); das Gate schreibt eine einmalige, auf den Schritt skopierte Regel.

Eine Ressource kann mehrere Regeln aktiv haben; die Engine fährt sie alle, und die Aktion wird gehalten, bis jede zutreffende Regel genehmigt. Eine Ablehnung aus irgendeiner Regel beendet die Aktion.

## Per-Regel-Felder

Jede Regel trägt dieselbe Form, egal wo sie autorisiert wurde.

| Feld                     | Pflicht                   | Beschreibung                                                                                                                                                                                                                |
| ------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                     | Ja                        | Menschliches Label auf Karten und im Audit. Wähl etwas, das der Genehmiger wiedererkennt.                                                                                                                                   |
| Ressource                | Ja                        | Das, was sich ändert: ein Wissensdatenbank-Typ (Dokumente, Kunden, Produkte, Lieferanten, Websites), ein Integrationsaufruf (`Integrationen > Ausgehend`), Agent-Erstellung, Skill-Installation oder ein Workflow-Schritt.  |
| Auslöser-Muster          | Ja                        | Wer handelt: beliebiger Akteur, eine bestimmte Rolle, ein bestimmtes Team, ein bestimmter Agent. Restriktive Muster engen die Reichweite der Regel ein.                                                                     |
| Genehmiger-Pool          | Ja                        | Die berechtigte Menge: ein Team, eine Rolle oder eine explizite Mitgliederliste. Der erste berechtigte Genehmiger, der klickt, entscheidet.                                                                                 |
| Anforderer ausschliessen | Standard                  | Der Akteur, der die Aktion ausgelöst hat, wird aus dem Pool entfernt. Standardmässig an; das auszuschalten ist selten die richtige Wahl.                                                                                    |
| Timeout                  | Ja                        | Das Fenster, bevor die Timeout-Aktion feuert. Tale unterstützt Minuten, Stunden und Tage.                                                                                                                                   |
| Timeout-Aktion           | Ja                        | Was passiert, wenn das Fenster ohne Entscheidung schliesst: `Ablehnen` (die Aktion wird verworfen), `Eskalieren` (an einen Fallback-Pool routen) oder `Genehmigen` (Auto-Freigabe — nur bei risikoarmen Ressourcen sicher). |
| Eskalations-Pool         | Wenn Timeout = Eskalieren | Der Pool, der bei Eskalation die Karte erhält. Gleiche Form wie Genehmiger-Pool.                                                                                                                                            |
| Kommentar-Richtlinie     | Standard                  | Ob der Genehmiger einen Kommentar darf, muss oder nicht hinterlassen darf. Standard ist „darf".                                                                                                                             |

## Wie mehrere Regeln komponieren

Wenn eine einzelne Aktion mehr als eine Regel trifft, wertet Tale sie parallel aus. Die Aktion wird gehalten, bis jede Regel aufgelöst ist; ein Genehmigen auf einer reicht nicht, wenn eine zweite noch ausstehend ist. Ein Ablehnen auf irgendeiner Regel beendet die Aktion und schreibt die Ablehnung ins Audit-Log. Das ist Absicht — die strengste anwendbare Regel gewinnt, und eine erlaubende Regel kann eine strengere nicht versehentlich überschreiben.

Wenn zwei Regeln denselben Genehmiger-Pool treffen, sieht der Genehmiger eine Karte pro Regel; jede zu entscheiden ist erforderlich. Die Karten verlinken aufeinander, damit der Genehmiger die volle Menge der Holds sieht, bevor er entscheidet.

## Audit und Verlauf

Jede Regel-Änderung landet im Audit-Log mit Akteur, Zeitstempel und Diff. Die Audit-Zeile verfolgt zusätzlich jede Genehmigung, die die Regel erzeugt hat — Akteur, Entscheidung, Kommentar und Auflösungszeit jeder Karte. Greif auf die Audit-Sicht der Regel zu (der **Verlauf**-Tab auf der Zeile der Regel), wenn du sehen willst, wie oft die Regel feuert und wie lange Genehmiger typischerweise brauchen.

## Wo das hingehört

Genehmigungs-Regeln sind die Konfigurations-Ebene hinter [Genehmigungs-Konzepten](/de/platform/approvals/concepts); die Workflow-Gate-Variante hat ihre eigene Oberfläche unter [Genehmigungen in Workflows](/de/platform/automations/approvals-in-workflows). Die natürliche nächste Lektüre hängt davon ab, was du verdrahtest — für Workflow-Gates die Workflow-Seite, für Agent-Schreib-Genehmigungen die [Admin-Sicht der Agents](/de/platform/admin/agents), wo die Per-Agent-Steuerung liegt.
