---
title: Harnesses
description: Coding-CLIs, die ein Modell in einer isolierten Sandbox ausführen — welche Harnesses mitkommen, wo du eines wählst, woher der Zugang stammt und was die Box erreicht.
---

Ein **Harness** ist eine mitgelieferte Coding-CLI — Claude Code, Codex, Cursor und weitere —, die dein gewähltes Modell in einem isolierten Container ausführt statt in der gewöhnlichen Chat-Schleife. Das Harness plant, schreibt Dateien, führt Befehle aus, installiert Pakete und berichtet zurück. Im Chat-Composer wählst du kein Harness: Chat wählt nur ein **Modell**. Das Harness legst du fest, wenn du einen **Projekt-Agenten** oder einen Automation-**Agent**-Knoten anlegst — beide Oberflächen nennen das Feld **Agent-Laufzeit**.

Diese Seite behandelt, welche Harnesses mit Tale kommen, wo du eines bindest, woher der Zugang stammt und was der Container erreichen darf und was nicht. Die Zugänge selbst sind Sache der Organisation — siehe [Provider](/de/platform/admin/providers). Unter **Einstellungen > KI-Anbieter** zeigt der Abschnitt **Harnesses**, wie jedes Harness für die Organisation aufgelöst würde.

## Wo du ein Harness wählst

Öffne den Tab **Agenten** eines Projekts und leg einen Agenten an oder bearbeite einen. Der Dialog fragt nach einer **Agent-Laufzeit** — dem Harness, der Coding-CLI, auf der dieser Agent läuft — neben Modell, Ausrüstung und Anweisungen. Weist du diesem Agenten eine Board-Aufgabe zu, arbeitet er in einer Sandbox auf genau diesem Harness.

In einer Automation trägt ein **Agent**-Knoten dasselbe Feld **Agent-Laufzeit**. Erreicht der Workflow diesen Knoten, läuft der Zug auf dem gewählten Harness.

Chat listet keine Harnesses. Die Auswahl im Composer ist nur Modelle; Harness-Arbeit kommt über einen Projekt-Agenten oder einen Automation-Agent-Knoten, nicht über eine Composer-Gruppe.

## Was ein Harness-Zug ist

Beschreib die Aufgabe in normaler Sprache — „schreib ein kleines Python-CLI und teste es", „klon dieses Repository und behebe den Fehler aus Issue 42". Die Nachricht geht an das Harness und nicht direkt an das Modell. Das Harness treibt das Modell in einer Schleife im Container an und entscheidet selbst, wann es eine Datei liest, einen Befehl ausführt oder es noch einmal versucht; die Antwort kommt, wenn sein Zug abgeschlossen ist.

Daraus folgen zwei Dinge. Die Arbeit ist echt und nicht beschrieben: Dateien existieren, Befehle sind tatsächlich gelaufen, und ihre Ausgabe ist das, worüber das Modell nachgedacht hat. Und die Form des Zuges gehört dem Harness, nicht Tale — ein Harness mit Plan-Modus endet mit einem Vorschlag, den du prüfen kannst, eines für einzelne Durchläufe läuft schlicht durch.

## Die mitgelieferten Harnesses

Neun Harnesses kommen mit der Plattform. Sie unterscheiden sich darin, wie sie einen Prompt entgegennehmen, ob sie sich mitten im Zug lenken lassen und ob sie MCP-Server erreichen.

| Harness     | Akzeptierte Zugänge         | Wissenswertes                                                                                                                    |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Verwaltet oder dein eigener | Das leistungsfähigste: mitten im Zug lenkbar, mit einem Plan-Modus, der in einem prüfbaren Vorschlag endet. Erreicht MCP-Server. |
| Codex       | Verwaltet oder dein eigener | Einzelne Durchläufe. Erreicht MCP-Server.                                                                                        |
| Cursor      | Nur dein eigener            | Einzelne Durchläufe. Sein CLI kann nicht über das Gateway der Plattform laufen, ein verwalteter Zugang wird also abgelehnt.      |
| Gemini CLI  | Verwaltet oder dein eigener | Einzelne Durchläufe. Erreicht MCP-Server.                                                                                        |
| Hermes      | Verwaltet oder dein eigener | Einzelne Durchläufe, ohne MCP-Kanal.                                                                                             |
| OpenClaw    | Verwaltet oder dein eigener | Einzelne Durchläufe. Erreicht MCP-Server.                                                                                        |
| OpenCode    | Nur verwaltet               | Einzelne Durchläufe. Erreicht MCP-Server. Läuft über das Gateway, ein eigener Schlüssel wird abgelehnt.                          |
| Pi          | Verwaltet oder dein eigener | Einzelne Durchläufe, ohne MCP-Kanal.                                                                                             |
| Qwen Code   | Verwaltet oder dein eigener | Einzelne Durchläufe. Erreicht MCP-Server.                                                                                        |

In der Praxis macht sich der Unterschied beim Lenken bemerkbar. Bei Claude Code erreicht eine Korrektur, die du während des laufenden Zuges schickst, den Agenten an seiner nächsten Tool-Grenze — „nimm pnpm, nicht npm" landet also, während die Arbeit noch läuft. Jedes andere Harness nimmt eine wartende Nachricht erst an der Zuggrenze auf.

## Woher der Zugang stammt

