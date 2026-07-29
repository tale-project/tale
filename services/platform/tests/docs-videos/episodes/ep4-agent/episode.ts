/**
 * Episode 4 — "Your first agent", the in-depth build guide. The viewer
 * builds a scoped agent ON CAMERA — create (slug + display name), type the
 * three-clause mandate, walk the four decisions (instructions, knowledge,
 * tools, model — each naming the rejected alternative), publish via the
 * visible-in-chat toggle — and then PROVES the boundary holds: an in-role
 * answer to a support ask, followed by a billing dispute the agent declines
 * exactly as its typed instructions demand (the pitfall beat). Verify: the
 * agent sits in the chat picker for the whole team.
 *
 * Register (produce-video STORYBOARD.md): a colleague showing you at your
 * desk — TUTORIAL GRAMMAR (signpost → action → observation → meaning) and
 * silence-led pacing: generous lead-ins after each chapter card, a tail
 * beat after every landed point, minMs floors carrying the typing work.
 *
 * The typed instructions and both scripted replies pair deliberately: the
 * mandate says "hand any billing dispute to a human", the first reply obeys
 * it in role, and the decline cites it — instructions shaping behaviour,
 * verifiably, on screen.
 */

import type { EpisodeSpec, Locale } from '../../lib/episode';

/** The created agent's display name — typed on camera, per locale. */
export const AGENT_DISPLAY_NAME: Record<Locale, string> = {
  en: 'Support Coach',
  de: 'Support-Coach',
  fr: 'Coach Support',
};

/** The slug typed into the create dialog (ASCII, same everywhere). */
export const AGENT_SLUG = 'support-coach';

/**
 * The mandate typed into System instructions, native per locale. The
 * hand-off clause is load-bearing: the boundary-test decline quotes it, so
 * the on-screen text MUST keep naming billing disputes → a human.
 */
export const AGENT_INSTRUCTIONS: Record<Locale, string> = {
  en: 'You help our support team draft replies. Be friendly and concrete, keep answers under six sentences, and hand any billing dispute to a human.',
  de: 'Du hilfst unserem Support-Team beim Formulieren von Antworten. Sei freundlich und konkret, bleib unter sechs Sätzen und übergib Rechnungsstreitigkeiten an einen Menschen.',
  fr: 'Tu aides notre équipe support à rédiger ses réponses. Sois chaleureux et concret, reste sous six phrases, et confie tout litige de facturation à un humain.',
};

/**
 * The boundary test, typed as the second turn of the test thread — a real
 * billing DISPUTE, so the agent must decline and hand off per its typed
 * instructions. Pairs with the "invoice 4817" DOCS_REPLIES triplet (the
 * invoice number is the distinctive match clause; non-hero prompts are not
 * gate-checked, so keep prompt and entry in sync by hand).
 */
export const BOUNDARY_PROMPT: Record<Locale, string> = {
  en: 'A customer says invoice 4817 is wrong and refuses to pay — can you draft a reply that calms them down?',
  de: 'Ein Kunde sagt, Rechnung 4817 sei falsch, und will nicht zahlen — entwirfst du mir eine Antwort?',
  fr: 'Un client dit que la facture 4817 est fausse et refuse de payer — tu peux me rédiger une réponse ?',
};

