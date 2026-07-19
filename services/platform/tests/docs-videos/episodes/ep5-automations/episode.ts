/**
 * Episode 5 — "Automations & approvals", the in-depth guide (pilot of the
 * deepened series). The viewer DOES the work on camera: reads the installed
 * triage workflow (trigger, score-step schema), triggers a real run with a
 * task created live on the board, follows its journal, opens the seeded red
 * run and traces the failure to its step, then approves an outbound customer
 * reply and finds the decision in the audit log seconds later.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — contractions, action + reason together, no aphorisms. The approval
 * card is a real pending `request_human_input`, the live run a real
 * `task.created` trigger paired with a DOCS_TRIAGE_SCORES entry per locale.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** What the reviewer types into the approval card's adjustments field. */
export const APPROVAL_FIELD_TEXT: Record<Locale, string> = {
  en: 'Looks good — send it as is.',
  de: 'Passt — bitte so senden.',
  fr: 'Parfait — envoie telle quelle.',
};

/** The task created live on the board — pairs with a DOCS_TRIAGE_SCORES
 * entry per locale (score 0.81 → auto-assign), archived by cleanup. */
export const CAMERA_TASK_TITLE: Record<Locale, string> = {
  en: 'Prepare the launch-day social posts',
  de: 'Social-Posts für den Launch-Tag vorbereiten',
  fr: 'Préparer les posts sociaux du jour J',
};

