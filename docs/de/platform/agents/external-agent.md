---
title: Sandbox-Agenten
description: Züge, die ein Modell in einem Coding-Agent-Harness in isolierter Sandbox ausführen — welche Harnesses mitkommen, woher der Zugang stammt und was die Box erreicht.
---

Ein Sandbox-Agent ist ein Zug, der dein gewähltes Modell in einem Coding-Agent-Harness ausführt statt in der gewöhnlichen Chat-Schleife. Das Harness ist ein Kommandozeilen-Agent in einem isolierten Container: Er plant, schreibt Dateien, führt Befehle aus, installiert Pakete und berichtet zurück, und du sprichst im Chat mit ihm, während er arbeitet. Die Modellauswahl im Composer führt sie unter **Sandbox agents** auf, neben der Gruppe **Models**.

Diese Seite behandelt, was ein Sandbox-Zug ist, welche Harnesses mit Tale kommen, woher der Zugang stammt und was der Container erreichen darf und was nicht. Die Zugänge selbst sind Sache der Organisation — siehe [Provider](/de/platform/admin/providers).

## Was ein Sandbox-Zug ist

Wähl im Composer einen Sandbox-Agenten und beschreib die Aufgabe in normaler Sprache — „schreib ein kleines Python-CLI und teste es", „klon dieses Repository und behebe den Fehler aus Issue 42". Deine Nachricht geht an das Harness und nicht direkt an das Modell. Das Harness treibt das Modell in einer Schleife im Container an und entscheidet selbst, wann es eine Datei liest, einen Befehl ausführt oder es noch einmal versucht; die Antwort kommt, wenn sein Zug abgeschlossen ist.

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

**Ein Vendor-Abonnement** — ein Coding-Plan-Schlüssel, ein Portal-Schlüssel, ein OAuth-Blob oder ein Pool rotierender Tokens von einem Broker — funktioniert anders, weil Anbieter solche Zugänge nur für ihr eigenes Agenten-Werkzeug freigeben. Ein Abo-Zugang zwingt den Zug deshalb in eine Sandbox mit genau einem Harness: Ein gewöhnlicher Chat-Zug wird mit einer Begründung abgelehnt, die dieses Harness benennt, und ein anderes Harness ebenso. Das Geheimnis wird in die Umgebung der Sitzung gelegt, also in der Bring-your-own-Haltung, und das erzwungene Harness muss sie annehmen — OpenCode läuft nur über das Gateway und lehnt ab.

<Note>

Ein Sandbox-Zug benennt immer ein konkretes Harness. Nichts rät eines für dich: Der einzige Fall, in dem eines von selbst kommt, ist der Abo-Zugang, der seine erzwungene Wahl mitbringt.

</Note>

## Was die Sandbox erreicht

Der Container startet mit leerem Arbeitsverzeichnis und ist standardmäßig abgeriegelt. Dateien und Ordner, die du mit `@` anheftest, fahren unter `/user/uploads/` in die Sitzung mit, der Agent öffnet also die echten Bytes statt eines Such-Schnipsels, und was er unter `/user/output/` schreibt, kommt als Datei in den Chat zurück. Ausgehender Netzwerkverkehr ist bis auf eine schmale Freigabeliste gesperrt — Paketregister und GitHub —, der Agent kann also installieren, was er braucht, und ein öffentliches Repository klonen, ohne beliebige Hosts zu erreichen.

Angebundene Integrationen erreichen den Agenten über einen Broker statt über die Box. Ruft der Agent eine auf, geht die Anfrage zurück an Tale, das sie mit dem hinterlegten Zugang ausführt und nur das Ergebnis zurückgibt — ein kompromittierter Container kann deine Schlüssel also nicht lesen. Ein Schreibvorgang erscheint als Freigabekarte im Chat und läuft weiter, sobald du zustimmst. GitHub ist die bewusste Ausnahme: `git` und das `gh`-CLI brauchen lokal ein Token, eine Sitzung bekommt also ein eingeschränktes, das mit ihr endet.

An den Agenten gebundene Skills werden als Dateien in die Sitzung gelegt statt über ein Tool geholt, und ein Skill, den das ausgecheckte Repository mitbringt, gewinnt gegen die Kopie, die Tale legen würde — die Vorrangregel steht unter [Agent-Skills](/de/platform/agents/skills). Auch deine eigenen [Umgebungsvariablen und Geheimnisse](/de/platform/member/environment) werden im Container gesetzt; so kommt ein persönliches Token oder ein eigener Endpunkt zur Arbeit, ohne dass die Sitzung einer anderen Person es sieht.

## Kosten und Messung

Ein Sandbox-Zug kann lang sein und das Modell viele Male aufrufen, er kostet also mehr als eine einzelne Chat-Antwort. Verwaltete Züge laufen über das Gateway, und genau das macht sie messbar: Sie landen in der [Nutzungsanalyse](/de/platform/admin/governance/usage-analytics) neben jedem anderen Zug, und die [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits) der Organisation deckeln, was sie ausgeben dürfen.

Züge auf einem Abo-Zugang umgehen das Gateway von Bauart her, weil das Geheimnis in den Container geht und das Werkzeug des Anbieters direkt mit ihm spricht. Diese Züge werden nicht gemessen, und die Ausgabendeckel der Organisation greifen nicht — die Abrechnung liegt bei dem, dem das Abonnement gehört.

## Wo das hingehört

Ein Sandbox-Agent macht aus einem Chat eine laufende Sitzung mit einem Coding-Werkzeug in einem isolierten Container: Du steuerst in normaler Sprache, es arbeitet an echten Dateien, und das Harness bestimmt den Takt des Zuges. Wie viel davon unter der Kontrolle der Organisation bleibt, entscheidet der Zugang — ein hinterlegter Schlüssel hält den Zug am Gateway, unter den Deckeln und in der Messung, während ein Vendor-Abonnement ihn in die Box und auf das Konto dieses Anbieters schiebt. Lies diese Seite zusammen mit [Provider](/de/platform/admin/providers) für die Zugangsseite und [Integrationen](/de/platform/integrations/overview) für das, was der Agent im Betrieb erreichen kann.
