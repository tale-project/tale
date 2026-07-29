/**
 * Episode 6 — "Projects: the team and the AI at one table", the in-depth
 * guide. The viewer runs a board where an agent is a teammate: they create
 * a task ON CAMERA and watch the triage automation assign it (the avatar
 * lands by itself), read the automated reasoning comment on the card, trace
 * the run in the automation's Executions (the path episode five taught),
 * then meet the deliberate NON-assignment — the seeded below-the-bar task
 * that got a suggestion comment instead of an owner ("sign-offs stay with
 * people", the pitfall beat played honestly). Files show
 * the context agents draft from; the verify beat reads both outcomes off
 * the board side by side.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — TUTORIAL GRAMMAR (signpost → action → observation → meaning),
 * every move announced BEFORE it happens, and silence-led pacing: generous
 * lead-ins after each chapter card, a tail beat after every landed point,
 * minMs floors carrying the waits.
 *
 * The on-camera task pairs with its DOCS_TRIAGE_SCORES entry per locale
 * (confidence 0.82 — above the auto-assign bar, so the agent visibly takes
 * it) and is archived off camera via the cleanup registry. The suggestion
 * beat reads the SEEDED below-the-bar task (0.55 → suggestion branch);
 * its per-locale titles live in scenes.ts as anchor data.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The task created on camera — pairs with DOCS_TRIAGE_SCORES per locale. */
export const CAMERA_TASK_TITLE: Record<Locale, string> = {
  en: 'Draft the launch announcement post',
  de: 'Launch-Ankündigung entwerfen',
  fr: 'Rédiger l’annonce de lancement',
};