export const EP5_AUTOMATIONS: EpisodeSpec = {
  id: 'ep5-automations',
  section: 'tutorials',
  titleByLocale: {
    en: 'Automations & approvals',
    de: 'Automatisierungen & Freigaben',
    fr: 'Automatisations & validations',
  },
  episodeLabelByLocale: {
    en: 'Episode 5',
    de: 'Episode 5',
    fr: 'Épisode 5',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The gated ask — pairs with the request_human_input docs-reply. */
  heroPromptByLocale: {
    en: 'Draft a reply to Bergmann Logistics about their annual discount question and send it to them.',
    de: 'Entwirf eine Antwort an Bergmann Logistics zur Frage nach dem Jahresrabatt und schick sie raus.',
    fr: 'Rédige une réponse à Bergmann Logistics sur la remise annuelle et envoie-la.',
  },
  scenes: [
    {
      // Cold open over the END STATE: the run journal the episode ends in.
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'By the end of this episode, you’ll have run an automation yourself, watched it triage a real task, debugged a failed run, and approved an outbound email with your own click. That’s the whole arc — let’s start where it ends: the run journal.',
        de: 'Am Ende dieser Episode hast du eine Automatisierung selbst laufen lassen, ihr beim Einsortieren einer echten Aufgabe zugesehen, einen roten Lauf untersucht — und eine ausgehende E-Mail mit deinem eigenen Klick freigegeben. Das ist der Bogen. Fangen wir da an, wo er endet: bei den Ausführungen.',
        fr: 'À la fin de cet épisode, tu auras lancé une automatisation toi-même, regardé une vraie tâche se faire trier, débogué une exécution en échec — et validé l’envoi d’un e-mail d’un clic. Tout le parcours. Commençons par la fin : les exécutions.',
      },
    },
    {
      id: 'context',
      chapterByLocale: { en: 'The job', de: 'Der Job', fr: 'Le job' },
      chapterTransition: 'cut',
      minMs: 11_000,
      narration: {
        en: 'Here’s the job. New tasks land on this board all day, and someone has to read each one and pick the right owner. We’ll hand that to an automation — and you’ll see exactly how far to trust it.',
        de: 'Das ist der Job: Auf diesem Board landen den ganzen Tag neue Aufgaben, und jemand muss jede lesen und die richtige Person finden. Genau das geben wir gleich einer Automatisierung ab — und du siehst dabei, wie weit du ihr trauen kannst.',
        fr: 'Voilà le boulot : des tâches arrivent sur ce tableau toute la journée, et quelqu’un doit lire chacune et trouver le bon responsable. C’est ce qu’on va confier à une automatisation — et tu verras précisément jusqu’où lui faire confiance.',
      },
    },
    {
      id: 'catalog',
      chapterByLocale: {
        en: 'Automations',
        de: 'Automatisierungen',
        fr: 'Automatisations',
      },
      leadInMs: 900,
      minMs: 10_000,
      narration: {
        en: 'First: where automations come from. The catalog ships ready-made ones — sync a mailbox, resolve GitHub issues. One install, and they file themselves into your workspace.',
        de: 'Zuerst: Woher kommen Automatisierungen? Der Katalog bringt fertige mit — ein Postfach synchronisieren, GitHub-Issues lösen. Einmal installieren, und sie richten sich selbst ein.',
        fr: 'D’abord, d’où viennent les automatisations. Le catalogue en livre des toutes prêtes — synchroniser une boîte mail, résoudre des issues GitHub. Une installation, et elles se mettent en place toutes seules.',
      },
    },
    {
      // A real click: the bundle's preview panel, then Escape.
      id: 'panel',
      minMs: 12_000,
      narration: {
        en: 'Click a bundle and you see exactly what you’d get: the workflows, the agents, the views it ships. Nothing runs until you install it. We can skip it today — the one we need is already here.',
        de: 'Klick auf ein Paket, und du siehst genau, was du bekommst: die Workflows, die Agenten, die Ansichten. Nichts läuft, bevor du nicht installierst. Das können wir heute überspringen — was wir brauchen, läuft hier schon.',
        fr: 'Clique sur un lot et tu vois exactement ce que tu obtiens : les workflows, les agents, les vues. Rien ne tourne avant que tu installes. On peut passer aujourd’hui — ce qu’il nous faut tourne déjà ici.',
      },
    },
    {
      id: 'installed',
      minMs: 10_000,
      narration: {
        en: 'Under Installed: task triage. It set itself up with this workspace, and it’s been running quietly the whole series. Before we trust it any further, let’s read what it actually does.',
        de: 'Unter Installiert: die Aufgaben-Triage. Sie hat sich mit dem Arbeitsbereich selbst eingerichtet und läuft seit Beginn der Serie leise mit. Bevor wir ihr weiter vertrauen, lesen wir nach, was sie eigentlich tut.',
        fr: 'Côté Installées : le triage des tâches. Il s’est mis en place avec l’espace de travail et tourne discrètement depuis le début de la série. Avant de lui faire davantage confiance, lisons ce qu’il fait vraiment.',
      },
    },
    {
      id: 'editor',
      chapterByLocale: {
        en: 'Read it first',
        de: 'Erst lesen',
        fr: 'Lire d’abord',
      },
      chapterTransition: 'cut',
      minMs: 12_000,
      narration: {
        en: 'Here’s the workflow behind it — and you can read it before you ever let it run. A trigger at the top: every new task. Then three steps — score the task with an agent, route it on the score, report what happened.',
        de: 'Das ist der Workflow dahinter — und du kannst ihn lesen, bevor er je läuft. Oben ein Auslöser: jede neue Aufgabe. Dann drei Schritte — ein Agent bewertet die Aufgabe, der Score entscheidet die Route, ein Bericht hält alles fest.',
        fr: 'Voici le workflow derrière — et tu peux le lire avant même qu’il tourne. En haut, un déclencheur : chaque nouvelle tâche. Puis trois étapes — un agent note la tâche, le score décide de la route, un rapport garde la trace.',
      },
    },
    {
      // Click the score step open: the schema is the safety net.
      id: 'step-detail',
      minMs: 13_000,
      narration: {
        en: 'Open the score step and you see exactly what the agent has to return: a candidate, a confidence number, a reason — structured output, with a schema. That schema is your safety net. If the model returns anything else, the run stops instead of guessing. Remember that — it comes back in a minute.',
        de: 'Öffne den Bewertungsschritt, und du siehst, was der Agent liefern muss: einen Kandidaten, einen Konfidenzwert, eine Begründung — strukturierte Ausgabe, mit Schema. Das Schema ist dein Sicherheitsnetz: Liefert das Modell irgendetwas anderes, stoppt der Lauf, statt zu raten. Merk dir das — es kommt gleich zurück.',
        fr: 'Ouvre l’étape de score et tu vois ce que l’agent doit renvoyer : un candidat, un niveau de confiance, une raison — une sortie structurée, avec un schéma. Ce schéma, c’est ton filet de sécurité : si le modèle renvoie autre chose, l’exécution s’arrête au lieu de deviner. Garde ça en tête — ça revient dans une minute.',
      },
    },
    {
      id: 'trigger',
      minMs: 10_000,
      narration: {
        en: 'The Triggers tab says when it wakes up: every new task, and every task someone moves from Backlog to To do. The first step filters out tasks that already have an owner — those need no triage.',
        de: 'Der Tab Trigger sagt, wann sie aufwacht: bei jeder neuen Aufgabe, und wenn jemand eine von Backlog auf Zu erledigen zieht. Der erste Schritt sortiert aus, was schon jemandem gehört — da gibt es nichts zu sichten.',
        fr: 'L’onglet Déclencheurs dit quand il se réveille : à chaque nouvelle tâche, et quand quelqu’un passe une tâche du backlog à « À faire ». La première étape écarte celles qui ont déjà un responsable — rien à trier là.',
      },
    },
    {
      // The tester panel, read honestly — the real trigger comes next.
      id: 'tester',
      minMs: 11_000,
      narration: {
        en: 'You don’t have to wait for a trigger. Test workflow shows the exact input a run expects, and Execute writes a real run into the journal. We’ll go one better and trigger it the way your team will — with a real task.',
        de: 'Du musst nicht auf einen Auslöser warten. Workflow testen zeigt dir, welchen Input ein Lauf erwartet, und Ausführen schreibt einen echten Lauf ins Journal. Wir machen es noch besser und lösen ihn so aus, wie dein Team es wird: mit einer echten Aufgabe.',
        fr: 'Pas besoin d’attendre un déclencheur. Tester le workflow montre l’entrée exacte qu’une exécution attend, et Exécuter écrit une vraie exécution dans le journal. On va faire mieux : le déclencher comme ton équipe le fera — avec une vraie tâche.',
      },
    },
    {
      id: 'for-real',
      chapterByLocale: {
        en: 'Run it for real',
        de: 'Echt laufen lassen',
        fr: 'En vrai',
      },
      chapterTransition: 'cut',
      minMs: 20_000,
      narration: {
        en: 'So — a real task: ‘Prepare the launch-day social posts’. Create… and hands off. A few seconds pass, and the assignee lands on the card by itself. The automation read it, scored it, and picked the Assistant. Nobody touched anything.',
        de: 'Also — eine echte Aufgabe: „Social-Posts für den Launch-Tag vorbereiten“. Erstellen … und Hände weg. Ein paar Sekunden, dann erscheint die Zuweisung von selbst auf der Karte. Die Automatisierung hat gelesen, bewertet und den Assistenten ausgewählt. Niemand hat etwas angefasst.',
        fr: 'Donc — une vraie tâche : « Préparer les posts sociaux du jour J ». Créer… et on ne touche plus. Quelques secondes, et l’assignation apparaît toute seule sur la carte. L’automatisation a lu, noté, choisi l’Assistant. Personne n’a rien touché.',
      },
    },
    {
      // On-camera navigation back to the journal — the viewer learns the path.
      id: 'live-journal',
      minMs: 16_000,
      narration: {
        en: 'The proof lives with the automation. Back through the rail: Automations, task triage, Executions — and there’s the new row, seconds old. Open it and read: what the trigger saw, the score and its reason, the route, what each step cost. Every run leaves this.',
        de: 'Der Beleg liegt bei der Automatisierung. Zurück über die Leiste: Automatisierungen, Aufgaben-Triage, Ausführungen — und da ist die frische Zeile, ein paar Sekunden alt. Öffne sie und lies: was der Auslöser sah, den Score samt Begründung, die Route, die Kosten jedes Schritts. Diese Spur hinterlässt jeder Lauf.',
        fr: 'La preuve vit avec l’automatisation. Retour par la barre : Automatisations, triage des tâches, Exécutions — et voilà la ligne toute fraîche, vieille de quelques secondes. Ouvre-la et lis : ce que le déclencheur a vu, le score et sa raison, la route, le coût de chaque étape. Chaque exécution laisse cette trace.',
      },
    },
    {
      id: 'failure',
      chapterByLocale: {
        en: 'When it fails',
        de: 'Wenn es schiefgeht',
        fr: 'Quand ça échoue',
      },
      minMs: 14_000,
      narration: {
        en: 'Now the row that teaches you the most: a red one. Read the journal top to bottom — the trigger fired, the score step ran… and there it stopped. The agent’s answer was missing the confidence field, so the schema rejected it, and the run failed instead of assigning a task on bad data. That’s your safety net, doing its job.',
        de: 'Jetzt die Zeile, die dich am meisten lehrt: eine rote. Lies das Journal von oben nach unten — der Auslöser kam, der Bewertungsschritt lief … und da stoppte es. In der Antwort des Agenten fehlte der Konfidenzwert, das Schema hat sie abgelehnt, und der Lauf schlug fehl, statt mit kaputten Daten eine Aufgabe zu vergeben. Genau dafür ist dein Sicherheitsnetz da.',
        fr: 'Maintenant, la ligne qui t’apprend le plus : une rouge. Lis le journal de haut en bas — le déclencheur est passé, l’étape de score a tourné… et là, tout s’arrête. La réponse de l’agent n’avait pas le niveau de confiance, le schéma l’a refusée, et l’exécution a échoué au lieu d’assigner une tâche sur de mauvaises données. Ton filet de sécurité, en plein travail.',
      },
    },
    {
      id: 'diagnose',
      minMs: 11_000,
      narration: {
        en: 'And the failure has a fix path. The journal names the step; the step holds the prompt and the schema; Configuration carries the retries. Journal, step, fix, run again — that’s the whole debugging loop.',
        de: 'Und der Fehler hat einen Reparaturweg. Das Journal nennt den Schritt, im Schritt stehen Prompt und Schema, in der Konfiguration die Wiederholungen. Journal, Schritt, Korrektur, neu laufen lassen — mehr ist Fehlersuche hier nicht.',
        fr: 'Et l’échec a un chemin de réparation. Le journal nomme l’étape ; dans l’étape, le prompt et le schéma ; dans Configuration, les reprises. Journal, étape, correction, on relance — le débogage, c’est ça.',
      },
    },
    {
      id: 'approval',
      chapterByLocale: { en: 'Approvals', de: 'Freigaben', fr: 'Validations' },
      // Rail to chat + ask + draft streams + the card appears.
      minMs: 26_000,
      narration: {
        en: 'One more boundary matters: the outside world. We ask the Assistant to draft a reply to a customer — and send it. The draft streams in… and then everything stops. Sending mail leaves the workspace, so that step waits for a person. You.',
        de: 'Eine Grenze fehlt noch: die Außenwelt. Wir bitten den Assistenten, eine Antwort an einen Kunden zu entwerfen — und zu senden. Der Entwurf streamt herein … und dann hält alles an. E-Mail verlässt den Arbeitsbereich, also wartet dieser Schritt auf einen Menschen. Auf dich.',
        fr: 'Reste une frontière : le monde extérieur. On demande à l’Assistant de rédiger une réponse à un client — et de l’envoyer. Le brouillon arrive en direct… puis tout s’arrête. Envoyer un mail sort de l’espace de travail, donc cette étape attend une personne. Toi.',
      },
    },
    {
      // Read, type the note, submit — the ack streams.
      id: 'card',
      minMs: 14_000,
      narration: {
        en: 'Read the draft — it’s good. We type one note in the box, submit the response… and only now does the mail actually go out. The agent did the writing. The send stayed yours.',
        de: 'Lies den Entwurf — er ist gut. Wir tippen eine Notiz ins Feld, senden die Antwort ab … und erst jetzt geht die Mail wirklich raus. Geschrieben hat der Agent. Gesendet hast du.',
        fr: 'Lis le brouillon — il est bon. On tape une note dans le champ, on soumet la réponse… et c’est seulement maintenant que le mail part vraiment. L’agent a écrit. L’envoi, c’était toi.',
      },
    },
    {
      id: 'verify',
      chapterByLocale: {
        en: 'The record',
        de: 'Der Nachweis',
        fr: 'La preuve',
      },
      chapterTransition: 'cut',
      minMs: 12_000,
      narration: {
        en: 'Last stop: the audit log, under Settings. There’s our approval — who decided, what, and when: seconds ago. When someone asks ‘who sent that mail?’, you don’t reconstruct it from memory. You open this page and read it.',
        de: 'Letzter Halt: das Audit-Log, in den Einstellungen. Da steht unsere Freigabe — wer entschieden hat, was, und wann: vor ein paar Sekunden. Fragt jemand „Wer hat diese Mail geschickt?“, musst du nichts rekonstruieren. Du öffnest diese Seite und liest es ab.',
        fr: 'Dernier arrêt : le journal d’audit, dans les réglages. Voilà notre validation — qui a décidé, quoi, et quand : il y a quelques secondes. Si on te demande « qui a envoyé ce mail ? », tu ne reconstitues rien. Tu ouvres cette page et tu lis.',
      },
    },
    {
      id: 'recap',
      minMs: 9_000,
      narration: {
        en: 'That’s automations. You read a workflow before trusting it, triggered a real run, followed its journal, traced a failure to its step, and kept the send button. The automations and approvals docs go deeper. Next episode: projects — your team and its agents at one board.',
        de: 'Das sind Automatisierungen. Du hast einen Workflow gelesen, bevor du ihm vertraust, einen echten Lauf ausgelöst, sein Journal verfolgt, einen Fehler bis zu seinem Schritt zurückverfolgt — und das Senden blieb bei dir. Die Doku zu Automatisierungen und Freigaben geht tiefer. Nächste Episode: Projekte — dein Team und seine Agenten an einem Board.',
        fr: 'Voilà les automatisations. Tu as lu un workflow avant de lui faire confiance, déclenché une vraie exécution, suivi son journal, remonté un échec jusqu’à son étape — et gardé le bouton d’envoi. La doc sur les automatisations et les validations va plus loin. Prochain épisode : les projets — ton équipe et ses agents autour d’un même tableau.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Everything you just did is written up in the documentation, step by step. See you in episode six.',
        de: 'Alles, was du gerade getan hast, steht Schritt für Schritt in der Dokumentation. Bis zur sechsten Episode.',
        fr: 'Tout ce que tu viens de faire est dans la documentation, pas à pas. À bientôt pour l’épisode six.',
      },
    },
  ],
} as const;
