---
title: Verbundene Agenten
description: Verbinde einen Coding-Agent mit Tale, indem du dich im Agent anmeldest; lege fest, was er darf, und sieh dir die mit einer Organisation verbundenen Agents an oder trenne sie.
---

Ein Coding-Agent wie Claude Code, Codex oder Cursor kann sich selbst am [MCP-Endpunkt](/de/develop/mcp-endpoint) von Tale anmelden, statt einen API-Schlüssel zu verwenden. Du meldest dich an, wählst eine Organisation und wie viel der Agent dort darf, und der Agent arbeitet danach in deinem Namen, nie mit mehr Rechten, als deine Rolle hat. Diese Seite behandelt das Verbinden eines Agents, was die Zustimmungsseite abfragt und wo du Verbindungen siehst und beendest. Dein Betreiber kann die Anmeldung von Agents abschalten; solange sie aus ist, nutzen Agents API-Schlüssel, und die Seite **Verbundene Agenten** gibt es nur für Personen, die noch eine Verbindung haben.

## Einen Agent verbinden

1. Wähle auf dieser Seite **Coding-Agent verbinden**. Der Dialog nennt die Befehle für Claude Code und Codex sowie die Adresse, die du bei jedem anderen Agent einträgst; [Tale aus deinem Editor oder einem Skript nutzen](/de/develop/use-tale-from-your-editor#opencode-oder-claude-code-verbinden) deckt den Rest ab. **Einstellungen > API > MCP** zeigt die Adresse ebenfalls, mit einer Kopierschaltfläche.
2. Führe die Befehle für deinen Agent aus, zuletzt die Anmeldung: `claude mcp login tale` oder `codex mcp login tale`. Der Agent öffnet Tale in deinem Browser. Bist du abgemeldet, melde dich zuerst an.
3. Prüfe auf der Zustimmungsseite, wer anfragt. **Bestätigte Domain** heißt: Tale hat die Angaben zur App von deren eigener Domain gelesen, und nur wer diese Domain besitzt, kann sie veröffentlichen. **Nicht bestätigte App** heißt: Der Agent hat sich selbst registriert und seinen Namen selbst gewählt; fahre nur fort, wenn du die Verbindung gerade in deinem Agent gestartet hast.
4. Wähle die **Organisation**. Der Agent arbeitet nur in dieser Organisation; für eine andere verbindest du ihn erneut.
5. Wähle den **Zugriff** und, wenn du möchtest, unter **Zusätzlich erlauben**, was der Agent noch darf. Die Liste „Was Claude Code darf“ (bei dir mit dem Namen deines Agents) zeigt, worauf die Wahl hinausläuft. Deine Rolle gilt weiter: Der Agent darf nie mehr als du in dieser Organisation.
6. Wähle **Verbinden**. Tale schickt dich zurück zum Agent, der sich selbst anmeldet und loslegen kann.

<Frame caption="Coding-Agent verbinden — die Befehle für deinen Agent, ob er sich schon angemeldet hat und was du ihn zuerst fragen kannst.">

![Der Dialog „Coding-Agent verbinden“ zeigt die Reiter Claude Code, Codex und Andere, die beiden Befehle zum Hinzufügen von Tale und zur Anmeldung, eine Zeile, die auf die Anmeldung des Agents wartet, und einen ersten Prompt zum Kopieren.](/images/platform/settings-connect-agent.webp)

</Frame>

<Frame caption="Die Zustimmungsseite einer App, die sich selbst registriert hat. Wo eine bestätigte App ihre Domain zeigt, steht hier die Warnung „Nicht bestätigte App“.">

![Die Zustimmungsseite für eine App namens Cursor: eine Warnung, dass die App nicht bestätigt ist, die Organisation, in der sie arbeitet, drei Zugriffsstufen und drei Zusatzoptionen zur Auswahl, eine Zusammenfassung dessen, was sie darf, sowie die Schaltflächen „Verbinden“ und „Abbrechen“.](/images/platform/agent-consent.webp)

</Frame>

Die Anfrage, die dich zur Zustimmungsseite bringt, läuft nach fünf Minuten ab. Ist sie abgelaufen, starte die Verbindung im Agent erneut.

Solange der Dialog offen ist, beobachtet er die Verbindung. Er zeigt **Warte darauf, dass sich dein Agent anmeldet…**, bis sich der Agent angemeldet hat, danach **Verbunden:** und seinen Namen, dazu einen ersten Prompt, den du dem Agent geben kannst.

### Den Zugriff wählen

| Wahl                             | Was der Agent darf                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Lesen und testen**             | Automatisierungen, Läufe und Wissen lesen, Entwürfe prüfen und mit Testdaten ausprobieren. Ändert nichts.     |
| **Automatisierungen bearbeiten** | Zusätzlich neue Versionen speichern. Das Live-Schalten bleibt bei dir.                                        |
| **Bearbeiten und live schalten** | Zusätzlich live schalten, Auslöser setzen und Live-Läufe starten, die in deinen verbundenen Diensten handeln. |
| **Einstellungen lesen**          | Die Einstellungen lesen, die deine Rolle sieht. Geheimnisse bleiben verborgen.                                |
| **Einstellungen ändern**         | Die Einstellungen ändern, die deine Rolle ändern darf. Jede Änderung steht im Audit-Log.                      |
| **KI-Abos verbinden**            | Das Hinzufügen eines KI-Abos anfragen. Bisher nutzt kein Tool diese Wahl.                                       |

Die ersten drei sind Stufen: Jede kommt zur vorigen hinzu. Die letzten drei wählst du einzeln. [Zugriffsstufen](/de/develop/mcp-endpoint#access-levels) listet die Tools, die jede davon freischaltet. Die Seite bietet nur an, was der Agent angefragt hat und deine Rolle erlaubt; eine Wahl, um die der Agent nicht gebeten hat, ist nicht wählbar und nennt den Grund. Braucht ein Aufruf mehr Zugriff, als die Verbindung hat, kann der Agent erneut anfragen, und du erlaubst auf derselben Seite mehr. Erlaubst du dieselbe App erneut, ändert das ihre Verbindung, statt eine zweite hinzuzufügen.

### Wer einen Agent verbinden darf

|                                                                                                                  | Inhaber, Admin oder Entwickler | Mitglied mit einer Kompetenz, die mit einem Schlüssel genutzt wird | Jedes andere Mitglied |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ | --------------------- |
| Einen Agent mit der Organisation verbinden                                                                       | Ja                             | Ja                                                                 | Nein                  |
| **Automatisierungen bearbeiten**, **Bearbeiten und live schalten**, **Einstellungen ändern** oder **KI-Abos verbinden** erlauben | Ja                             | Nein                                                               | Nein                  |
| **Lesen und testen** und **Einstellungen lesen** erlauben                                                              | Ja                             | Ja                                                                 | Nein                  |

Gemeint ist eine Kompetenz, die das Erstellen eines API-Schlüssels erlaubt, etwa **Modelle über die API aufrufen**; [Kompetenzen](/de/platform/admin/governance/competences) listet sie. Wer in einer Organisation keinen Agent verbinden darf, sieht auf der Zustimmungsseite, warum, und kann diese Organisation nicht wählen.

Alles, was über **Lesen und testen** und **Einstellungen lesen** hinausgeht, braucht eine Anmeldung aus den letzten 24 Stunden. Ist deine älter, fragt die Seite zuerst nach deinem Passwort. Meldest du dich über die Anmeldung deines Unternehmens an, schickt sie dich stattdessen zum erneuten Anmelden. Deine Wahl bleibt dabei erhalten. Konten, deren E-Mail-Adresse nicht bestätigt ist oder die die Zwei-Faktor-Authentifizierung noch nicht eingerichtet haben, können noch keinen Agent verbinden.

## Agents anzeigen und trennen

Öffne **Einstellungen > API > Verbundene Agenten**. Die Seite gibt es, sobald die Anmeldung von Agents eingeschaltet ist und du in dieser Organisation einen Agent verbinden darfst, und sie bleibt für alle sichtbar, die noch eine aktive Verbindung haben, damit sie diese beenden können. Die Liste zeigt für jeden Agent den Namen, die Herkunft (die bestätigte Domain oder **Nicht bestätigt**), den Zugriff, den du ihm gegeben hast, den Zeitpunkt der Verbindung (**Verbunden**) und den der letzten Nutzung (**Zuletzt genutzt**); vor dem ersten Aufruf steht dort **Nie**. Der Zeitpunkt der letzten Nutzung stammt aus Tales eigener Aufzeichnung der Aufrufe, die es über diese Verbindung beantwortet hat; er beruht nie auf Angaben des Agents.

<Frame caption="Einstellungen > API > Verbundene Agenten — jeder Agent mit seinem Zugriff, dem Tag der Verbindung und dem Zeitpunkt der letzten Nutzung.">

![Die Seite „Verbundene Agenten“ listet drei Coding-Agents auf, alle als „Nicht bestätigt“ gekennzeichnet, mit dem jeweils gewährten Zugriff, dem Tag der Verbindung und dem Zeitpunkt der letzten Nutzung.](/images/platform/settings-connected-agents.webp)

</Frame>

Du siehst die Agents, die du verbunden hast. Inhaber und Admins können **Meine** auf **Alle** umstellen, um zu sehen, wer welchen verbunden hat, und **Getrennte anzeigen** einschalten, um zu lesen, wann und warum eine Verbindung endete.

Um einen Agent zu trennen, öffne sein Zeilenmenü und wähle **Trennen**. Tale bittet zuerst um Bestätigung und nennt dabei, wessen Agent es ist; der Agent verliert sofort den Zugriff: Sein nächster Aufruf wird abgelehnt, und er kann sich nicht erneut anmelden. Du kannst ihn später wieder verbinden. Das Trennen beendet die Anmeldung des Agents nur für diese Organisation; dieselbe App, die du mit einer anderen Organisation verbunden hast, bleibt bestehen.

## Was eine Verbindung beendet

| Was geschieht                                                                                                                         | Angezeigter Grund                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Du trennst sie                                                                                                                        | von der Person, die ihn verbunden hat      |
| Ein Inhaber oder Admin trennt sie                                                                                                     | von einem Admin                            |
| Die Person verlässt die Organisation oder wird entfernt                                                                               | Mitgliedschaft beendet                     |
| Die Person ändert ihr Passwort, oder ein Admin legt es fest, entfernt ihren Passkey oder setzt ihre Zwei-Faktor-Authentifizierung zurück          | Änderung der Kontosicherheit               |
| Eine alte Anmeldung wurde erneut verwendet: Ein zweimal vorgelegtes Refresh-Token beendet jede Verbindung dieser App für diese Person | eine alte Anmeldung wurde erneut verwendet |
| Die Registrierung der App wird entfernt                                                                                               | App entfernt                               |

Ein Agent, der 30 Tage lang nicht benutzt wird, kann seine Anmeldung nicht mehr erneuern und muss neu verbunden werden. Endet eine Verbindung, ohne dass du sie getrennt hast, weil eine alte Anmeldung erneut verwendet wurde, sich dein Passwort oder deine Anmeldemethode geändert hat oder ein Inhaber oder Admin sie getrennt hat, findest du in deinen Benachrichtigungen dieser Organisation einen Hinweis, der den Agent und den Grund nennt. Wenn du selbst trennst, gibt es keinen Hinweis. Jede Verbindung, jede Änderung des Zugriffs und jede Trennung hinterlässt außerdem eine Zeile im [Audit-Log](/de/platform/admin/governance/audit-logs), und die Aufrufe eines Agents sind dort als über MCP gekommen gekennzeichnet und nennen die Verbindung.

## Wenn es nicht klappt

| Was du siehst                                                                                                                      | Was du tun kannst                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Der Agent sagt, er braucht Authentifizierung                                                                                       | Führe seinen Anmeldebefehl aus oder öffne `/mcp` in Claude Code und schließe die Schritte im Browser ab.                                                   |
| Die Zustimmungsseite sagt, das Verbinden eines Coding-Agents verlange die Rolle Inhaber, Admin oder Entwickler oder eine Kompetenz | Bitte einen Admin um die Rolle oder die Kompetenz.                                                                                                         |
| Die Zustimmungsseite sagt, dein Konto könne noch keine Agents verbinden                                                           | Bestätige deine E-Mail-Adresse oder richte die Zwei-Faktor-Authentifizierung ein und starte dann erneut im Agent.                                          |
| Die Zustimmungsseite sagt, die Anfrage sei abgelaufen                                                                              | Starte die Verbindung im Agent erneut.                                                                                                                     |
| Der Agent kann lesen, aber nicht speichern oder live schalten                                                                      | Er hat weniger Zugriff, als der Aufruf braucht. Verbinde ihn erneut und erlaube mehr; **Automatisierungen bearbeiten** und **Bearbeiten und live schalten** kannst du nur als Inhaber, Admin oder Entwickler erlauben. |
| Ein Aufruf wird mit `ORG_MISMATCH` abgelehnt                                                                                       | Der Aufruf nennt eine andere Organisation als die, mit der der Agent verbunden wurde. Verbinde den Agent mit jeder Organisation, in der er arbeiten soll.  |
| Die Seite fehlt in den Einstellungen                                                                                               | Die Anmeldung von Agents ist aus, oder du darfst hier keinen Agent verbinden und hast keine Verbindung. Frag einen Admin.                                |

Betreiber finden unter [Coding-Agents anmelden lassen](/de/self-hosted/configuration/authentication#coding-agent-sign-in), was die Bereitstellung bieten muss.