export const EP6_PROJECTS: EpisodeSpec = {
  id: 'ep6-projects',
  section: 'tutorials',
  titleByLocale: {
    en: 'Projects: the team and the AI at one table',
    de: 'Projekte: Team und KI an einem Tisch',
    fr: 'Projets : l’équipe et l’IA à la même table',
  },
  episodeLabelByLocale: {
    en: 'Episode 6',
    de: 'Episode 6',
    fr: 'Épisode 6',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  scenes: [
    {
      // Cold open over the END STATE surface: the relaunch board the whole
      // episode plays on. The card lifts BEFORE the voice names the board.
      id: 'title',
      leadInMs: 1600,
      tailMs: 1500,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode six. Today your team gets a new colleague: an agent that works on the project board. You’ll create a task and watch it get picked up, read exactly why — and meet the one task the automation deliberately leaves to a person. We’ll go step by step. This board — the website relaunch — is where the whole episode happens.',
        de: 'Willkommen zu Episode sechs. Heute bekommt dein Team einen neuen Kollegen: einen Agenten, der auf dem Projekt-Board mitarbeitet. Du legst eine Aufgabe an und siehst zu, wie ein Agent sie übernimmt, liest genau nach, warum — und triffst die eine Aufgabe, die die Automatisierung bewusst einem Menschen überlässt. Wir gehen Schritt für Schritt vor. Dieses Board — der Website-Relaunch — ist der Schauplatz der ganzen Episode.',
        fr: 'Bienvenue dans l’épisode six. Aujourd’hui, ton équipe gagne un nouveau collègue : un agent qui travaille sur le tableau du projet. Tu vas créer une tâche et regarder un agent la prendre, lire pourquoi, noir sur blanc — et rencontrer la tâche que l’automatisation laisse volontairement à une personne. On avance étape par étape. Ce tableau — la refonte du site — c’est le décor de tout l’épisode.',
      },
    },
    {
      // Context: the board's geography — columns, shared by people and
      // agents, the avatar as the ownership signal the episode hinges on.
      id: 'meet-board',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 24_000,
      narration: {
        en: 'Here’s the relaunch board, mid-flight. Each column is a stage: To do, In progress, In review, Done. People and agents share this board — when a card has an owner, their avatar sits right on it. Keep that in mind; it’s how you’ll tell who holds what. Now let’s put a new card on it.',
        de: 'Das ist das Relaunch-Board, mitten in der Arbeit. Jede Spalte ist eine Station: Zu erledigen, In Bearbeitung, In Prüfung, Erledigt. Menschen und Agenten teilen sich dieses Board — sobald eine Karte jemandem gehört, sitzt der Avatar direkt darauf. Merk dir das; so erkennst du, wer was hält. Und jetzt legen wir eine neue Karte darauf.',
        fr: 'Voici le tableau de la refonte, en plein travail. Chaque colonne est une étape : À faire, En cours, En revue, Terminé. Humains et agents partagent ce tableau — dès qu’une carte a un responsable, son avatar s’affiche dessus. Garde ça en tête ; c’est comme ça qu’on voit qui tient quoi. Maintenant, ajoutons une carte.',
      },
    },
    {
      // Task 1 opens: create the task, plainly — then hands off.
      id: 'task-create',
      chapterByLocale: {
        en: 'A task for the AI',
        de: 'Eine Aufgabe für die KI',
        fr: 'Une tâche pour l’IA',
      },
      leadInMs: 1800,
      tailMs: 1500,
      minMs: 23_000,
      narration: {
        en: 'We click Create task… type a title — ‘Draft the launch announcement post’… and that’s it. Create. No assignee, on purpose. This workspace runs a triage automation that reads every new task and decides who should take it. So now: hands off the mouse.',
        de: 'Wir klicken auf Aufgabe erstellen … tippen einen Titel — „Launch-Ankündigung entwerfen“ … und das war’s. Erstellen. Ohne Zuweisung, mit Absicht. In diesem Arbeitsbereich läuft eine Triage-Automatisierung, die jede neue Aufgabe liest und entscheidet, wer sie übernehmen sollte. Also: Hände weg von der Maus.',
        fr: 'On clique sur Créer une tâche… on tape un titre — « Rédiger l’annonce de lancement »… et c’est tout. Créer. Personne d’assigné, exprès. Cet espace fait tourner une automatisation de triage qui lit chaque nouvelle tâche et décide qui devrait la prendre. Alors maintenant : les mains loin de la souris.',
      },
    },
    {
      // The observation: the avatar lands by itself; the card changes hands
      // and columns. minMs floors the triage-run wait — bump at rehearsal
      // if assignment regularly lands after the narration.
      id: 'assigned',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 28_000,
      narration: {
        en: 'We wait — and touch nothing. Watch the card. A few seconds… and there: an avatar landed, on its own. The automation read the task, decided an agent fits, and assigned it. The card even moved to In progress — the agent starts right away. And notice what didn’t happen: no ping, no hand-off meeting, nobody routing tasks by hand.',
        de: 'Wir warten — und fassen nichts an. Beobachte die Karte. Ein paar Sekunden … und da: Ein Avatar ist gelandet, ganz von selbst. Die Automatisierung hat die Aufgabe gelesen, einen Agenten für passend befunden und zugewiesen. Die Karte ist sogar nach In Bearbeitung gerückt — der Agent legt sofort los. Und merk dir, was alles nicht passiert ist: kein Ping, keine Übergaberunde, niemand, der Aufgaben von Hand verteilt.',
        fr: 'On attend — et on ne touche à rien. Regarde la carte. Quelques secondes… et voilà : un avatar vient d’atterrir, tout seul. L’automatisation a lu la tâche, jugé qu’un agent convenait, et assigné. La carte a même glissé vers En cours — l’agent se met au travail tout de suite. Et remarque tout ce qui n’a pas eu lieu : pas de ping, pas de réunion de passation, personne qui distribue les tâches à la main.',
      },
    },
    {
      // The meaning: the automated reasoning comment, quoted out loud —
      // per-locale mock data (DOCS_TRIAGE_SCORES reason, 0.82 entry).
      id: 'reasoning',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 25_000,
      narration: {
        en: 'You don’t have to take that on trust. Let’s open the card. Right here, a comment written by the automation: auto-assigned to assistant — announcement copy is drafting work, and the brand guidelines plus content inventory are indexed. That’s the reason, in plain words, right where the work sits. And if the pick were wrong, you’d reassign it like any task — the automation never locks you out.',
        de: 'Das musst du nicht blind glauben. Öffnen wir die Karte. Direkt hier: ein Kommentar der Automatisierung — automatisch zugewiesen an den Assistenten, denn Ankündigungstexte sind Schreibarbeit; Markenrichtlinien und Content-Inventar sind indexiert. Die Begründung steht in klaren Worten genau dort, wo die Arbeit liegt. Und wäre die Wahl falsch, würdest du neu zuweisen wie bei jeder Aufgabe — die Automatisierung sperrt dich nie aus.',
        fr: 'Pas besoin de le croire sur parole. Ouvrons la carte. Juste là, un commentaire écrit par l’automatisation : assignée à l’assistant, parce que le texte d’annonce est un travail de rédaction ; la charte et l’inventaire de contenu sont indexés. La raison, en langage clair, posée là où vit le travail. Et si le choix était mauvais, tu réassignerais comme pour n’importe quelle tâche — l’automatisation ne te retire jamais la main.',
      },
    },
    {
      // Task 2: trace WHY on camera — rail → Automations → triage →
      // Executions. The episode's ONE series callback lives here.
      id: 'trace-why',
      chapterByLocale: {
        en: 'Why this agent',
        de: 'Warum dieser Agent',
        fr: 'Pourquoi cet agent',
      },
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 21_000,
      narration: {
        en: 'Want the full story? It’s one page away — the same path you learned last episode. We open Automations in the sidebar… then the task triage… and its Executions tab. Every run this automation ever made is listed here, newest first.',
        de: 'Willst du die ganze Geschichte? Sie ist eine Seite entfernt — auf dem Weg aus der letzten Episode. Wir öffnen Automatisierungen in der Seitenleiste … dann die Aufgaben-Triage … und ihren Tab Ausführungen. Hier steht jeder Lauf, den diese Automatisierung je gemacht hat — der neueste zuoberst.',
        fr: 'Tu veux l’histoire complète ? Elle est à une page d’ici — par le chemin appris à l’épisode précédent. On ouvre Automatisations dans la barre latérale… puis le triage des tâches… et son onglet Exécutions. Chaque exécution de cette automatisation est listée ici, la plus récente en premier.',
      },
    },
    {
      // The newest run opened: the confidence and the reason, on the record.
      id: 'run-detail',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 23_000,
      narration: {
        en: 'The top run is ours, seconds old. We open it… and here’s the score step: confidence zero point eight two, and the same reason we just read on the card. If anyone asks why the agent got this task, the answer sits one click away.',
        de: 'Der oberste Lauf ist unserer, wenige Sekunden alt. Wir öffnen ihn … und da ist der Bewertungsschritt: Konfidenz null Komma acht zwei, und dieselbe Begründung wie eben auf der Karte. Fragt jemand, warum der Agent diese Aufgabe bekam — die Antwort liegt einen Klick entfernt.',
        fr: 'L’exécution du haut, c’est la nôtre — vieille de quelques secondes. On l’ouvre… et voici l’étape de score : confiance zéro virgule quatre-vingt-deux, et la même raison que sur la carte. Si on te demande pourquoi l’agent a reçu cette tâche, la réponse est à un clic.',
      },
    },
    {
      // Task 3 = the pitfall beat: the deliberate NON-assignment, found on
      // the board — the below-the-bar task never got an avatar.
      id: 'left-alone',
      chapterByLocale: {
        en: 'When the AI holds back',
        de: 'Wenn die KI sich zurückhält',
        fr: 'Quand l’IA s’abstient',
      },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 22_000,
      narration: {
        en: 'Back to the board — one card deserves a second look. ‘Sign off the launch checklist’ has been sitting in To do this whole time. The automation scored this one too. No avatar landed. That’s no accident — let’s see what it did instead.',
        de: 'Zurück zum Board — eine Karte verdient einen zweiten Blick. „Go-live-Freigabe erteilen“ liegt die ganze Zeit in Zu erledigen. Auch diese Aufgabe hat die Automatisierung bewertet. Kein Avatar gelandet. Das ist kein Versehen — schauen wir, was sie stattdessen getan hat.',
        fr: 'Retour au tableau — une carte mérite un second regard. « Donner le feu vert à la mise en ligne » attend dans À faire depuis le début. L’automatisation a noté cette tâche aussi. Aucun avatar. Ce n’est pas un oubli — regardons ce qu’elle a fait à la place.',
      },
    },
    {
      // What it did instead: a suggestion comment, not an assignment — the
      // confidence sat below the 0.7 bar, so the decision stays human.
      id: 'suggestion',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 28_000,
      narration: {
        en: 'We open it… and there’s the automation again, but only as a comment: an assignment suggestion, confidence zero point five five. Read its reason: the assistant can assemble the evidence, but the sign-off itself needs the release owner. Below the bar, the automation suggests and steps back. Sign-offs stay with people — unless a person assigns it, right here.',
        de: 'Wir öffnen sie … und da ist die Automatisierung wieder, aber nur als Kommentar: ein Zuweisungsvorschlag, Konfidenz null Komma fünf fünf. Lies die Begründung: Die Nachweise kann der Assistent zusammenstellen, die Freigabe selbst liegt beim Release-Verantwortlichen. Unter der Schwelle schlägt die Automatisierung nur vor und tritt zurück. Freigaben bleiben bei Menschen — bis ein Mensch hier zuweist.',
        fr: 'On l’ouvre… et l’automatisation est encore là, mais en simple commentaire : une suggestion d’assignation, confiance zéro virgule cinquante-cinq. Lis sa raison : l’assistant peut rassembler les preuves, mais le feu vert revient au responsable du lancement. Sous la barre, elle suggère et s’écarte. Un feu vert reste humain — jusqu’à ce qu’une personne assigne, ici même.',
      },
    },
    {
      // Task 4: the human surfaces — project files as the bounded context
      // the assignment reason itself cited.
      id: 'files',
      chapterByLocale: {
        en: 'Around the work',
        de: 'Rund um die Arbeit',
        fr: 'Autour du travail',
      },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1600,
      minMs: 21_000,
      narration: {
        en: 'One more surface feeds the agents in this project — its Files: the launch-day runbook… and the content inventory — 380 legacy URLs, already audited. Remember the assignment reason? ‘The content inventory is indexed’ — that’s this file. Agents working in this project read these first, so their drafts stand on this project’s facts.',
        de: 'Eine weitere Fläche füttert die Agenten in diesem Projekt — die Dateien: das Launch-Runbook … und das Content-Inventar — 380 alte URLs, schon geprüft. Erinnerst du dich an die Begründung? „Content-Inventar ist indexiert“ — das hier ist diese Datei. Agenten in diesem Projekt lesen zuerst hier, damit ihre Entwürfe auf den Fakten dieses Projekts stehen.',
        fr: 'Une autre surface nourrit les agents de ce projet — ses Fichiers : le runbook du jour J… et l’inventaire de contenu — 380 anciennes URL, déjà auditées. Tu te souviens de la raison de l’assignation ? « L’inventaire de contenu est indexé » — c’est ce fichier. Les agents du projet lisent ici d’abord ; leurs brouillons s’appuient sur les faits du projet.',
      },
    },
    {
      // Verify: both outcomes read off the board, side by side.
      id: 'verify',
      chapterByLocale: {
        en: 'Two outcomes',
        de: 'Zwei Ergebnisse',
        fr: 'Deux résultats',
      },
      chapterTransition: 'cut',
      leadInMs: 2400,
      tailMs: 1800,
      minMs: 23_000,
      narration: {
        en: 'One last look at the board, and it tells the whole story. Our announcement task: In progress, agent avatar on the card. The sign-off task: still in To do, no avatar, one suggestion waiting. The automation took the routine work and left the judgment call to you — and both moves are written on the cards.',
        de: 'Ein letzter Blick aufs Board, und es erzählt die ganze Geschichte. Unsere Ankündigungs-Aufgabe: In Bearbeitung, Agenten-Avatar auf der Karte. Die Freigabe-Aufgabe: weiter in Zu erledigen, kein Avatar, ein Vorschlag wartet. Die Routine hat die Automatisierung übernommen, die Ermessensfrage dir gelassen — und beide Schritte stehen auf den Karten.',
        fr: 'Un dernier regard au tableau, et toute l’histoire s’y lit. Notre tâche d’annonce : En cours, avatar d’agent sur la carte. La tâche du feu vert : toujours dans À faire, pas d’avatar, une suggestion en attente. L’automatisation a pris la routine et t’a laissé la décision — et les deux gestes sont écrits sur les cartes.',
      },
    },
    {
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 18_000,
      narration: {
        en: 'And that’s projects. You created a task, watched an agent take it, read the reason on the card, checked the run behind it — and found the task the automation left to a person. Files keep the context next to the work. The projects section of the docs goes deeper on each.',
        de: 'Das waren Projekte. Du hast eine Aufgabe erstellt, einem Agenten bei der Übernahme zugesehen, die Begründung auf der Karte gelesen, den Lauf dahinter geprüft — und die Aufgabe gefunden, die die Automatisierung einem Menschen überlässt. Dateien und Diskussionen halten den Kontext neben der Arbeit. Der Projekte-Bereich der Doku vertieft jedes Thema.',
        fr: 'Voilà les projets. Tu as créé une tâche, regardé un agent la prendre, lu la raison sur la carte, vérifié l’exécution derrière — et trouvé la tâche que l’automatisation laisse à une personne. Les fichiers gardent le contexte à côté du travail. La section Projets de la doc approfondit chaque sujet.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: integrations — where your workspace connects to the tools your team already uses. See you in episode seven.',
        de: 'Nächstes Mal: Integrationen — wo dein Arbeitsbereich die Werkzeuge erreicht, die dein Team schon nutzt. Bis zur siebten Episode.',
        fr: 'La prochaine fois : les intégrations — là où ton espace de travail rejoint les outils que ton équipe utilise déjà. À bientôt pour l’épisode sept.',
      },
    },
  ],
} as const;
