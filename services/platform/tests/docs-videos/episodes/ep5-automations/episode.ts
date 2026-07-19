/**
 * Episode 5 — "Automations & approvals", the in-depth guide (pilot of the
 * deepened series). The viewer DOES the work on camera: reads the installed
 * triage workflow (trigger, score-step schema), triggers a real run with a
 * task created live on the board, follows its journal, opens the seeded red
 * run and traces the failure to its step, then approves an outbound customer
 * reply and finds the decision in the audit log seconds later.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — and TUTORIAL GRAMMAR: the voice announces every move before it
 * happens (signpost → action → observation → meaning), and silence does the
 * pacing — generous lead-ins after every cut, a tail beat after every landed
 * point. The approval card is a real pending `request_human_input`, the live
 * run a real `task.created` trigger paired with DOCS_TRIAGE_SCORES.
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
      // Cold open over the END STATE: a welcome, the promise, step-by-step.
      id: 'title',
      leadInMs: 1600,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode five. Today we take our time with automations: you’ll run one yourself, watch it handle a real task, debug one that failed, and approve an outgoing email — with your own click. We’ll go step by step. This page — the run journal — is where we’ll end up. But let’s start at the beginning.',
        de: 'Willkommen zu Episode fünf. Heute nehmen wir uns Zeit für Automatisierungen: Du lässt selbst eine laufen, siehst zu, wie sie eine echte Aufgabe übernimmt, untersuchst einen fehlgeschlagenen Lauf und gibst eine ausgehende E-Mail frei — mit deinem eigenen Klick. Wir gehen Schritt für Schritt vor. Diese Seite — die Ausführungen — ist unser Ziel. Aber fangen wir vorne an.',
        fr: 'Bienvenue dans l’épisode cinq. Aujourd’hui, on prend le temps avec les automatisations : tu vas en lancer une toi-même, la regarder prendre une vraie tâche, examiner une exécution qui a échoué, et valider l’envoi d’un e-mail — d’un clic. On avance étape par étape. Cette page — les exécutions — c’est notre destination. Mais commençons par le début.',
      },
    },
    {
      id: 'context',
      chapterByLocale: { en: 'The job', de: 'Der Job', fr: 'Le job' },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 21_000,
      narration: {
        en: 'This is a project board — episode six tours it properly. For now, just look at the To do column: new tasks, nobody assigned yet. Someone has to read each one and pick the right owner. That’s the job we’re about to hand to an automation.',
        de: 'Das ist ein Projekt-Board — Episode sechs zeigt es in Ruhe. Schau erst mal nur auf die Spalte Zu erledigen: neue Aufgaben, noch niemand zugewiesen. Jemand muss jede lesen und die passende Person auswählen. Genau diesen Job geben wir gleich einer Automatisierung ab.',
        fr: 'Voici un tableau de projet — l’épisode six le visite en détail. Pour l’instant, regarde juste la colonne À faire : des tâches nouvelles, encore sans responsable. Quelqu’un doit lire chacune et choisir la bonne personne. C’est exactement ce travail qu’on va confier à une automatisation.',
      },
    },
    {
      id: 'catalog',
      chapterByLocale: {
        en: 'Automations',
        de: 'Automatisierungen',
        fr: 'Automatisations',
      },
      leadInMs: 1200,
      tailMs: 1500,
      minMs: 20_000,
      narration: {
        en: 'First, let’s see where automations come from. We open Automations in the sidebar… and switch to the All tab. This is the catalog: ready-made bundles, like syncing a mailbox or resolving GitHub issues. One install, and they set themselves up.',
        de: 'Zuerst: Woher kommen Automatisierungen? Wir öffnen Automatisierungen in der Seitenleiste … und wechseln auf Alle Automatisierungen. Das ist der Katalog: fertige Pakete, etwa ein Postfach synchronisieren oder GitHub-Issues lösen. Einmal installieren, und sie richten sich selbst ein.',
        fr: 'D’abord, voyons d’où viennent les automatisations. On ouvre Automatisations dans la barre latérale… puis l’onglet Toutes les automatisations. Voici le catalogue : des lots prêts à l’emploi — synchroniser une boîte mail, résoudre des issues GitHub. Une installation, et ils se mettent en place tout seuls.',
      },
    },
    {
      // A real click: the bundle's preview panel, read calmly, then closed.
      id: 'panel',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 19_000,
      narration: {
        en: 'Before installing anything, you can look inside. We click a bundle… and a panel opens: these are the workflows, agents, and views it would add. Nothing runs yet. We close it again — because what we need today is already installed.',
        de: 'Bevor du etwas installierst, kannst du hineinschauen. Wir klicken auf ein Paket … und ein Panel öffnet sich: die Workflows, Agenten und Ansichten, die es mitbringen würde. Noch läuft nichts. Wir schließen es wieder — denn was wir heute brauchen, ist schon installiert.',
        fr: 'Avant d’installer quoi que ce soit, tu peux regarder dedans. On clique sur un lot… et un panneau s’ouvre : les workflows, les agents et les vues qu’il apporterait. Rien ne tourne encore. On le referme — ce qu’il nous faut aujourd’hui est déjà installé.',
      },
    },
    {
      id: 'installed',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Here, under Installed: task triage. It came with this workspace and has been running quietly in the background. Let’s open it and read what it actually does — always worth doing before you trust an automation.',
        de: 'Hier, unter Installiert: die Aufgaben-Triage. Sie kam mit dem Arbeitsbereich und läuft seit Beginn leise mit. Öffnen wir sie und lesen nach, was sie eigentlich tut — das lohnt sich immer, bevor du einer Automatisierung vertraust.',
        fr: 'Ici, côté Installées : le triage des tâches. Il est arrivé avec l’espace de travail et tourne discrètement depuis le début. Ouvrons-le pour lire ce qu’il fait vraiment — ça vaut toujours le coup avant de faire confiance à une automatisation.',
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
      leadInMs: 2600,
      tailMs: 1800,
      minMs: 21_000,
      narration: {
        en: 'This is the workflow behind the automation. Take a second to read it, top to bottom. A trigger: every new task. Then three steps — an agent scores the task, the score decides the route, and a report gets written. That’s all it does.',
        de: 'Das ist der Workflow hinter der Automatisierung. Nimm dir einen Moment und lies ihn von oben nach unten. Ein Auslöser: jede neue Aufgabe. Dann drei Schritte — ein Agent bewertet die Aufgabe, der Score entscheidet die Route, ein Bericht wird geschrieben. Mehr macht sie nicht.',
        fr: 'Voici le workflow derrière l’automatisation. Prends un instant pour le lire, de haut en bas. Un déclencheur : chaque nouvelle tâche. Puis trois étapes — un agent note la tâche, le score décide de la route, un rapport s’écrit. C’est tout ce qu’elle fait.',
      },
    },
    {
      // The score step opened calmly: the schema is the safety net.
      id: 'step-detail',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 21_000,
      narration: {
        en: 'Now let’s click the score step and look at it up close. Here’s what the agent must return: a candidate, a confidence number, and a reason — a fixed format, called a schema. If the model returns anything else, the run stops instead of guessing. Remember this schema — we’ll meet it again in a minute.',
        de: 'Jetzt klicken wir auf den Bewertungsschritt und sehen ihn uns genauer an. Das muss der Agent liefern: einen Kandidaten, einen Konfidenzwert und eine Begründung — ein festes Format, ein Schema. Liefert das Modell irgendetwas anderes, stoppt der Lauf, statt zu raten. Merk dir dieses Schema — wir sehen es gleich wieder.',
        fr: 'Maintenant, cliquons sur l’étape de score pour la voir de près. Voilà ce que l’agent doit renvoyer : un candidat, un niveau de confiance et une raison — un format fixe, un schéma. Si le modèle renvoie autre chose, l’exécution s’arrête au lieu de deviner. Retiens ce schéma — on va le recroiser dans une minute.',
      },
    },
    {
      id: 'trigger',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Next tab over: Triggers. This is when the automation wakes up — for every new task, and whenever someone moves a task from Backlog to To do. Tasks that already have an owner are skipped: nothing to triage there.',
        de: 'Ein Tab weiter: Trigger. Hier steht, wann die Automatisierung aufwacht — bei jeder neuen Aufgabe, und wenn jemand eine von Backlog auf Zu erledigen zieht. Aufgaben, die schon jemandem gehören, werden übersprungen: Da gibt es nichts zu sichten.',
        fr: 'L’onglet suivant : Déclencheurs. C’est là qu’on voit quand elle se réveille — à chaque nouvelle tâche, et quand quelqu’un passe une tâche du backlog à « À faire ». Les tâches qui ont déjà un responsable sont ignorées : rien à trier là.',
      },
    },
    {
      // The tester, read honestly — the real trigger comes next.
      id: 'tester',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 19_000,
      narration: {
        en: 'There’s also a safe way to try it: Test workflow. It shows exactly what input a run expects, and Execute would write a real run into the journal. We’ll do something better, though — trigger it the way your team will, with a real task.',
        de: 'Es gibt auch einen sicheren Weg zum Ausprobieren: Workflow testen. Dort siehst du genau, welchen Input ein Lauf erwartet, und Ausführen würde einen echten Lauf ins Journal schreiben. Wir machen es aber besser — wir lösen sie so aus, wie dein Team es wird: mit einer echten Aufgabe.',
        fr: 'Il existe aussi un moyen sûr d’essayer : Tester le workflow. Tu y vois l’entrée exacte qu’une exécution attend, et Exécuter écrirait une vraie exécution dans le journal. On va faire mieux, cela dit — la déclencher comme ton équipe le fera : avec une vraie tâche.',
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
      leadInMs: 2600,
      tailMs: 1800,
      minMs: 29_000,
      narration: {
        en: 'Back on the board. We create a task — ‘Prepare the launch-day social posts’ — and now… we don’t touch anything. Watch the card. A few seconds pass… and there: an assignee appeared, on its own. The automation read the task, scored it, and picked the Assistant.',
        de: 'Zurück auf dem Board. Wir erstellen eine Aufgabe — „Social-Posts für den Launch-Tag vorbereiten“ — und jetzt … fassen wir nichts mehr an. Beobachte die Karte. Ein paar Sekunden … und da: Eine Zuweisung ist erschienen, ganz von selbst. Die Automatisierung hat gelesen, bewertet und den Assistenten gewählt.',
        fr: 'Retour sur le tableau. On crée une tâche — « Préparer les posts sociaux du jour J » — et maintenant… on ne touche plus à rien. Regarde la carte. Quelques secondes… et voilà : une assignation est apparue, toute seule. L’automatisation a lu, noté, et choisi l’Assistant.',
      },
    },
    {
      // On-camera navigation back to the journal — the viewer learns the path.
      id: 'live-journal',
      leadInMs: 1200,
      tailMs: 1800,
      minMs: 25_000,
      narration: {
        en: 'Let’s verify that. We go back to Automations… open task triage… and its Executions tab. There it is — the newest run, seconds old. We open it, and now you can read everything: what the trigger saw, the score with its reason, and what each step cost.',
        de: 'Prüfen wir das nach. Wir gehen zurück zu Automatisierungen … öffnen die Aufgaben-Triage … und ihren Tab Ausführungen. Da ist er — der neueste Lauf, wenige Sekunden alt. Wir öffnen ihn, und jetzt kannst du alles nachlesen: was der Auslöser sah, den Score samt Begründung, und was jeder Schritt gekostet hat.',
        fr: 'Vérifions ça. On retourne dans Automatisations… on ouvre le triage des tâches… puis son onglet Exécutions. La voilà — l’exécution la plus récente, vieille de quelques secondes. On l’ouvre, et là tu peux tout relire : ce que le déclencheur a vu, le score et sa raison, et le coût de chaque étape.',
      },
    },
    {
      id: 'failure',
      chapterByLocale: {
        en: 'When it fails',
        de: 'Wenn es schiefgeht',
        fr: 'Quand ça échoue',
      },
      leadInMs: 1200,
      tailMs: 1800,
      minMs: 25_000,
      narration: {
        en: 'Now, the run you’ll learn the most from — this red one. Let’s open it and read the journal together. The trigger fired, the score step ran… and here it stopped: the agent’s answer was missing the confidence number, so the schema rejected it. The run failed — on purpose — instead of assigning a task on bad data.',
        de: 'Und jetzt der Lauf, von dem du am meisten lernst — dieser rote. Öffnen wir ihn und lesen das Journal zusammen. Der Auslöser kam, der Bewertungsschritt lief … und hier stoppte es: In der Antwort des Agenten fehlte der Konfidenzwert, also hat das Schema sie abgelehnt. Der Lauf schlug fehl — mit Absicht — statt mit kaputten Daten eine Aufgabe zu vergeben.',
        fr: 'Et maintenant, l’exécution qui t’apprend le plus — cette ligne rouge. Ouvrons-la et lisons le journal ensemble. Le déclencheur est passé, l’étape de score a tourné… et là, arrêt : la réponse de l’agent n’avait pas le niveau de confiance, donc le schéma l’a refusée. L’exécution a échoué — volontairement — plutôt que d’assigner une tâche sur de mauvaises données.',
      },
    },
    {
      id: 'diagnose',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 17_000,
      narration: {
        en: 'And fixing it has a clear path. The journal named the step; the step holds the prompt and the schema; and under Configuration you’ll find the retries. Journal, step, fix, run again — that’s the whole loop.',
        de: 'Und die Reparatur hat einen klaren Weg. Das Journal hat den Schritt genannt; im Schritt stehen Prompt und Schema; und unter Konfiguration findest du die Wiederholungen. Journal, Schritt, Korrektur, neu laufen lassen — das ist die ganze Schleife.',
        fr: 'Et la réparation suit un chemin clair. Le journal a nommé l’étape ; dans l’étape, le prompt et le schéma ; et sous Configuration, les reprises. Journal, étape, correction, on relance — c’est toute la boucle.',
      },
    },
    {
      id: 'approval',
      chapterByLocale: { en: 'Approvals', de: 'Freigaben', fr: 'Validations' },
      leadInMs: 2000,
      tailMs: 1500,
      minMs: 33_000,
      narration: {
        en: 'One question is left: what happens when an automation wants to reach the outside world? Let’s find out in chat. We ask the Assistant to draft a reply to a customer — and to send it. The draft appears… and then everything stops. Sending an email leaves the workspace, so this step waits for a person.',
        de: 'Eine Frage bleibt: Was passiert, wenn eine Automatisierung nach draußen will? Sehen wir es uns im Chat an. Wir bitten den Assistenten, eine Antwort an einen Kunden zu entwerfen — und sie zu senden. Der Entwurf erscheint … und dann hält alles an. E-Mail verlässt den Arbeitsbereich, also wartet dieser Schritt auf einen Menschen.',
        fr: 'Il reste une question : que se passe-t-il quand une automatisation veut sortir vers l’extérieur ? Allons voir dans le chat. On demande à l’Assistant de rédiger une réponse à un client — et de l’envoyer. Le brouillon apparaît… puis tout s’arrête. Envoyer un e-mail sort de l’espace de travail, donc cette étape attend une personne.',
      },
    },
    {
      // Read, add the note, submit — only now does the mail go out.
      id: 'card',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 19_000,
      narration: {
        en: 'Take your time and read the draft. It’s good. We add a short note… and submit the response. Only now does the mail actually go out. The agent wrote it — but sending it was your decision.',
        de: 'Lass dir Zeit und lies den Entwurf. Er ist gut. Wir ergänzen eine kurze Notiz … und senden die Antwort ab. Erst jetzt geht die Mail wirklich raus. Geschrieben hat sie der Agent — entschieden hast du.',
        fr: 'Prends le temps de lire le brouillon. Il est bon. On ajoute une petite note… et on soumet la réponse. C’est seulement maintenant que le mail part vraiment. L’agent l’a écrit — mais l’envoyer, c’était ta décision.',
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
      leadInMs: 2400,
      tailMs: 1800,
      minMs: 18_000,
      narration: {
        en: 'One last stop: the audit log, in Settings. Here’s the approval we just made — who decided, what, and when. If anyone ever asks who sent that mail, you don’t have to remember. This page does.',
        de: 'Ein letzter Halt: das Audit-Log, in den Einstellungen. Hier steht die Freigabe von eben — wer entschieden hat, was, und wann. Fragt später jemand, wer diese Mail geschickt hat, musst du dich nicht erinnern. Diese Seite tut es.',
        fr: 'Dernier arrêt : le journal d’audit, dans les réglages. Voici la validation qu’on vient de faire — qui a décidé, quoi, et quand. Si un jour on te demande qui a envoyé ce mail, pas besoin de mémoire. Cette page s’en souvient.',
      },
    },
    {
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 18_000,
      narration: {
        en: 'And that’s the episode. You read a workflow before trusting it, triggered a real run, followed its journal, traced a failure to its step — and kept the final say on an outgoing email. The docs on automations and approvals take each of these further.',
        de: 'Und das war die Episode. Du hast einen Workflow gelesen, bevor du ihm vertraust, einen echten Lauf ausgelöst, sein Journal verfolgt, einen Fehler bis zu seinem Schritt zurückverfolgt — und bei einer ausgehenden Mail das letzte Wort behalten. Die Doku zu Automatisierungen und Freigaben führt jedes Thema weiter.',
        fr: 'Et voilà l’épisode. Tu as lu un workflow avant de lui faire confiance, déclenché une vraie exécution, suivi son journal, remonté un échec jusqu’à son étape — et gardé le dernier mot sur un mail sortant. La doc sur les automatisations et les validations approfondit chaque sujet.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: projects — where your team and its agents share one board. See you in episode six.',
        de: 'Nächstes Mal: Projekte — wo dein Team und seine Agenten ein Board teilen. Bis zur sechsten Episode.',
        fr: 'La prochaine fois : les projets — où ton équipe et ses agents partagent un même tableau. À bientôt pour l’épisode six.',
      },
    },
  ],
} as const;
