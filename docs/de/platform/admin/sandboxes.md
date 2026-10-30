---
title: Sandbox-Kapazität verwalten
description: Passe Grenzen für gleichzeitige Arbeit an, lies Infrastrukturwerte und kläre blockierte Sandbox-Starts.
---

Öffne **Einstellungen > Sandboxes**, wenn Agenten, der Chat oder Website-Scans keine Ausführungsumgebung erhalten. Die Seite trennt die Arbeitsgrenzen deiner Organisation von der tatsächlichen Infrastruktur des Deployments. Inhaber und Admins dürfen Limits ändern und festlegen, wann inaktive Arbeitsbereiche gelöscht werden. Entwickler sehen Limits und zusammengefasste Kapazität, aber keine privaten Details der Arbeitsbereiche.

## Das relevante Limit erkennen

| Arbeitsart | Standard | Was einen Platz belegt |
| --- | --- | --- |
| **Agenten-Worker** | 2 | Ein startender oder arbeitender Worker: einer für jede Aufgabe, an der ein Agent gleichzeitig arbeitet. Jeder Worker ist eine Sandbox mit eigenem Arbeitsbereich, die der Agent für spätere Aufgaben wiederverwendet. |
| Workflow-Sitzungen | 2 | Die Sandbox eines Workflow-Laufs. Gleichzeitige Läufe belegen getrennte Plätze. |
| Render-Sitzungen | 2 | Eine vorübergehende Sandbox zum Rendern von Seiten bei Website-Scans. |
| Leichte Sandboxes | 2 | Eine kurzlebige Sandbox, in der der Chat-Assistent für ein Gespräch oder der Standard-Agent für einen Aufgabenlauf Code ausführt. Eine unbenutzte macht der nächsten Anfrage Platz; siehe [Leichte Sandboxes für Chat und Aufgaben](#light-sandboxes). |

Die Werte begrenzen gleichzeitige Arbeit, nicht die Anzahl der Aufgaben oder die Ausgaben. Ein Agent, der an drei Aufgaben gleichzeitig arbeitet, belegt drei Agenten-Worker; ein Lauf, der alle belegt vorfindet, [wartet auf einen](#einen-blockierten-start-klaeren) und startet von selbst, sobald einer frei ist. Unter **Agenten-Worker** sehen Inhaber und Admins, wie viele Agentenläufe auf einen freien Worker warten: die Läufe, die ein höheres Limit sofort starten würde. Die [Arbeitsverteilung](/de/platform/projects/dispatch#limits) eines Projekts darf bis zu 500 Läufe gleichzeitig halten, so viele, wie dieses Limit höchstens erlaubt, startet aber nicht mehr, als Agenten-Worker frei sind. Die Limits reservieren keine Infrastruktur: Alle Organisationen teilen sich die Deployment-Kapazität.

<Frame caption="Die Summe der Arbeitslimits passt sich automatisch an. Sie darf die Kapazität der Bereitstellung nicht überschreiten.">

![Der Abschnitt Organisationslimits zeigt vier bearbeitbare Sitzungslimits und ihre berechnete Summe im Verhältnis zur Kapazität der Bereitstellung.](/images/platform/settings-sandboxes.webp)

</Frame>

## Ein Arbeitslimit ändern

1. Prüfe die belegten Plätze der Arbeitsart und die Infrastrukturwerte darunter.
2. Gib beim passenden Limit eine ganze Zahl von 1 bis 500 ein. Die angezeigte Gesamtzahl berechnet die Summe aller vier Felder neu.
3. Halte die Summe innerhalb der Deployment-Kapazität und wähle **Speichern** im Kopfbereich. **Verwerfen** stellt die gespeicherten Werte wieder her.
4. Öffne die Seite erneut, prüfe die gespeicherten Limits und beobachte, ob neue Arbeit einen Platz erhält.

Die Standardwerte ergeben zusammen 8. Bei einer Deployment-Kapazität von 10 ist eine Summe von 10 erlaubt, 11 wird abgelehnt. Der Server prüft die Kapazität beim Speichern erneut. Der aktuelle Wert kann deshalb von der ersten Beobachtung abweichen. Die verbundenen [Geräte](/de/platform/admin/sandbox-devices) deiner Organisation erhöhen die Obergrenze um die Sandboxes, die sie ausführen: Mit einem Gerät, das 4 ausführt, darf die Summe 14 erreichen.

Eine Senkung betrifft künftige Starts und unterbricht keine laufende Arbeit. Sind Infrastrukturwerte nicht verfügbar, bleiben Senkungen möglich; Erhöhungen brauchen einen aktuellen Kapazitätswert. Hat der Betreiber die Kapazität unter deine bisherige Summe gesenkt, reduziere die Limits vor dem nächsten Speichern. Lassen sich bereits die Organisationsbelegungen nicht laden, bleiben die Felder gesperrt, statt bearbeitbare Standardwerte anzuzeigen.

## Leichte Sandboxes für Chat und Aufgaben {#light-sandboxes}

Bittet ein Mitglied den Chat-Assistenten um eine Word-, Excel-, PowerPoint- oder PDF-Datei, ein Diagramm oder eine Berechnung, führt er Code in einer leichten Sandbox aus: einer isolierten Umgebung, die in etwa einer Sekunde startet und keinen eigenen Arbeitsbereich behält. Was Mitglieder dabei sehen, beschreibt [Im Chat Dateien erstellen und Skills nutzen](/de/platform/chat/files-and-skills). Der Standard-Agent tut dasselbe, wenn eine Person ihn für eine Aufgabe startet; [So läuft ein Lauf des Standard-Agenten](/de/platform/projects/project-agents#standard-agent-runs) erklärt, wann er stattdessen einen Worker nutzt.

Jedes Gespräch und jeder Aufgabenlauf nutzt höchstens eine leichte Sandbox. Die eines Gesprächs behält ihre Dateien zwischen den Schritten des Assistenten und den Folgefragen des Mitglieds; nach etwa fünf Minuten ohne Nutzung entfernt Tale sie. Die eines Aufgabenlaufs verschwindet, sobald der Lauf endet. Laufen in der Organisation bereits so viele leichte Sandboxes, wie **Leichte Sandboxes** erlaubt, übernimmt eine neue Anfrage den Platz derjenigen, die am längsten unbenutzt ist, sofern sie seit mindestens 30 Sekunden ruht. Sind alle beschäftigt, bittet der Assistent das Mitglied, es in einer Minute noch einmal zu versuchen. Ein Aufgabenlauf, der niemanden bitten kann, es noch einmal zu versuchen, wartet bis zu etwa 90 Sekunden auf eine freie Sandbox, bevor er aufgibt; sonst wartet nichts in einer Warteschlange.

Unter **Arbeitsbereiche** erscheint eine leichte Sandbox mit dem Namen der Person, die chattet oder den Aufgabenlauf gestartet hat, und dem Hinweis **Leichte Sandbox**. Du kannst sie wie jeden Arbeitsbereich löschen. Anpinnen lässt sie sich nicht, denn Tale entfernt sie, sobald sie ruht. Code darin läuft ohne Zugangsdaten deiner Organisation und sieht nur die Dateien seines eigenen Gesprächs oder seiner eigenen Aufgabe. Wie jede Sandbox erreicht er öffentliche Webadressen über den Egress-Proxy, und bei einem Docker-Deployment kann er außerdem Verbindungen zu den übrigen Diensten im Sandbox-Netzwerk öffnen, etwa zur API der Plattform, für die er keine Zugangsdaten hat; Cloud-Metadaten-Adressen sind gesperrt. Um die öffentlichen Hosts zu begrenzen, die er erreichen darf, lege eine Egress-Freigabeliste fest, wie [Sandbox-Ziele begrenzen](/de/self-hosted/operate/security/hardening#sandbox-ziele-begrenzen) es beschreibt. Soll der Chat gar keinen Code ausführen, schalte unter [Chat-Tools](/de/platform/admin/governance/policies-and-limits#chat-tools) **Code** aus; diese Einstellung gilt nur für den Chat-Assistenten.

## Die Infrastrukturwerte lesen

<Frame caption="Sandboxes der Bereitstellung zeigt die gemeinsame Belegung und Kapazität. Sandboxes deiner Organisation zählt auch Umgebungen im Leerlauf, die zur Wiederverwendung bereitstehen.">

![Die Infrastrukturkapazität zeigt die Sandbox-Anzahl aller Organisationen im Verhältnis zur Gesamtkapazität, die Sandbox-Anzahl der eigenen Organisation sowie gemessene CPU- und Speicherwerte.](/images/platform/sandbox-infrastructure-capacity.webp)

</Frame>

| Messwert | Bedeutung |
| --- | --- |
| Sandboxes des Deployments | Laufende und startende Umgebungen aller Organisationen im Verhältnis zur gemeinsamen Kapazität. Kubernetes betrachtet den Namespace. |
| Sandboxes deiner Organisation | Laufende und startende Umgebungen dieser Organisation, einschließlich bereitgehaltener inaktiver Umgebungen. Das ist eine Anzahl, kein weiteres Limit. |
| CPU-Auslastung des Hosts | Kürzlich genutzte und gesamte CPU-Kerne, einschließlich anderer Dienste auf dem Host. |
| Arbeitsspeicher des Hosts | Genutzter und gesamter Speicher, einschließlich anderer Dienste und unter Berücksichtigung freigebbaren Caches. |

Die Werte aktualisieren sich alle 15 Sekunden. Mit **Aktualisieren** forderst du eine neue Beobachtung an. Prüfe den Zeitstempel. Die CPU-Auslastung ist die Differenz zweier Messungen; die erste Beobachtung nach einer längeren Pause dauert etwa eine Sekunde länger. Entfernte Hosts liefern gegebenenfalls nur Gesamtwerte. Namespace-Zugriff unter Kubernetes liefert keine Host-Messungen. Nicht verfügbare Werte sind unbekannt, nicht null.

## Belegte und inaktive Arbeitsbereiche unterscheiden

Inhaber und Admins können **Arbeitsbereiche** prüfen. Jede Zeile nennt den zugehörigen Agenten oder Workflow-Lauf, Laufzeitstatus, Belegungsstatus und laufende Aufgaben. Ein Agent hat eine Zeile pro Worker: Unter seinem Namen sagt **Worker 2**, welcher seiner Worker die Zeile ist, und **Mitglieder-Worker 2** kennzeichnet einen, der den Agenten für ein Mitglied ausführt, das [seine Läufe gestartet hat](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet). **Aktuelle Aufgaben** nennt jede Aufgabe mit Schlüssel und Titel und öffnet sie. Die Zustände beantworten unterschiedliche Fragen: Ein Container kann für die Wiederverwendung weiterlaufen, obwohl er seinen Organisationsplatz bereits freigegeben hat. Der Arbeitsbereich eines Workers bleibt auch im Leerlauf aufgeführt, als **Gestoppt** mit **Kontingent freigegeben**, bis du ihn löschst oder Tale ihn löscht: wenn ihn niemand [während der von deiner Organisation festgelegten Anzahl Tage](#delete-unused-workspaces-automatically) genutzt hat, wenn er inaktiv ist und [dem Deployment der Speicherplatz ausgeht oder er die Grenze deiner Organisation überschreitet](#free-disk-space-and-limit-workspace-size) oder wenn [sein Agent, sein Projekt oder das zugehörige Mitglied entfernt wird](#explain-why-a-workspace-disappeared). Wurde der Agent selbst gelöscht, steht in der Zeile **Gelöschter Agent**, bis Tale den Arbeitsbereich gelöscht hat. Der Arbeitsbereich eines Workflow-Laufs wird kurz nach dem Ende des Laufs zurückgefordert. Verschwindet eine Umgebung auf dem Tale-Server von selbst, etwa nach einem Neustart des Hosts oder weil ihr der Speicher ausgegangen ist, behält ihr Arbeitsbereich seine Dateien und steht auf **Gestoppt**; der nächste Lauf arbeitet darin weiter. Für eine Umgebung auf einem verbundenen [Gerät](/de/platform/admin/sandbox-devices) gilt das nicht.

Die Ausgaben enthalten die gemessenen Kosten abgeschlossener Durchläufe. Ein noch laufender Durchlauf wird nach seinem Ende eingerechnet. Vorübergehende Crawler-Umgebungen zählen zur Kapazität, auch ohne eigene dauerhafte Zeile in der Liste der Arbeitsbereiche.

Ist die Deployment-Kapazität voll, kann Tale eine nicht angeheftete, inaktive Umgebung zurückfordern, deren Belegung freigegeben ist und die bestätigt, dass keine Arbeit mehr läuft. Die dauerhaften Dateien des Arbeitsbereichs bleiben für den nächsten Start erhalten. Beschäftigte, angeheftete oder nicht erreichbare Umgebungen kommen nicht infrage. Ohne geeigneten Kandidaten braucht neue Arbeit freie Kapazität. Eine Umgebung, deren Aufgabe oder Lauf beendet ist, stoppt nach einigen Minuten im Leerlauf, sodass ihr Platz bald nach dem Ende der Arbeit frei wird. Eine Agent-Umgebung, in der Docker läuft, behält ihre volle Leerlaufzeit, damit der nächste Durchgang ihre Images nicht erneut laden muss.

## Einen bestehenden Arbeitsbereich verwalten

Inhaber und Admins finden im Zeilenmenü diese Aktionen:

| Aktion | Wirkung |
| --- | --- |
| **Aufgabe stoppen** | Bricht alle laufenden Vorgänge dieses Arbeitsbereichs ab. Ein Worker bearbeitet jeweils eine Aufgabe, also stoppt das nur diese; die anderen Worker des Agenten arbeiten weiter. |
| **Anpinnen** / **Lösen** | Nimmt den Arbeitsbereich von der automatischen Inaktivitäts- und Ablaufbereinigung und vom Löschen wegen Nichtnutzung, für freien Speicherplatz oder wegen seiner Größe aus oder stellt die normale Bereinigung wieder her. Eine leichte Sandbox des Chats lässt sich nicht anpinnen. Eine angeheftete Belegung kann weiter Kapazität beanspruchen. Verschwindet die Umgebung eines angehefteten Arbeitsbereichs, etwa nach einem Neustart des Hosts, startet Tale sie mit den Dateien des Arbeitsbereichs neu; der Arbeitsbereich bleibt angeheftet. |
| **Löschen** | Fragt nach Bestätigung und entfernt dann Sandbox und Dateien des Arbeitsbereichs im Hintergrund: Zuerst wird die Anheftung gelöst und laufende Arbeit abgebrochen. Bis der Arbeitsbereich entfernt ist, steht in seiner Zeile **Wird gelöscht**, und du kannst die Seite währenddessen weiter nutzen. Kann Tale ihn auch nach mehreren Versuchen nicht entfernen, bleibt der Arbeitsbereich ohne Anheftung in der Liste und zeigt **Nicht gelöscht**; wähle dann erneut **Löschen**, um ihn vollständig zu entfernen. Solange die Zeile **Wird gelöscht** zeigt, startet in diesem Arbeitsbereich nichts Neues. Der Lauf eines Agenten, der ihn nutzen würde, nimmt einen anderen freien Worker des Agenten; ist keiner frei, wartet er und zeigt **Wartet auf einen Arbeitsbereich**. Ein Schritt eines Workflow-Laufs, der den Arbeitsbereich braucht, schlägt sofort mit dem Grund fehl, ohne zu warten oder es erneut zu versuchen, denn die Dateien seiner früheren Schritte werden gelöscht. Ist die Zeile verschwunden, erzeugt der nächste Start eine neue Umgebung; zeigt sie stattdessen **Nicht gelöscht**, geht die wartende Arbeit mit den alten Dateien weiter. |

Tale zeigt **Aufgabe gestoppt** erst, wenn alle angeforderten Abbrüche bestätigt sind. Lassen sich eine oder mehrere Ausführungen nicht stoppen, nennt **Aktion fehlgeschlagen** ihre Anzahl. Bereits gestoppte Ausführungen bleiben gestoppt.

Tale speichert Änderungen am Anheftstatus dauerhaft und wiederholt die Übertragung, wenn die Laufzeit sie nicht bestätigt, auch nach einem Neustart eines Backend-Workers oder einem Geräteausfall. Jeder Versuch überträgt den zuletzt gewünschten Wert an dieselbe Session-Instanz. Wiederholtes Lösen verlängert deren Ablaufzeit nicht.

Stoppe die Aufgabe, wenn die Arbeit enden, ihre Dateien aber bleiben sollen. Sichere vor dem Löschen benötigte Ergebnisse und lies die Bestätigung. Automatische Rückgewinnung inaktiver Kapazität bewahrt die Dateien der Arbeitsbereiche; ausdrückliches und automatisches Löschen entfernen sie.

## Ungenutzte Arbeitsbereiche automatisch löschen {#delete-unused-workspaces-automatically}

Ein Projekt-Agent bewahrt seine Dateien zwischen den Läufen in den Arbeitsbereichen seiner Worker auf: einem für jede Aufgabe, an der er gleichzeitig gearbeitet hat, den seine späteren Aufgaben wiederverwenden, und getrennten für jedes Mitglied, das [seine Läufe startet](/de/platform/projects/tasks#agentenlaeufe-die-ein-mitglied-startet). Der Arbeitsbereich jedes Workers zählt seine Tage ohne Nutzung für sich. Tale löscht einen Arbeitsbereich, den niemand während der von deiner Organisation festgelegten Anzahl Tage genutzt hat; **Löschen** entfernt einen Arbeitsbereich weiterhin sofort. Inhaber und Admins legen diese Regel unter **Bereinigung der Arbeitsbereiche** fest, direkt über der Liste **Arbeitsbereiche**. Entwickler sehen diesen Abschnitt nicht.

<Frame caption="Ist Ungenutzte Arbeitsbereiche löschen eingeschaltet, löscht Tale einen Arbeitsbereich, den niemand während der festgelegten Anzahl Tage genutzt hat. Angepinnte Arbeitsbereiche bleiben erhalten.">

![Der Abschnitt Bereinigung der Arbeitsbereiche zeigt den eingeschalteten Schalter Ungenutzte Arbeitsbereiche löschen und den Wert 30 bei Tage ohne Nutzung, jeweils mit einer Erklärung ihrer Wirkung.](/images/platform/sandbox-workspace-cleanup.webp)

</Frame>

1. Lass **Ungenutzte Arbeitsbereiche löschen** eingeschaltet, wie es voreingestellt ist. Solange der Schalter aus ist, löscht Tale keinen Arbeitsbereich wegen Nichtnutzung.
2. Gib bei **Tage ohne Nutzung** eine ganze Zahl von 1 bis 3650 ein; voreingestellt sind 30. Die Tage zählen ab dem Zeitpunkt, an dem der Agent zuletzt im Arbeitsbereich gearbeitet hat, oder ab dem Lösen seiner Anheftung.
3. Wähle **Speichern** im Kopfbereich. **Verwerfen** stellt die gespeicherten Werte wieder her.

Nach einer Änderung wird nie ein Arbeitsbereich vorzeitig gelöscht. Schaltest du das Löschen ein oder verkürzt du den Zeitraum, wird kein Arbeitsbereich wegen Nichtnutzung gelöscht, bevor seit der Änderung die volle Anzahl Tage vergangen ist. Dieselbe Wartezeit folgt auf das Update, das die Einstellung eingeführt hat. Ein längerer Zeitraum startet die Wartezeit nicht neu, Aus- und erneutes Einschalten dagegen schon.

In der Liste **Arbeitsbereiche** zeigt ein gestoppter Agenten-Arbeitsbereich unter seinem Status, wann er gelöscht wird: **Wird am … gelöscht, falls weiterhin ungenutzt**. Ein neuer Lauf im Arbeitsbereich startet die Zählung neu. Ein angepinnter Arbeitsbereich oder einer, den ein [Legal Hold](/de/platform/admin/governance/legal-hold) bewahrt, zeigt kein Datum und wird nie wegen Nichtnutzung gelöscht.

## Speicherplatz freigeben und die Größe der Arbeitsbereiche begrenzen {#free-disk-space-and-limit-workspace-size}

Ein Arbeitsbereich behält alles, was sein Agent installiert und gebaut hat, und alle Organisationen des Deployments teilen sich den Datenträger, auf dem die Arbeitsbereiche liegen. Wird dort der freie Speicherplatz knapp, lehnt das Deployment jede neue Sandbox ab, bis wieder Platz frei ist. Deshalb löscht Tale inaktive Arbeitsbereiche auch wegen des Platzes, den sie belegen. Inhaber und Admins legen auch diese Regeln unter **Bereinigung der Arbeitsbereiche** fest:

- **Speicherplatz freigeben, wenn er knapp wird** ist voreingestellt eingeschaltet. Solange auf dem Datenträger der Arbeitsbereiche weniger Platz frei ist, als das Deployment für neue Sandboxes freihält, löscht die stündliche Bereinigung zuerst die größten inaktiven Arbeitsbereiche des Deployments, egal welcher Organisation sie gehören, bis wieder doppelt so viel Platz frei ist. Schalte die Einstellung aus, um die Arbeitsbereiche deiner Organisation davon auszunehmen; inaktive Arbeitsbereiche anderer Organisationen werden weiterhin gelöscht.
- **Größe der Arbeitsbereiche begrenzen** ist voreingestellt ausgeschaltet. Eingeschaltet löscht die stündliche Bereinigung jeden inaktiven Arbeitsbereich, der größer ist als **Maximale Größe (GiB)**, eine ganze Zahl von 1 bis 10.240, ob der Speicherplatz knapp ist oder nicht.
- **Mindestanzahl Stunden ohne Nutzung**, voreingestellt 24, legt fest, wie lange ein Arbeitsbereich mindestens ungenutzt sein muss, bevor eine der beiden Regeln ihn löschen kann: eine ganze Zahl von 1 bis 8760.

Gelöscht wird nur ein inaktiver Arbeitsbereich: Keine Sandbox läuft darin, kein Lauf wartet auf ihn, und niemand hat ihn während der Mindestanzahl Stunden genutzt. Ein angepinnter Arbeitsbereich, einer, den ein [Legal Hold](/de/platform/admin/governance/legal-hold) bewahrt, und einer, dessen Größe Tale noch nicht gemessen hat, werden nie wegen Speicherplatz oder Größe gelöscht. Tale entscheidet unmittelbar vor jeder Löschung erneut, sodass ein inzwischen wieder genutzter Arbeitsbereich bleibt. Das Datum unter dem Status eines gestoppten Arbeitsbereichs zählt nur die Tage ohne Nutzung: Ein Arbeitsbereich über der Grenze oder einer, der für freien Speicherplatz gelöscht wird, kann früher verschwinden. Auf einem Deployment mit Kubernetes oder Incus kann Tale die Arbeitsbereiche nicht messen, daher löscht dort keine der beiden Regeln etwas.

## Klären, warum ein Arbeitsbereich verschwunden ist {#explain-why-a-workspace-disappeared}

Neben ungenutzten Arbeitsbereichen löscht Tale einen Arbeitsbereich auch, sobald entfernt wird, wozu er gehört, unabhängig von der Bereinigungseinstellung:

- Das Löschen eines Projekt-Agenten löscht die Arbeitsbereiche aller seiner Worker, auch die der Mitglieder. Das Löschen eines Projekts tut dasselbe für jeden Agenten darin.
- [Entfernst du ein Mitglied](/de/platform/admin/members-and-roles#zugriff-entziehen-oder-wiederherstellen) aus der Organisation, werden seine eigenen Arbeitsbereiche mit allen Agenten gelöscht. Setzt du es stattdessen auf **Deaktiviert**, bleiben sie erhalten.
- [Die Löschung der Daten einer Person](/de/platform/admin/governance/data-subject-requests) entfernt ihre eigenen Arbeitsbereiche, ohne auf laufende Arbeit darin zu warten.
- Das Löschen der Organisation entfernt alle ihre Sandboxes samt Dateien, widerruft die dafür ausgegebenen Gateway-Schlüssel, entfernt ihre Modell-Provider-Schlüssel aus dem Modell-Gateway, trennt ihre [Geräte](/de/platform/admin/sandbox-devices) und löscht die für sie angelegten Build- und Paket-Caches.

Das geschieht innerhalb von etwa einer Minute oder, falls im Arbeitsbereich noch eine Aufgabe läuft, nach deren Ende. Auch ein angepinnter Arbeitsbereich wird dann gelöscht, doch ein [Legal Hold](/de/platform/admin/governance/legal-hold) bewahrt jeden Arbeitsbereich, den er abdeckt: Eine Sperre der Organisation bewahrt alle, eine Sperre für eine Person deren eigene Arbeitsbereiche. Eine stündliche Bereinigung löscht außerdem Überreste, die niemandem mehr gehören, etwa den Arbeitsbereich eines Workflow-Laufs, der nie zurückgefordert wurde.

Jeden Arbeitsbereich, den Tale von selbst löscht, aus einem dieser Gründe, wegen Nichtnutzung oder wegen des Platzes, den er belegt, verzeichnet das [Audit-Log](/de/platform/admin/governance/audit-logs) unter **Einstellungen > Richtlinien > Protokolle** als **Sandbox-Arbeitsbereich gelöscht**. Das ist ein Systemereignis der Kategorie **Daten**, dessen Metadaten den Grund nennen: `agent_deleted`, `member_removed`, `member_erased`, `unused`, `orphaned`, `disk_pressure` (gelöscht, um Speicherplatz freizugeben) oder `over_size` (größer als die Grenze deiner Organisation). Bei den letzten beiden nennen sie auch die gemessene Größe (`workspaceBytes`). Das Ereignis wird erfasst, sobald Tale bestätigt hat, dass die Dateien des Arbeitsbereichs gelöscht sind, was bei einem großen Arbeitsbereich eine Weile dauern kann. Unter Kubernetes wird es erfasst, sobald das Volume des Arbeitsbereichs an den Storage-Provisioner des Clusters übergeben ist, der es gemäß der `reclaimPolicy` seiner StorageClass löscht; die Metadaten nennen, was geschehen ist (`deletion`: `done` oder `handed_off`). Schlägt das Löschen der Dateien fehl, erscheint das Ereignis mit dem Status **Fehlgeschlagen**, und das Löschen wird erneut versucht, bis die Dateien entfernt sind. Ein Sandbox-Dienst oder Gerät, das noch nicht auf diese Version aktualisiert ist, kann keine Löschung bestätigen: Tale erfasst für seine Arbeitsbereiche kein Ereignis und versucht es weiter, bis es aktualisiert ist. Ein Überbleibsel, das niemandem mehr gehört, kann ohne Ereignis enden: Werden seine Dateien noch gelöscht, wenn die stündliche Bereinigung weitergeht, löscht der Sandbox-Dienst sie zu Ende, doch Tale prüft sie nicht noch einmal.

## Einen blockierten Start klären

Ein Start ohne freien Platz wartet, und seine Aufgabe zeigt unter **Lauf**, warum: **Wartet auf einen Worker**, wenn alle Agenten-Worker deiner Organisation belegt sind, **Wartet auf freien Platz**, wenn das Deployment voll ist oder zu wenig Arbeitsspeicher oder Speicherplatz hat, **Wartet auf einen Arbeitsbereich**, solange ein Administrator den Arbeitsbereich löscht, den der Lauf nutzen würde, und **Wartet auf seine Sandbox**, solange seine Sandbox einen früheren Prozess beendet. Inhaber und Admins bekommen außerdem einen Link auf diese Seite, wenn alle Agenten-Worker belegt sind. Sind die Limits deiner Organisation belegt oder ist das Deployment voll oder knapp an Arbeitsspeicher, startet die Arbeit von selbst, sobald Platz frei wird, und du musst nichts tun. Bei Speicherplatz ist das anders: Wird ungenutzte Arbeit angehalten, wird keiner frei, denn ein angehaltener Arbeitsbereich behält seine Dateien. Tale entfernt Build-Caches, die keine Sitzung nutzt, sofern es welche gibt, und löscht innerhalb einer Stunde die größten inaktiven Arbeitsbereiche, sofern ihre Organisation sie [nicht davon ausnimmt](#free-disk-space-and-limit-workspace-size); reicht das nicht, wartet der Start, bis Arbeitsbereiche gelöscht werden, etwa solche, die du löschst, weil du sie nicht mehr brauchst, oder bis der Betreiber Speicherplatz freigibt. Ist das Deployment selbst voll, geht sein Platz an die Arbeit, die am längsten wartet, egal aus welcher Organisation, und jeder wartende Start erfährt, wann er an der Reihe ist:

- Ein Aufgabenlauf wartet in der Warteschlange. Er wird erneut versucht, sobald eine Sitzung endet, in deiner Organisation oder in einer anderen auf demselben Deployment. Ist das Deployment voll, wird er auch versucht, wenn er an der Reihe ist. Zusätzlich versucht Tale alle zwei Minuten einige wartende Läufe jeder Organisation. Ein frei gewordener Worker geht zuerst an den Agenten mit den wenigsten laufenden Läufen und dann an den Lauf, der am längsten wartet. Findet ein Lauf innerhalb von 12 Stunden nach seinem Start keinen Platz, schlägt er fehl und meldet, dass er zu lange auf einen freien Worker gewartet hat.
- Der Agent-Schritt einer Automatisierung versucht es erneut, ohne seine Wiederholungen zu verbrauchen: wenn er an der Reihe ist, falls das Deployment voll ist, sonst nach einer Pause, die länger wird, solange der Schritt weiter wartet, bis zu etwa zwei Minuten. Der Lauf zeigt währenddessen **Wartet auf einen Sandbox-Platz**. Findet er zwei Stunden lang keinen Platz, schlägt der Lauf mit diesem Grund fehl. Ein Arbeitsbereich, den ein Administrator löscht, ist kein fehlender Platz: Der Schritt schlägt dann sofort fehl, wie oben bei **Löschen** beschrieben.
- Das Crawling wartet, bis es an der Reihe ist, und setzt dann mit dem nächsten Stapel fort.

Erhöhe ein Arbeitslimit nur, wenn seine Plätze belegt sind und die neue Summe in die gemeinsame Kapazität passt. Ist das Deployment voll, schafft ein höheres Organisationslimit keine Infrastruktur. Für eigene Kapazität [verbindest du ein Gerät](/de/platform/admin/sandbox-devices): Neue Arbeitsbereiche starten dann darauf. Andernfalls lass den Betreiber Kapazität und Host-Ressourcen prüfen. Ein freier Containerplatz garantiert noch nicht genügend CPU, Arbeitsspeicher oder Speicherplatz.

Bei Zugangs- oder Modellproblemen hilft [KI-Provider](/de/platform/admin/providers), bei Ausgabengrenzen [Richtlinien und Limits](/de/platform/admin/governance/policies-and-limits). Self-Hosted-Betreiber finden die Deployment-Einstellung in der [Umgebungsreferenz](/de/self-hosted/configuration/environment-reference#sandbox-infrastructure).
