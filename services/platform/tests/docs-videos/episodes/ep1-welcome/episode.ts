/**
 * Episode 1 — "Welcome to Tale". The series opener: a guided tour of the
 * workspace (chat → knowledge → agents → automations → projects → governance)
 * that weaves in the three AI-literacy beats the whole series builds on —
 * grounding vs. hallucination, human-in-the-loop, and provider/data control.
 *
 * Narration doctrine: docs voice (direct register, short sentences, no
 * exclamation marks), written natively per locale — never translated word for
 * word (write-translations). Audio tags are used sparingly; punctuation and
 * ellipses drive pacing. The wow-scene prompt below pairs 1:1 with its
 * scripted reply in `lib/mocks/overrides/docs-replies.ts` — the prompt must
 * contain the reply's `match` clause, or the take streams the visibly
 * synthetic e2e canned reply.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP1_WELCOME: EpisodeSpec = {
  id: 'ep1-welcome',
  section: 'tutorials',
  titleByLocale: {
    en: 'Welcome to Tale',
    de: 'Willkommen bei Tale',
    fr: 'Bienvenue dans Tale',
  },
  episodeLabelByLocale: {
    en: 'Episode 1',
    de: 'Episode 1',
    fr: 'Épisode 1',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  /** Auditioned 2026-07-16 (twice): EN Hope — "Professional, Clear and
   * Natural", American, from the voice LIBRARY like the approved de/fr
   * voices (premade Alice read too British, premade Bella too synthetic);
   * DE Carla Blum, FR Koraly. Alternates in .state/audition/. */
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The live chat question typed on camera. Each locale's prompt CONTAINS
   * its docs-replies match clause (see DOCS_REPLIES, video entries). */
  heroPromptByLocale: {
    en: 'What did customers say about onboarding last quarter?',
    de: 'Was haben unsere Kunden im letzten Quartal zum Onboarding gesagt?',
    fr: 'Que disent nos clients de l’onboarding au dernier trimestre ?',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'This is Tale — the workspace where your team puts AI to work. Over the next three minutes, you will see how it fits together — and what it takes to use AI well.',
        de: 'Das ist Tale — der Arbeitsbereich, in dem dein Team KI wirklich arbeiten lässt. In den nächsten drei Minuten siehst du, wie alles zusammenspielt — und worauf es ankommt, wenn KI gute Arbeit leisten soll.',
        fr: 'Voici Tale — l’espace de travail où ton équipe met vraiment l’IA au travail. Dans les trois prochaines minutes, tu vas voir comment tout s’articule — et ce qu’il faut pour bien utiliser l’IA.',
      },
    },
    {
      id: 'dashboard',
      leadInMs: 900,
      narration: {
        en: 'This is your workspace. Chat with AI models, projects for your team, agents, automations, and the knowledge your company runs on — everything one sidebar click away. Let us start where your team will spend most of its time: the chat.',
        de: 'Das ist dein Arbeitsbereich. Chat mit KI-Modellen, Projekte für dein Team, Agenten, Automatisierungen und das Wissen, mit dem dein Unternehmen arbeitet — alles einen Klick in der Seitenleiste entfernt. Wir starten dort, wo dein Team die meiste Zeit verbringt: im Chat.',
        fr: 'Voici ton espace de travail. Le chat avec les modèles d’IA, les projets de ton équipe, les agents, les automatisations et les connaissances de ton entreprise — tout est à un clic dans la barre latérale. On commence là où ton équipe passera le plus de temps : le chat.',
      },
    },
    {
      id: 'chat-ask',
      chapterByLocale: { en: 'Chat', de: 'Chat', fr: 'Chat' },
      // The typing choreography (mention picker + 60-char prompt + send)
      // needs this window even when a locale's narration runs shorter.
      minMs: 14_500,
      narration: {
        en: 'You can ask a model anything. The real power is asking about your own work. We will attach a company document as context… and ask what customers said about onboarding last quarter.',
        de: 'Du kannst ein Modell alles fragen. Richtig stark wird es, wenn du nach deiner eigenen Arbeit fragst. Wir hängen ein Firmendokument als Kontext an … und fragen, was Kunden im letzten Quartal zum Onboarding gesagt haben.',
        fr: 'Tu peux tout demander à un modèle. La vraie force, c’est de l’interroger sur ton propre travail. On attache un document de l’entreprise comme contexte… et on demande ce que disent nos clients de l’onboarding au dernier trimestre.',
      },
    },
    {
      id: 'chat-stream',
      // The streamed reply + the source hover need this window even under
      // the shortest locale's narration.
      minMs: 10_500,
      narration: {
        en: 'Tale shows the model’s reasoning first, then streams the answer — grounded in your documents, with its sources named. Not a guess you have to take on faith.',
        de: 'Zuerst zeigt dir Tale, wie das Modell denkt — dann streamt es die Antwort: gestützt auf deine Dokumente, mit klar benannten Quellen. Keine Behauptung, der du blind vertrauen musst.',
        fr: 'Tale montre d’abord le raisonnement du modèle, puis déroule la réponse — ancrée dans tes documents, avec ses sources nommées. Pas une affirmation à croire sur parole.',
      },
    },
    {
      id: 'ai-grounding',
      narration: {
        en: 'Because here is the honest truth about language models: without your context, they answer anyway — fluently, confidently, and sometimes wrong. That is a hallucination. Grounding every answer in your own documents turns AI from a smooth talker into a colleague you can verify.',
        de: 'Denn eine ehrliche Wahrheit über Sprachmodelle: Ohne deinen Kontext antworten sie trotzdem — flüssig, selbstbewusst und manchmal falsch. Das nennt man Halluzination. Wer jede Antwort in den eigenen Dokumenten verankert, macht aus einem eloquenten Redner einen Kollegen, den du überprüfen kannst.',
        fr: 'Car voilà la vérité sur les modèles de langage : sans ton contexte, ils répondent quand même — avec aisance, avec assurance, et parfois à tort. C’est ce qu’on appelle une hallucination. Ancrer chaque réponse dans tes propres documents transforme un beau parleur en collègue que tu peux vérifier.',
      },
    },
    {
      id: 'knowledge',
      chapterByLocale: { en: 'Knowledge', de: 'Wissen', fr: 'Connaissances' },
      narration: {
        en: 'That context lives here. Knowledge holds your documents, crawled websites, and structured records — indexed, searchable, and citable by every agent in the workspace.',
        de: 'Dieser Kontext lebt hier. Wissen sammelt deine Dokumente, gecrawlte Websites und strukturierte Daten — indexiert, durchsuchbar und zitierfähig für jeden Agenten im Arbeitsbereich.',
        fr: 'Ce contexte vit ici. Connaissances rassemble tes documents, les sites web explorés et les données structurées — indexés, consultables et citables par chaque agent de l’espace de travail.',
      },
    },
    {
      id: 'agents',
      chapterByLocale: { en: 'Agents', de: 'Agenten', fr: 'Agents' },
      narration: {
        en: 'An agent is AI with a job description: instructions, a model, tools, and the knowledge it may use. Build it once, and your whole team can put it to work.',
        de: 'Ein Agent ist KI mit Stellenbeschreibung: Anweisungen, ein Modell, Werkzeuge und das Wissen, das er nutzen darf. Einmal gebaut, arbeitet er für dein ganzes Team.',
        fr: 'Un agent, c’est une IA avec une fiche de poste : des instructions, un modèle, des outils et les connaissances qu’il a le droit d’utiliser. Tu le construis une fois, et toute ton équipe peut le mettre au travail.',
      },
    },
    {
      id: 'automations',
      chapterByLocale: {
        en: 'Automations',
        de: 'Automatisierungen',
        fr: 'Automatisations',
      },
      narration: {
        en: 'Automations handle the work nobody should do by hand: triage, drafting, routing. They run on triggers and schedules, and every run leaves a full execution log.',
        de: 'Automatisierungen übernehmen die Arbeit, die niemand von Hand machen sollte: Triage, Entwürfe, Weiterleitung. Sie laufen über Trigger und Zeitpläne — und jeder Lauf hinterlässt ein vollständiges Protokoll.',
        fr: 'Les automatisations prennent le travail que personne ne devrait faire à la main : trier, rédiger, router. Elles tournent sur des déclencheurs et des plannings — et chaque exécution laisse un journal complet.',
      },
    },
    {
      id: 'approvals',
      leadInMs: 1200,
      narration: {
        en: 'And when an automation wants to act on the world — send the email, change the record — it can be required to ask a person first. AI drafts, people decide. That one principle prevents most of what can go wrong with automation.',
        de: 'Und wenn eine Automatisierung nach außen wirken will — die E-Mail senden, den Datensatz ändern — kann sie verpflichtet werden, zuerst einen Menschen zu fragen. KI entwirft, Menschen entscheiden. Dieses eine Prinzip verhindert das meiste, was bei Automatisierung schiefgehen kann.',
        fr: 'Et quand une automatisation veut agir sur le monde réel — envoyer l’e-mail, modifier la fiche — elle peut devoir demander d’abord à une personne. L’IA rédige, les humains décident. Ce seul principe évite l’essentiel de ce qui peut mal tourner avec l’automatisation.',
      },
    },
    {
      id: 'projects',
      chapterByLocale: { en: 'Projects', de: 'Projekte', fr: 'Projets' },
      // Deep board URL — no clickable path, so the jump hard-cuts under the veil.
      chapterTransition: 'cut',
      leadInMs: 1200,
      narration: {
        en: 'Projects bring the team and the AI to the same table: shared files, tasks, and discussions, with agents working alongside your people — not instead of them.',
        de: 'Projekte bringen Team und KI an denselben Tisch: gemeinsame Dateien, Aufgaben und Diskussionen — mit Agenten, die neben deinen Leuten arbeiten, nicht statt ihnen.',
        fr: 'Les projets réunissent l’équipe et l’IA autour de la même table : fichiers partagés, tâches et discussions — avec des agents qui travaillent aux côtés de tes collègues, pas à leur place.',
      },
    },
    {
      id: 'governance',
      chapterByLocale: { en: 'Control', de: 'Kontrolle', fr: 'Contrôle' },
      // Deep settings URL — no clickable path, so the jump hard-cuts under the veil.
      chapterTransition: 'cut',
      leadInMs: 1200,
      narration: {
        en: 'And you stay in control of the machinery itself. You choose which AI providers run your workloads, pin your data to a region, and audit every action in the workspace.',
        de: 'Und die Maschinerie selbst bleibt unter deiner Kontrolle. Du wählst, welche KI-Anbieter deine Arbeit ausführen, hältst deine Daten in einer Region deiner Wahl und prüfst jede Aktion im Protokoll.',
        fr: 'Et la machinerie elle-même reste sous ton contrôle. Tu choisis quels fournisseurs d’IA exécutent tes traitements, tu gardes tes données dans la région de ton choix, et chaque action se retrouve dans les journaux.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'That is Tale: answers grounded in your truth, agents with a mandate, automation with human oversight. In the next episode, we go deeper into chat — attachments, model choice, and research.',
        de: 'Das ist Tale: Antworten, die in deiner Wahrheit verankert sind, Agenten mit klarem Auftrag, Automatisierung mit menschlicher Aufsicht. In der nächsten Episode geht es tiefer in den Chat — Anhänge, Modellwahl und Recherche.',
        fr: 'Voilà Tale : des réponses ancrées dans ta vérité, des agents avec un mandat clair, de l’automatisation sous supervision humaine. Dans le prochain épisode, on va plus loin dans le chat — pièces jointes, choix du modèle et recherche.',
      },
    },
    {
      id: 'outro',
      // Post-narration room: the card holds ~2s, then the compose fade-out
      // (1.5s) completes inside it — the ending must never feel cut off.
      tailMs: 3600,
      narration: {
        en: 'Everything you saw is in the documentation, alongside this series. See you in episode two.',
        de: 'Alles, was du gesehen hast, steht in der Dokumentation — zusammen mit dieser Serie. Bis zur zweiten Episode.',
        fr: 'Tout ce que tu viens de voir est dans la documentation, avec la suite de cette série. À bientôt pour l’épisode deux.',
      },
    },
  ],
} as const;
