---
title: Vektordatenbank
description: Einstellungen > Vektordatenbank ist der Ort, an dem Admins wählen, welcher Vektorspeicher die Dokument-Embeddings dieser Organisation hält — das integrierte PostgreSQL, ein externes Qdrant oder ein externes PostgreSQL. Die Wahl gilt pro Organisation, sodass die Dokumente einer Org in ihrer eigenen Infrastruktur liegen können, während eine andere beim integrierten Speicher bleibt.
---

Einstellungen > Vektordatenbank ist der Ort, an dem ein Admin entscheidet, wo die Dokument-Embeddings dieser Organisation physisch liegen. Das Retrieval — die Suche hinter jeder fundierten Antwort — läuft gegen diesen Speicher, also bestimmt das hier gewählte Backend sowohl, wie die Dokumente der Org indexiert werden, als auch, welche Infrastruktur die Vektoren hält. Die Wahl ist auf die aktuelle Organisation beschränkt: sie zu ändern berührt nie die Daten einer anderen Org, und eine Org, die diese Seite nie öffnet, nutzt weiter den integrierten Speicher.

Diese Seite behandelt die Oberfläche: wie du das aktive Backend liest, wie du eine Org auf ihr eigenes Qdrant oder PostgreSQL richtest, wie du eine Verbindung testest, bevor du sie festschreibst, und was ein Backend-Wechsel mit bereits indexierten Dokumenten macht. Sie ist auf die Organisationseinstellungen-Berechtigung beschränkt, also erreicht sie nur ein Owner oder Admin.

## Was die Seite zeigt

Öffne **Einstellungen > Vektordatenbank** und die Seite nennt oben das aktive Backend der Org, dann ein Formular zum Ändern. Die zwei Banner über dem Formular sind der tragende Kontext: das erste sagt, dass die Konfiguration nur für die aktuelle Organisation gilt, das zweite erklärt, dass ein Backend-Wechsel die bestehenden Vektoren der Org automatisch im Hintergrund in den neuen Speicher spiegelt. Lies beide, bevor du etwas änderst — das zweite ist der Grund, warum ein Wechsel eine sichere Operation ist und nicht eine, die die Suche leer aussehen lässt.

Das Formular beginnt mit **Backend**, einer Wahl zwischen **Integriert** und **Extern**. Integriert ist der Default für jede Org und braucht keine Konfiguration: die Embeddings liegen in Tales eigenem PostgreSQL neben den Dokument-Metadaten. Wähle Extern und ein zweiter Selektor erscheint, **Externes Backend**, wo du zwischen **Qdrant (extern)** und **PostgreSQL (pgvector, extern)** wählst.

## Eine Organisation auf ihr eigenes Backend richten

Für **Qdrant (extern)** trage die **Qdrant-URL** ein, die die Tale-Dienste erreichen (zum Beispiel `http://qdrant:6333`), den **Collection**-Namen zum Speichern der Vektoren und einen **API-Schlüssel**, falls deine Qdrant-Instanz Authentifizierung verlangt. Lass **gRPC bevorzugen** aus, ausser dein Deployment ist dafür eingerichtet.

Für **PostgreSQL (pgvector, extern)** trage **Host**, **Port**, **Datenbank**, **Benutzer**, **SSL-Modus** und die **Tabelle** ein, die die Vektoren hält — Tale legt die Tabelle und die `vector`-Erweiterung an, wenn sie fehlen. Gib das **Passwort** an, das die Datenbank erwartet.

Die Felder **API-Schlüssel** und **Passwort** sind nur schreibend. Nach dem Speichern zeigt die Seite nur eine maskierte Vorschau; das Feld bei einem späteren Speichern leer zu lassen behält das gespeicherte Geheimnis unverändert. Geheimnisse sind im Ruhezustand verschlüsselt und werden nie in voller Länge an den Browser zurückgegeben.

## Vor dem Speichern testen

Klicke **Verbindung testen**, bevor du ein externes Backend festschreibst. Für Qdrant prüft Tale die URL mit dem angegebenen (oder gespeicherten) Schlüssel; für externes PostgreSQL öffnet es eine echte Verbindung über den Retrieval-Dienst und bestätigt, dass die `vector`-Erweiterung verfügbar ist. Eine erreichbare Datenbank ohne pgvector lässt den Test mit einer umsetzbaren Meldung scheitern — installiere die Erweiterung und versuche es erneut. Der Test nutzt die Werte im Formular, also kannst du ein mögliches Backend prüfen, ohne es zuerst zu speichern.

Wenn das Formular bereit ist, klicke **Änderungen speichern** und bestätige den Dialog. Die Änderung wird kurz nach dem Speichern wirksam — der Retrieval-Dienst übernimmt sie innerhalb eines kurzen Fensters, ohne Neustart. Andere Organisationen sind nicht betroffen.

## Ein Backend-Wechsel spiegelt bestehende Vektoren

Ein Backend-Wechsel erfordert keine Neuindexierung. Jedes Backend hält die Dokument-Embeddings in Tales eigenem PostgreSQL als Quelle der Wahrheit, daher spiegelt ein Wechsel einfach die bestehenden Vektoren der Org in den neuen Speicher — automatisch, im Hintergrund, beschränkt auf diese Organisation. Der Retrieval-Dienst bemerkt die Änderung innerhalb eines kurzen Fensters und kopiert die Vektoren hinüber; bei einer grossen Dokumentmenge kann das einige Minuten dauern, während derer die Vektorsuche kurzzeitig unvollständig sein und auf die Volltextsuche zurückfallen kann. Kein erneutes Hochladen, keine manuelle Neuindexierung, keine Planung einer Live-Umschaltung. Der Bestätigungsdialog nennt weiterhin das vorherige und das neue Backend, damit die Änderung im Moment des Festschreibens explizit ist.

Eine Neuindexierung ist nur nötig, wenn du das Embedding-_Modell_ der Org wechselst, nicht ihr Backend — ein neues Modell erzeugt Vektoren in einem anderen Raum, also müssen die alten neu erzeugt werden. Das ist unabhängig davon, wo die Vektoren gespeichert sind, und gilt für das integrierte Backend genauso wie für ein externes.

Eine Einschränkung trägt sich vom Embedding-Modell herüber: Orgs, die beim integrierten Speicher bleiben, teilen eine einzige Embedding-Dimension, müssen sich also auf ein Embedding-Modell einigen, das Vektoren derselben Breite erzeugt. Eine Org auf ihrem eigenen externen Backend entkommt dieser Einschränkung — ihre Collection oder Tabelle ist auf die eigenen Embedding-Dimensionen der Org festgelegt und unabhängig von jeder anderen Org.

## Wo das hingehört

Die Vektordatenbank ist der Boden unter dem Retrieval: jede fundierte Antwort, jede Dokumentsuche, jeder Workflow-Schritt, der in die Wissensbasis greift, löst über den hier gewählten Speicher auf. Der Grund, eine Org auf Integriert zu lassen, ist, dass es ohne zusätzliche Infrastruktur einfach funktioniert; der Grund, eine Org auf ihr eigenes Qdrant oder PostgreSQL zu verschieben, ist Daten-Residenz — die Vektoren dieses Mandanten in einer Infrastruktur zu halten, die er kontrolliert. Die natürliche nächste Lektüre ist [KI-Anbieter](/de/platform/admin/providers), da das Embedding-Modell, das die Dimensionen eines Vektors bestimmt, dort konfiguriert wird, und [Audit-Logs](/de/platform/admin/governance/audit-logs), wo jeder Backend-Wechsel einer Org mit dem Akteur und dem Vorher/Nachher-Backend festgehalten wird.
