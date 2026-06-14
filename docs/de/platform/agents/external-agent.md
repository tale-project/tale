---
title: Externe Agenten
description: Der integrierte Agent Claude Code, der in einer isolierten Sandbox läuft; du chattest direkt mit ihm, während er Dateien bearbeitet, Befehle ausführt und die Arbeit über mehrere Runden fortsetzt.
---

Tale liefert einen integrierten **externen Agenten** — **Claude Code** —, dessen gesamte Runde in einer isolierten Sandbox läuft. Statt der normalen Chat-Schleife wird deine Nachricht an diesen Coding-Agenten übergeben, der in einem frischen Container lebt, Dateien bearbeitet, Befehle ausführt und zurückmeldet. Du sprichst im Chat direkt mit ihm, und er behält dasselbe Arbeitsverzeichnis und denselben Gesprächsverlauf über mehrere Runden, sodass eine Folgeanweisung wie „füge jetzt einen Test dafür hinzu" dort weitermacht, wo er aufgehört hat.

Es ist dieselbe Idee, als würde man ein solches Werkzeug auf einer entfernten Maschine ausführen — nur ist die Maschine eine verwaltete Sandbox, die der Workspace kontrolliert. Diese Seite behandelt, wie du ihn nutzt, was die Sandbox erreichen kann und was nicht, und wie abgerechnet wird.

## Mit einem Coding-Agenten sprechen

Wähle im Chat-Auswahlmenü **Claude Code** und beschreibe eine Aufgabe in normaler Sprache — „schreibe ein kleines Python-CLI und teste es", „klone dieses Repo und behebe den Fehler in Issue #42". Der Agent arbeitet in seiner Sandbox: Er plant, schreibt Dateien, führt Shell-Befehle aus und installiert bei Bedarf Pakete, dann antwortet er mit dem, was er getan hat. Während er arbeitet, siehst du eine Denkanzeige; die Antwort erscheint, wenn die Runde abgeschlossen ist.

Du musst nicht warten, bis eine Runde fertig ist. Das Eingabefeld bleibt offen, während der Agent arbeitet: Alles, was du sendest, wird eingereiht, erscheint sofort mit dem Hinweis **Eingereiht** im Thread und wird dem laufenden Agenten bei nächster Gelegenheit übergeben — bei Claude Code mitten in der Runde, an der nächsten Werkzeuggrenze, sodass eine Korrektur wie „nimm pnpm statt npm" ankommt, während die Arbeit noch läuft. Eine eingereihte Nachricht lässt sich entfernen (das × neben dem Hinweis), bis der Agent sie übernimmt. Mit **Stopp** beendest du die aktuelle Runde; noch eingereihte Nachrichten werden wenige Sekunden später automatisch als nächste Runde gesendet, mit unverändertem Kontext des Agenten.

Jeder Chat-Thread wird von einer dauerhaften Sandbox-Sitzung getragen. Folgenachrichten verwenden dieselbe Sitzung und dieselben Dateien wieder, und der Agent setzt seine frühere Überlegung fort, statt bei null zu beginnen. Die Sitzung gehört dem Thread — wird der Thread gelöscht oder archiviert, wird die Sandbox abgebaut und ihre Ressourcen werden freigegeben.

## Was die Sandbox erreichen kann

Die Sandbox startet mit einem leeren Arbeitsverzeichnis und ist standardmäßig abgeriegelt. Ausgehender Netzwerkverkehr ist bis auf eine kleine Erlaubnisliste (Paket-Registries und GitHub) gesperrt, sodass der Agent Abhängigkeiten installieren und öffentliche Repositorys klonen, aber keine beliebigen Hosts erreichen kann. Das Modell selbst wird über das Gateway des Workspace angesprochen, nie über einen rohen Provider-Schlüssel — die Sandbox hält für eine Runde nur einen kurzlebigen, budgetbegrenzten Schlüssel.

Wenn du unter [Integrationen](/platform/integrations/overview) GitHub verbunden hast und dem Agenten Zugriff gewährt wurde, erhält die Sandbox ein begrenztes Token, damit `git` und das `gh`-CLI in deinem Namen klonen, pushen und Pull Requests öffnen können. Anmeldedaten werden pro Sitzung eingespeist, protokolliert und beim Ende der Sitzung widerrufen.

## Engines und Modelle

**Claude Code** ist ein eigener Eintrag im Chat-Auswahlmenü. Das Modell ist davon unabhängig: Es stammt aus der Liste der unterstützten Modelle des Agenten, genau wie bei jedem anderen Agenten — wähle es im Modellauswahlmenü. Beachte, dass die Prompts eines Coding-Agenten am besten mit der Modellfamilie funktionieren, für die er entworfen wurde; die Kombination mit einem nicht verwandten Modell funktioniert zwar, die Qualität schwankt aber.

## Kosten und Budget

Runden des Externen Agenten können lang sein und das Modell viele Male aufrufen, daher kosten sie mehr als eine einzelne Chat-Antwort. Jede Runde läuft gegen ein Pro-Runde-Budget, und die [Richtlinien und Limits](/platform/admin/governance/policies-and-limits) der Organisation begrenzen die Ausgaben pro Nutzer, pro Team oder pro Agent. Die Nutzung wird wie bei jedem anderen Agenten in der [Nutzungsanalyse](/platform/admin/governance/usage-analytics) erfasst und dem Externen Agenten zugeordnet, sodass du siehst, was diese Läufe kosten.

## Wo das hineinpasst

Ein externer Agent verwandelt einen Chat-Thread in eine Live-Sitzung mit einem Coding-Werkzeug in einer Sandbox — du steuerst ihn in normaler Sprache, er arbeitet in einem isolierten Arbeitsbereich, und die Sitzung bleibt für Folgefragen bestehen, bis du den Thread schließt. Die Drift-Kandidaten hier sind die Agenten- und Modellnamen; kombiniere diese Seite mit der laufenden [Provider-Liste](/platform/admin/providers), statt dir bestimmte Modellzeichenketten zu merken, und mit [Integrationen](/platform/integrations/overview) für den GitHub-Zugriff, der aus einer Scratch-Sitzung einen echten Pull-Request-Workflow macht.
