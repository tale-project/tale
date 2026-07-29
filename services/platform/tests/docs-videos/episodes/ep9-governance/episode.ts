/**
 * Episode 9 — "Governance, cost & trust". The series finale: the control
 * room in one tour — providers and model policy, guardrails, the audit log
 * (where episode five's approval actually landed), usage and feedback
 * analytics (where episode two's Arena verdicts landed), and data
 * residency. Ends with the series' five habits and hands developers to the
 * bonus episode.
 */

import type { EpisodeSpec } from '../../lib/episode';

export const EP9_GOVERNANCE: EpisodeSpec = {
  id: 'ep9-governance',
  section: 'tutorials',
  titleByLocale: {
    en: 'Governance, cost & trust',
    de: 'Richtlinien, Kosten & Vertrauen',
    fr: 'Gouvernance, coûts & confiance',
  },
  episodeLabelByLocale: {
    en: 'Episode 9',
    de: 'Episode 9',
    fr: 'Épisode 9',
  },
  needsKnowledgeDb: false,
  wholeTakeLocales: ['en'],
  voices: {
    en: 'WZlYpi1yf6zJhNWXih74',
    de: 'rKiu7lQ4c5P3az3745s3',
    fr: 'QbsdzCokdlo98elkq4Pc',
  },
  scenes: [
    {
      id: 'title',
      leadInMs: 1200,
      narration: {
        en: 'The finale is for whoever answers for AI in your organization. One tour of the control room: which models run, what filters protect, what gets logged, what it all costs — and the five habits this series has been building toward.',
        de: 'Das Finale gehört denen, die für KI in eurer Organisation geradestehen. Eine Tour durch den Kontrollraum: welche Modelle laufen, welche Filter schützen, was protokolliert wird, was alles kostet — und die fünf Gewohnheiten, auf die diese Serie hinausläuft.',
        fr: 'Le final s’adresse à ceux qui répondent de l’IA dans votre organisation. Une visite de la salle de contrôle : quels modèles tournent, quels filtres protègent, ce qui est journalisé, ce que tout cela coûte — et les cinq habitudes vers lesquelles cette série avançait.',
      },
    },
    {
      id: 'providers',
      chapterByLocale: { en: 'Providers', de: 'Anbieter', fr: 'Fournisseurs' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'You choose the machinery. One gateway covers the whole catalog, or you bring your own vendor keys — and when data must not leave the house, point Tale at models running on your own hardware. The workspace serves your choice, not the other way around.',
        de: 'Die Maschinerie wählst du. Ein Gateway deckt den ganzen Katalog, oder du bringst eigene Anbieter-Schlüssel mit — und wenn Daten das Haus nicht verlassen dürfen, richte Tale auf Modelle auf eurer eigenen Hardware. Der Arbeitsbereich dient deiner Wahl, nicht umgekehrt.',
        fr: 'La machinerie, c’est toi qui la choisis. Une passerelle couvre tout le catalogue, ou tu apportes tes propres clés — et quand les données ne doivent pas sortir de la maison, pointe Tale vers des modèles sur votre propre matériel. L’espace sert ton choix, pas l’inverse.',
      },
    },
    {
      id: 'model-policy',
      minMs: 12_000,
      narration: {
        en: 'And who may use which model is policy, not folklore: allow-lists per role and team, so the expensive deep-reasoning model serves the people whose work needs it — and nobody discovers a surprise on the invoice.',
        de: 'Und wer welches Modell nutzen darf, ist Richtlinie, nicht Folklore: Erlaubnislisten pro Rolle und Team, damit das teure Deep-Reasoning-Modell denen dient, deren Arbeit es braucht — und niemand eine Überraschung auf der Rechnung findet.',
        fr: 'Et qui peut utiliser quel modèle relève de la politique, pas du folklore : des listes d’autorisation par rôle et par équipe, pour que le modèle coûteux serve ceux dont le travail l’exige — et que personne ne découvre une surprise sur la facture.',
      },
    },
    {
      id: 'guardrails',
      chapterByLocale: {
        en: 'Guardrails',
        de: 'Leitplanken',
        fr: 'Garde-fous',
      },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'Guardrails scan both directions: what goes into a model and what comes back. Personal data can be masked before it ever leaves, unsafe content blocked or flagged — and the matched text itself is never stored. People paste more than they should; the seatbelt assumes it.',
        de: 'Leitplanken prüfen beide Richtungen: was in ein Modell hineingeht und was zurückkommt. Personenbezogene Daten werden maskiert, bevor sie das Haus verlassen, unsichere Inhalte blockiert oder markiert — und der getroffene Text selbst wird nie gespeichert. Menschen fügen mehr ein, als sie sollten; der Gurt rechnet damit.',
        fr: 'Les garde-fous scrutent les deux sens : ce qui entre dans un modèle et ce qui en revient. Les données personnelles peuvent être masquées avant de sortir, les contenus à risque bloqués ou signalés — et le texte détecté n’est jamais stocké. On colle toujours plus qu’on ne devrait ; la ceinture le sait.',
      },
    },
    {
      id: 'audit',
      minMs: 13_000,
      narration: {
        en: 'The audit log is where the series comes full circle. The approval you watched in episode five is in here — who decided, what, and when. Every guardrail hit, every setting change, every consequential action, attributable. Trust is not a feeling; it is a record.',
        de: 'Im Audit-Protokoll schließt sich der Kreis der Serie. Die Freigabe aus Episode fünf steht hier — wer entschieden hat, was und wann. Jeder Leitplanken-Treffer, jede Einstellungsänderung, jede folgenreiche Aktion, zurechenbar. Vertrauen ist kein Gefühl; es ist ein Protokoll.',
        fr: 'Le journal d’audit est là où la série boucle sa boucle. La validation de l’épisode cinq y est — qui a décidé, quoi, et quand. Chaque garde-fou déclenché, chaque réglage modifié, chaque action lourde de conséquences, attribuable. La confiance n’est pas un sentiment ; c’est un registre.',
      },
    },
    {
      id: 'usage',
      chapterByLocale: { en: 'Costs', de: 'Kosten', fr: 'Coûts' },
      chapterTransition: 'cut',
      minMs: 13_000,
      narration: {
        en: 'Usage analytics answer the question every finance team asks in month two: what does this cost, and where? Tokens and spend by team, by model, by agent — with budgets that turn amber before they turn into a problem.',
        de: 'Die Nutzungsanalysen beantworten die Frage, die jedes Finanzteam im zweiten Monat stellt: Was kostet das, und wo? Tokens und Ausgaben pro Team, Modell und Agent — mit Budgets, die erst gelb werden, bevor sie zum Problem werden.',
        fr: 'Les analyses d’usage répondent à la question que toute équipe finance pose au deuxième mois : combien ça coûte, et où ? Tokens et dépenses par équipe, par modèle, par agent — avec des budgets qui passent à l’orange avant de devenir un problème.',
      },
    },
    {
      id: 'feedback',
      minMs: 12_000,
      narration: {
        en: 'And quality gets measured, not assumed. Thumbs from every reply and the Arena verdicts from episode two land here — so when someone asks whether the expensive model earns its keep, you answer with a chart, not a hunch.',
        de: 'Und Qualität wird gemessen, nicht vermutet. Die Daumen aus jeder Antwort und die Arena-Urteile aus Episode zwei landen hier — wenn also jemand fragt, ob sich das teure Modell lohnt, antwortest du mit einem Diagramm, nicht mit einem Bauchgefühl.',
        fr: 'Et la qualité se mesure, elle ne se présume pas. Les pouces de chaque réponse et les verdicts d’Arène de l’épisode deux atterrissent ici — quand on te demande si le modèle coûteux vaut son prix, tu réponds avec un graphique, pas une intuition.',
      },
    },
    {
      id: 'residency',
      minMs: 11_000,
      narration: {
        en: 'One more dial: where the data lives. Pin the workspace to a region and it stays there — Switzerland, the EU, wherever your obligations point. Residency is a setting here, not a negotiation.',
        de: 'Ein letzter Regler: wo die Daten wohnen. Binde den Arbeitsbereich an eine Region, und dort bleiben sie — Schweiz, EU, wohin auch immer eure Pflichten zeigen. Residenz ist hier eine Einstellung, keine Verhandlung.',
        fr: 'Un dernier cadran : où vivent les données. Épingle l’espace à une région et elles y restent — Suisse, UE, où que pointent vos obligations. La résidence est ici un réglage, pas une négociation.',
      },
    },
    {
      id: 'habits',
      narration: {
        en: 'Nine episodes, five habits. Ground it — answers from your sources. Gate it — people decide the risky steps. Scope it — the smallest agent, library, and role that do the job. Log it — every action with a name on it. Measure it — cost and quality on charts. That is what using AI well actually looks like.',
        de: 'Neun Episoden, fünf Gewohnheiten. Verankern — Antworten aus euren Quellen. Absichern — Menschen entscheiden die riskanten Schritte. Begrenzen — der kleinste Agent, die kleinste Bibliothek, die kleinste Rolle, die den Job erledigen. Protokollieren — jede Aktion mit Namen daran. Messen — Kosten und Qualität auf Diagrammen. So sieht guter KI-Einsatz wirklich aus.',
        fr: 'Neuf épisodes, cinq habitudes. Ancrer — des réponses tirées de vos sources. Verrouiller — les humains décident des étapes risquées. Borner — le plus petit agent, la plus petite bibliothèque, le plus petit rôle qui font le travail. Journaliser — chaque action porte un nom. Mesurer — coûts et qualité sur des graphiques. Voilà à quoi ressemble vraiment un bon usage de l’IA.',
      },
    },
    {
      id: 'recap',
      narration: {
        en: 'That closes the main arc of the series. One bonus lap remains — for your developers: APIs, webhooks, and external agents in sandboxes. Everyone else: the documentation carries on from here.',
        de: 'Damit schließt der Hauptbogen der Serie. Eine Bonusrunde bleibt — für eure Entwickler: APIs, Webhooks und Coding-Agenten in Sandboxes. Für alle anderen: Die Dokumentation übernimmt ab hier.',
        fr: 'Ainsi se referme l’arc principal de la série. Reste un tour bonus — pour vos développeurs : API, webhooks et agents de code en bac à sable. Pour tous les autres : la documentation prend le relais.',
      },
    },
    {
      id: 'outro',
      tailMs: 3600,
      narration: {
        en: 'Thank you for watching. Everything you saw — and everything we could not fit — lives in the documentation.',
        de: 'Danke fürs Zuschauen. Alles, was du gesehen hast — und alles, was nicht hineinpasste — steht in der Dokumentation.',
        fr: 'Merci d’avoir regardé. Tout ce que tu as vu — et tout ce qui n’a pas tenu — vit dans la documentation.',
      },
    },
  ],
} as const;