Der Zugang gehört der Organisation, nicht dem Agenten. Ein Agent hält keine eigenen Schlüssel, und es gibt keinen Zugangs-Tab pro Agent; womit sich ein Zug ausweist, ergibt sich aus dem Provider-Zugang hinter dem Modell, das du gewählt hast, eingerichtet unter [Provider](/de/platform/admin/providers). Welche von zwei Haltungen ein Zug einnimmt, folgt daraus, welche Art von Zugang das ist.

**Ein hinterlegter API-Schlüssel oder einer aus einer Umgebungsvariable der Installation** bleibt bei der Plattform. Tale erzeugt für den Zug einen auf die Sitzung begrenzten Gateway-Schlüssel, und das Harness weist sich damit aus statt mit dem echten Geheimnis — der Container hält also nie einen Zugang, der die Sitzung überdauert. Das ist die verwaltete Haltung, und das einzige Harness, das sie ablehnt, ist Cursor.

**Ein Vendor-Abonnement** — ein Coding-Plan-Schlüssel, ein Portal-Schlüssel, ein OAuth-Blob oder ein Pool rotierender Tokens von einem Broker — funktioniert anders, weil Anbieter solche Zugänge nur für ihr eigenes Agenten-Werkzeug freigeben. Ein Abo-Zugang zwingt den Zug deshalb auf genau ein Harness: Ein gewöhnlicher Chat-Zug wird mit einer Begründung abgelehnt, die dieses Harness benennt, und ein anderes Harness ebenso. Das Geheimnis wird in die Umgebung der Sitzung gelegt, also in der Bring-your-own-Haltung, und das erzwungene Harness muss sie annehmen — OpenCode läuft nur über das Gateway und lehnt ab.

<Note>

Ein Harness-Zug benennt immer ein konkretes Harness. Nichts rät eines für dich: Der einzige Fall, in dem eines von selbst kommt, ist der Abo-Zugang, der seine erzwungene Wahl mitbringt.

</Note>

## Was die Sandbox erreicht

Der Container startet mit leerem Arbeitsverzeichnis. Dateien und Ordner, die du mit `@` anheftest, fahren unter `/agent/uploads/` in die Sitzung mit, der Agent öffnet also die echten Bytes statt eines Such-Schnipsels, und was er unter `/agent/output/` schreibt, kommt als Datei in den Chat zurück. Ausgehender Netzwerkverkehr ist standardmäßig offen, die gefährlichen Ziele sind immer gesperrt — der Cloud-Metadaten-Endpunkt und private Adressbereiche —, der Agent kann also Pakete installieren und Repositories klonen, ohne je das Host-Netz zu erreichen; ein Self-hosted-Betreiber kann den Egress auf Deployment-Ebene auf eine Hostnamen-Freigabeliste verengen.

Angebundene Connectors erreichen den Agenten über einen Broker statt über die Box. Ruft der Agent eine auf, geht die Anfrage zurück an Tale, das sie mit dem hinterlegten Zugang ausführt und nur das Ergebnis zurückgibt — ein kompromittierter Container kann deine Schlüssel also nicht lesen. Ein Schreibvorgang erscheint als Freigabekarte im Chat und läuft weiter, sobald du zustimmst. GitHub ist die bewusste Ausnahme: `git` und das `gh`-CLI brauchen lokal ein Token; ein Zug läuft also mit einem eingeschränkten, solange die Unterhaltung den GitHub-Connector ausgerüstet hat — es kommt pro Zug hinein und verschwindet mit dessen Ende.

An den Agenten gebundene Skills werden als Dateien in die Sitzung gelegt statt über ein Tool geholt, und ein Skill, den das ausgecheckte Repository mitbringt, gewinnt gegen die Kopie, die Tale legen würde — die Vorrangregel steht unter [Agent-Skills](/de/platform/agents/skills). Auch deine eigenen [Umgebungsvariablen und Geheimnisse](/de/platform/member/environment) werden im Container gesetzt; so kommt ein persönliches Token oder ein eigener Endpunkt zur Arbeit, ohne dass die Sitzung einer anderen Person es sieht.

## Kosten und Messung

Ein Harness-Zug kann lang sein und das Modell viele Male aufrufen, er kostet also mehr als eine einzelne Chat-Antwort. Verwaltete Züge laufen über das Gateway, und genau das macht sie messbar: Sie landen in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) neben jedem anderen Zug, und die [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) der Organisation deckeln, was sie ausgeben dürfen.

Züge auf einem Abo-Zugang umgehen das Gateway von Bauart her, weil das Geheimnis in den Container geht und das Werkzeug des Anbieters direkt mit ihm spricht. Diese Züge werden nicht gemessen, und die Ausgabendeckel der Organisation greifen nicht — die Abrechnung liegt bei dem, dem das Abonnement gehört.

## Wo das hingehört

Ein Harness macht aus einem Projekt-Agenten oder einem Automation-Agent-Knoten eine laufende Sitzung mit einem Coding-Werkzeug in einem isolierten Container: Du steuerst in normaler Sprache, es arbeitet an echten Dateien, und das Harness bestimmt den Takt des Zuges. Chat wählt nur Modelle; das Feld **Harness** sitzt am Agenten oder am Automation-Knoten. Wie viel davon unter der Kontrolle der Organisation bleibt, entscheidet der Zugang — ein hinterlegter Schlüssel hält den Zug am Gateway, unter den Deckeln und in der Messung, während ein Vendor-Abonnement ihn in die Box und auf das Konto dieses Anbieters schiebt. Lies diese Seite zusammen mit [Provider](/de/platform/admin/providers) für die Zugangsseite und [Connectors](/de/platform/connectors/overview) für das, was der Agent im Betrieb erreichen kann.