export const EP4_AGENT: EpisodeSpec = {
  id: 'ep4-agent',
  section: 'tutorials',
  titleByLocale: {
    en: 'Your first agent',
    de: 'Dein erster Agent',
    fr: 'Ton premier agent',
  },
  episodeLabelByLocale: {
    en: 'Episode 4',
    de: 'Episode 4',
    fr: 'Épisode 4',
  },
  needsKnowledgeDb: true,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  /** The in-role test ask — pairs with its existing docs-reply. */
  heroPromptByLocale: {
    en: 'How should I reply to a customer asking for an invoice copy?',
    de: 'Wie antworte ich einem Kunden, der eine Rechnungskopie möchte?',
    fr: 'Comment répondre à un client qui demande une copie de facture ?',
  },
  scenes: [
    {
      // Cold open over the END STATE surface: the agents list the new row
      // will land in. The card lifts BEFORE the voice names the list.
      id: 'title',
      leadInMs: 1600,
      tailMs: 1500,
      minMs: 27_000,
      narration: {
        en: 'Welcome to episode four. Today we build an agent from scratch: you’ll create it, write its instructions, decide what it may read and do, and then test it live — including the moment it has to say no. We’ll go step by step. This list — the agents of this workspace — is where we’ll end up: one more row, built by you.',
        de: 'Willkommen zu Episode vier. Heute bauen wir einen Agenten von Grund auf: Du erstellst ihn, schreibst seine Anweisungen, entscheidest, was er lesen und tun darf — und dann testen wir ihn live, bis zu dem Moment, in dem er Nein sagen muss. Wir gehen Schritt für Schritt vor. Diese Liste — die Agenten dieses Arbeitsbereichs — ist unser Ziel: eine Zeile mehr, gebaut von dir.',
        fr: 'Bienvenue dans l’épisode quatre. Aujourd’hui, on construit un agent de zéro : tu vas le créer, écrire ses instructions, décider de ce qu’il peut lire et faire — puis le tester en direct, jusqu’au moment où il doit dire non. On avance étape par étape. Cette liste — les agents de cet espace de travail — c’est notre destination : une ligne de plus, construite par toi.',
      },
    },
    {
      // Context: the builtins are generalists; the job needs a specialist.
      id: 'job',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 20_000,
      narration: {
        en: 'This is the agents list — the Assistant and its colleagues came built in. They’re generalists: ask anything, they’ll try. Our support team needs something narrower — a coach that drafts replies, stays on support, and knows when to hand off. That’s today’s build: the Support Coach.',
        de: 'Das ist die Agentenliste — der Assistent und seine Kollegen sind schon eingebaut. Sie sind Generalisten: Frag irgendwas, sie versuchen es. Unser Support-Team braucht etwas Schärferes — einen Coach, der Antworten entwirft, beim Support bleibt und weiß, wann er abgibt. Genau den bauen wir heute: den Support-Coach.',
        fr: 'Voici la liste des agents — l’Assistant et ses collègues sont déjà intégrés. Ce sont des généralistes : demande n’importe quoi, ils essaient. Notre équipe support a besoin de plus précis — un coach qui rédige des réponses, reste sur le support, et sait quand passer la main. C’est ce qu’on construit aujourd’hui : le Coach Support.',
      },
    },
    {
      // Task 1 — the creation ceremony: Create agent → Blank.
      id: 'create',
      chapterByLocale: { en: 'Create it', de: 'Erstellen', fr: 'Créer' },
      leadInMs: 1800,
      tailMs: 1500,
      minMs: 20_000,
      narration: {
        en: 'Let’s create it. Up here: Create agent… and we start from Blank. There are templates too — useful later; blank shows you every decision, and that’s the point today. A dialog asks for two names — and the difference between them matters.',
        de: 'Erstellen wir ihn. Hier oben: Agent erstellen … und wir starten mit Leer. Es gibt auch Vorlagen — später nützlich; Leer zeigt dir jede Entscheidung, und genau darum geht es heute. Ein Dialog fragt nach zwei Namen — und der Unterschied zählt.',
        fr: 'Créons-le. En haut : Créer un agent… et on part de Vierge. Il y a aussi des modèles prêts — utiles plus tard ; Vierge te montre chaque décision, et c’est le but aujourd’hui. Un dialogue demande deux noms — et la différence compte.',
      },
    },
    {
      // The slug-vs-display-name choice, then Continue into the editor.
      id: 'identity',
      leadInMs: 1000,
      tailMs: 1600,
      minMs: 22_000,
      narration: {
        en: 'First, the technical name: support-coach, lowercase, no spaces. It ends up in links and automations, so pick it like a filename. Then the display name: Support Coach — what your team reads in chat, and you can change that one any time. We continue… and land in the agent’s editor.',
        de: 'Zuerst der technische Name: support-coach, klein, ohne Leerzeichen. Er landet in Links und Automatisierungen — wähl ihn also wie einen Dateinamen. Dann der Anzeigename: Support-Coach — den liest dein Team im Chat, und den kannst du jederzeit ändern. Weiter … und wir stehen im Editor des Agenten.',
        fr: 'D’abord le nom technique : support-coach, en minuscules, sans espaces. Il finit dans des liens et des automatisations — choisis-le comme un nom de fichier. Puis le nom d’affichage : Coach Support — celui que ton équipe lit dans le chat, et tu peux le changer quand tu veux. On continue… et nous voilà dans l’éditeur de l’agent.',
      },
    },
    {
      // Task 2 opens: the four-decision editor; decision one typed in.
      id: 'instructions',
      chapterByLocale: {
        en: 'Four decisions',
        de: 'Vier Entscheidungen',
        fr: 'Quatre décisions',
      },
      leadInMs: 2200,
      tailMs: 1500,
      minMs: 21_000,
      narration: {
        en: 'The editor is four decisions in a row — you can see them in the navigation: instructions, knowledge, tools, models. Decision one: the instructions. We open Instructions and models… and type the mandate in.',
        de: 'Der Editor ist eine Reihe von vier Entscheidungen — du siehst sie in der Navigation: Anweisungen, Wissen, Tools, Modelle. Entscheidung eins: die Anweisungen. Wir öffnen Anweisungen und Modelle … und tippen den Auftrag hinein.',
        fr: 'L’éditeur, c’est quatre décisions à la suite — tu les vois dans la navigation : instructions, base de connaissances, outils, modèles. Décision un : les instructions. On ouvre Instructions et modèles… et on tape le mandat.',
      },
    },
    {
      // The mandate read back: scope, tone with a number, the hand-off rule.
      id: 'instructions-why',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 27_000,
      narration: {
        en: 'Now let’s read it back — three clauses, three decisions. The job: help the support team draft replies. The tone, with a number: friendly, concrete, under six sentences. And the hand-off rule: any billing dispute goes to a human. You could write a page more; three clauses you can test beat a page nobody maintains. We save… and remember that last line. We’ll test it in a few minutes.',
        de: 'Jetzt lies ihn noch einmal — drei Klauseln, drei Entscheidungen. Der Job: dem Support-Team beim Antworten helfen. Der Ton, mit einer Zahl: freundlich, konkret, unter sechs Sätzen. Und die Übergaberegel: Jeder Rechnungsstreit geht an einen Menschen. Du könntest eine Seite mehr schreiben — drei prüfbare Klauseln schlagen eine Seite, die niemand pflegt. Wir speichern … und merk dir die letzte Zeile. Die testen wir gleich.',
        fr: 'Maintenant, relis-le — trois clauses, trois décisions. Le poste : aider l’équipe support à rédiger. Le ton, avec un chiffre : chaleureux, concret, moins de six phrases. Et la règle de passage de main : tout litige de facturation part chez un humain. Tu pourrais écrire une page de plus — trois clauses testables valent mieux qu’une page que personne n’entretient. On enregistre… et retiens la dernière ligne. On la teste dans quelques minutes.',
      },
    },
    {
      // Decision two: knowledge scope (the one series callback).
      id: 'knowledge',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 19_000,
      narration: {
        en: 'Decision two: what it may read. This is the workspace knowledge you filled in episode three, scoped per agent here. The coach gets the support documents, nothing more. Opening everything would also work — for a researcher, not for a coach with one job.',
        de: 'Entscheidung zwei: was er lesen darf. Das ist das Wissen, das du in Episode drei aufgebaut hast — hier pro Agent zugeschnitten. Der Coach bekommt die Support-Dokumente, mehr nicht. Alles zu öffnen ginge auch — für einen Rechercheur, nicht für einen Coach mit einem Job.',
        fr: 'Décision deux : ce qu’il peut lire. C’est la base de connaissances remplie à l’épisode trois, délimitée ici par agent. Le coach reçoit les documents support, rien de plus. Tout ouvrir marcherait aussi — pour un chercheur, pas pour un coach qui n’a qu’un travail.',
      },
    },
    {
      // Decision three: tools stay at zero — capability is exposure.
      id: 'tools',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 20_000,
      narration: {
        en: 'Decision three: tools — the page to respect. Every switch widens what the agent can do: search the web, write files, call your connectors. Today we turn on none — a drafting coach needs words, not reach. Web search would be next; add it the day the job demands it.',
        de: 'Entscheidung drei: die Tools — die Seite, die Respekt verdient. Jeder Schalter erweitert, was der Agent tun kann: im Web suchen, Dateien schreiben, deine Connectoren aufrufen. Heute schalten wir keinen ein — ein Formulierungs-Coach braucht Worte, keine Reichweite. Websuche wäre die nächste; ergänz sie an dem Tag, an dem der Job sie verlangt.',
        fr: 'Décision trois : les outils — la page à respecter. Chaque interrupteur élargit ce que l’agent peut faire : chercher sur le web, écrire des fichiers, appeler tes intégrations. Aujourd’hui, on n’en active aucun — un coach de rédaction a besoin de mots, pas de portée. La recherche web viendrait ensuite ; ajoute-la le jour où le travail l’exige.',
      },
    },
    {
      // Decision four: the model stays on the workspace default.
      id: 'model',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 17_000,
      narration: {
        en: 'Decision four: the model. You can pin one per agent, plus a fallback — useful when an agent reads long documents all day. Ours writes short replies, so the workspace default is right. We leave it… four decisions, done.',
        de: 'Entscheidung vier: das Modell. Du kannst pro Agent eines festlegen, plus Fallback — nützlich, wenn ein Agent den ganzen Tag lange Dokumente liest. Unserer schreibt kurze Antworten, also passt der Standard des Arbeitsbereichs. Wir lassen ihn stehen … vier Entscheidungen, fertig.',
        fr: 'Décision quatre : le modèle. Tu peux en fixer un par agent, plus un secours — utile quand un agent lit de longs documents toute la journée. Le nôtre écrit des réponses courtes, donc le réglage par défaut convient. On n’y touche pas… quatre décisions, c’est fait.',
      },
    },
    {
      // Task 3 opens: publish via the visible-in-chat toggle.
      id: 'publish',
      chapterByLocale: { en: 'Test it', de: 'Testen', fr: 'À l’essai' },
      leadInMs: 2200,
      tailMs: 1600,
      minMs: 20_000,
      narration: {
        en: 'Time to put it in front of the team. Under General, one toggle decides who sees it: Visible in chat. We turn it on… and save. From this second, the coach shows up in everyone’s chat picker — so let’s go find it.',
        de: 'Zeit, ihn dem Team zu geben. Unter Allgemein entscheidet ein Schalter, wer ihn sieht: Im Chat sichtbar. Wir schalten ihn ein … und speichern. Ab dieser Sekunde steht der Coach in jeder Agentenauswahl im Chat — also suchen wir ihn dort.',
        fr: 'Il est temps de le donner à l’équipe. Dans Général, un interrupteur décide qui le voit : Visible dans le chat. On l’active… et on enregistre. Dès cette seconde, le coach apparaît dans le sélecteur d’agents de tout le monde — allons donc le retrouver.',
      },
    },
    {
      // The in-role test: pick the coach, ask, watch it answer as the coach.
      id: 'test',
      leadInMs: 1200,
      tailMs: 1600,
      minMs: 30_000,
      narration: {
        en: 'Over to chat. We open the agent picker… and there it is: Support Coach, next to the built-in agents. We select it and ask a real support question — a customer wants a copy of an invoice. Send… and watch it answer as the coach, not as a generalist.',
        de: 'Rüber in den Chat. Wir öffnen die Agentenauswahl … und da ist er: Support-Coach, direkt neben den eingebauten Agenten. Wir wählen ihn aus und stellen eine echte Support-Frage — ein Kunde möchte eine Rechnungskopie. Senden … und schau, wie er als Coach antwortet, nicht als Generalist.',
        fr: 'Direction le chat. On ouvre le sélecteur d’agents… et le voilà : Coach Support, juste à côté des agents intégrés. On le choisit et on pose une vraie question support — un client veut une copie de facture. Envoi… et regarde-le répondre en coach, pas en généraliste.',
      },
    },
    {
      // Stillness over the in-role answer — the instructions at work.
      id: 'read-answer',
      leadInMs: 1000,
      tailMs: 1800,
      minMs: 20_000,
      narration: {
        en: 'Take a second with this answer. Friendly, concrete, under six sentences — as instructed. And read the last line: it flags on its own where its job ends. Every sentence here follows a clause we typed five minutes ago.',
        de: 'Nimm dir einen Moment für diese Antwort. Freundlich, konkret, unter sechs Sätzen — wie angewiesen. Und lies die letzte Zeile: Er markiert selbst, wo sein Job endet. Jeder Satz hier folgt einer Klausel, die wir vor fünf Minuten getippt haben.',
        fr: 'Prends un instant avec cette réponse. Chaleureuse, concrète, moins de six phrases — comme demandé. Et lis la dernière ligne : il signale lui-même où son travail s’arrête. Chaque phrase suit une clause tapée il y a cinq minutes.',
      },
    },
    {
      // Task 4, the pitfall beat: cross the line on purpose — the decline.
      id: 'boundary',
      chapterByLocale: {
        en: 'When it says no',
        de: 'Wenn er Nein sagt',
        fr: 'Quand il dit non',
      },
      leadInMs: 2000,
      tailMs: 1800,
      minMs: 34_000,
      narration: {
        en: 'Now the test that matters. Same thread — and this time we cross the line on purpose: a customer disputes invoice 4817 and refuses to pay. Send… and watch closely. The coach declines. It names its rule — billing disputes go to a human — and hands the thread off instead of drafting. The line we typed into the instructions just held, on camera.',
        de: 'Jetzt der Test, auf den es ankommt. Gleicher Thread — und diesmal überschreiten wir die Linie mit Absicht: Ein Kunde bestreitet Rechnung 4817 und will nicht zahlen. Senden … und schau genau hin. Der Coach lehnt ab. Er nennt seine Regel — Rechnungsstreit geht an einen Menschen — und übergibt, statt zu formulieren. Die Zeile aus den Anweisungen hat gehalten, vor der Kamera.',
        fr: 'Maintenant, le test qui compte. Même fil — et cette fois, on franchit la ligne exprès : un client conteste la facture 4817 et refuse de payer. Envoi… et regarde bien. Le coach décline. Il nomme sa règle — un litige de facturation part chez un humain — et passe la main au lieu de rédiger. La ligne écrite dans les instructions vient de tenir, en direct.',
      },
    },
    {
      // Verify on a fresh chat: the picker lists the coach for everyone.
      id: 'verify',
      chapterByLocale: {
        en: 'On the team',
        de: 'Im Team',
        fr: 'Dans l’équipe',
      },
      leadInMs: 2400,
      tailMs: 1800,
      minMs: 21_000,
      narration: {
        en: 'One more proof before we close. We start a fresh chat and open the picker again — no setup this time. There’s the Support Coach, listed for everyone in this workspace. That’s the Visible in chat toggle at work — turn it off, and the coach leaves the picker without you deleting anything.',
        de: 'Ein letzter Beweis, bevor wir schließen. Wir starten einen frischen Chat und öffnen die Auswahl noch einmal — ganz ohne Vorbereitung. Da steht der Support-Coach, sichtbar für alle im Arbeitsbereich. Das ist der Schalter Im Chat sichtbar bei der Arbeit — schalt ihn aus, und der Coach verschwindet aus der Auswahl, ohne dass du etwas löschst.',
        fr: 'Une dernière preuve avant de conclure. On démarre un chat tout neuf et on rouvre le sélecteur — aucun réglage cette fois. Le Coach Support est là, visible pour tout l’espace de travail. C’est l’interrupteur Visible dans le chat qui fait ça — désactive-le, et le coach quitte le sélecteur sans que tu supprimes quoi que ce soit.',
      },
    },
    {
      id: 'recap',
      leadInMs: 1000,
      tailMs: 1500,
      minMs: 18_000,
      narration: {
        en: 'And that’s your first agent. You created it, wrote a three-clause mandate, scoped its knowledge, left its tools at zero, kept the default model — and tested both sides of its line. The agents section of the docs walks every view we touched today.',
        de: 'Und das war dein erster Agent. Du hast ihn erstellt, einen Auftrag mit drei Klauseln geschrieben, sein Wissen zugeschnitten, seine Tools auf null gelassen, das Standardmodell behalten — und beide Seiten seiner Linie getestet. Die Doku zu Agenten führt durch jede Ansicht von heute.',
        fr: 'Et voilà ton premier agent. Tu l’as créé, tu as écrit un mandat en trois clauses, délimité ses connaissances, laissé ses outils à zéro, gardé le modèle par défaut — et testé les deux côtés de sa ligne. La doc sur les agents reprend chaque vue d’aujourd’hui.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Next time: automations and approvals — workflows that run on their own, while you keep the final say. See you in episode five.',
        de: 'Nächstes Mal: Automatisierungen und Freigaben — Workflows, die von selbst laufen, während du das letzte Wort behältst. Bis zur fünften Episode.',
        fr: 'La prochaine fois : automatisations et validations — des workflows qui tournent seuls, pendant que tu gardes le dernier mot. À bientôt pour l’épisode cinq.',
      },
    },
  ],
} as const;
