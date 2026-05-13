---
title: Demandes de personnes concernées
description: Gestion en libre-service des demandes d'effacement RGPD art. 17, avec suivi des délais, prolongation art. 12(3) à octroi unique et reçus chaînés à l'audit.
---

Les admins d'organisation traitent les demandes RGPD art. 17 (droit à l'effacement) directement depuis **Paramètres > Gouvernance > Demandes de personnes concernées**. Chaque dépôt insère un reçu durable avec un délai de 30 jours, exécute la cascade de manière asynchrone et écrit une entrée d'audit pour chaque transition d'état (déposée → bloquée / exécutée / prolongée / réessayée).

La page porte le nom du concept général DSR plutôt que « effacement » seul, afin que de futurs flux art. 16 (rectification) et art. 20 (portabilité) puissent atterrir ici sans renommer la route. Aujourd'hui, seul l'art. 17 est implémenté.

## La vérification d'identité reste hors-produit

Tale est administré par conception — il n'existe pas de portail libre-service côté personne concernée. L'admin déposant **est** le point de vérification d'identité, ayant confirmé l'identité via le processus de l'organisation (offboarding RH, ticket support, vérification en personne, etc.) avant d'ouvrir le dialogue. Le produit n'ajoute pas d'étape IDV en flux.

Ce contrat rend l'admin autoritaire pour la demande. Le conseil juridique peut traiter la phrase de confirmation (« ERASE ») dans le dialogue de dépôt comme la porte IDV : la frapper est un signal délibéré, audité, que l'admin a vérifié la personne.

## Déposer une demande

Clique sur **Déposer une demande** en haut de la page. Le dialogue collecte :

- **Personne** — un membre actif de l'organisation, choisi via une liste recherchable. Le picker est le même que celui de l'interface de rétention légale.
- **Fondement légal** — l'un de sept codes structurés mappés sur RGPD art. 17(1)(a)–(f) plus le motif opérationnel `contract_termination` utilisé lors du offboarding RH. Les outils DSR de production (OneTrust, TrustArc, Ketch) portent tous un code structuré à côté du motif libre car les régulateurs attendent une classification par fondement.
- **Motif détaillé** — texte libre (≥ 10 caractères) décrivant le contexte de vérification. Il atterrit dans le reçu et dans le journal d'audit.
- **Confirmation à taper** — tape `ERASE` pour activer le bouton d'envoi. La phrase est stable selon la locale, l'exigence est identique partout.

Au dépôt, la cascade s'exécute de manière asynchrone dans une action Convex Node : elle supprime les conversations de la personne, les documents indexés dans RAG, les blobs file-metadata et neuf catégories par-table, puis nettoie les PII de la chaîne d'audit pour les lignes signées par la personne.

Si la personne est sous rétention légale active (organisation entière ou rétention de garde), la demande est **rejetée à la barrière** et un panneau en ligne affiche le nombre de conversations / documents préservés ainsi qu'un lien profond vers la page de rétention légale. Le reçu est tout de même écrit avec `status: blocked` afin que la trace d'audit reste prouvable pour le régulateur.

## Badge de délai et prolongation art. 12(3)

Chaque demande porte un délai de 30 jours (`requestedAt + 30 jours`). La liste et la vue détaillée affichent un badge SLA à quatre paliers :

- **Vert** — plus de 7 jours restants.
- **Jaune** — 7 jours ou moins restants.
- **Rouge** — en retard.
- **Gris** — état terminal (`done` / `failed`) ; le compte à rebours n'a plus de sens.

L'art. 12(3) du RGPD autorise le responsable à prolonger la fenêtre de réponse de jusqu'à deux mois supplémentaires pour les demandes complexes, **mais la prolongation elle-même doit être communiquée à la personne dans le mois initial, avec motifs**. L'action **Prolonger le délai** du tiroir détaillé l'implémente :

- Disponible tant que la demande n'est pas terminale et que le délai initial n'est pas dépassé.
- Ajoute 1–60 jours, avec motif obligatoire (≥ 10 caractères).
- Chaque demande peut être prolongée **au plus une fois** — un second essai est rejeté avec `ALREADY_EXTENDED`.
- Le badge SLA utilise `extensionDeadlineAt ?? slaDeadlineAt`, donc une prolongation accordée prend immédiatement effet sur le palier de couleur et le compte à rebours affiché.

Le journal d'audit consigne qui a accordé la prolongation, le motif et le nouveau délai.

## Réessayer les exécutions partielles / bloquées / échouées

Trois états sont retraitables :

- `partial` — la cascade s'est exécutée mais certaines catégories ont été ignorées par une rétention posée en cours de route, ou le plafond de pages a été atteint sur un thread.
- `blocked` — la demande a été refusée à la barrière de rétention légale au moment du dépôt. Lève la rétention bloquante, puis réessaie.
- `failed` — la cascade a planté (service RAG injoignable, erreur infra transitoire) ou a été marquée par le watchdog après dépassement du plafond de 30 minutes.

L'action **Réessayer** du tiroir replanifie le processeur. La barrière de rétention re-tourne au démarrage du processeur, ce qui ferme la fenêtre entre « lever la rétention » et « réessayer ».

## Ce que montre le reçu

Le tiroir détaillé restitue le reçu art. 17 / art. 19 complet pour une demande :

- Badge de statut + compte à rebours du délai.
- Identifiant de la personne, fondement légal, motif détaillé, qui a déposé et quand, délai actuel (avec info de prolongation le cas échéant).
- Compteurs : conversations effacées / ciblées, documents retirés du RAG, documents effacés, documents ignorés par la rétention, message d'erreur en cas d'échec.
- Piste d'audit : chaque ligne `gdpr_erasure_*` portant sur la personne, ordonnée par la chaîne d'audit.

**Aucun contenu PII effacé n'est rendu** — uniquement des compteurs agrégés et des identifiants. Le reçu peut être remis tel quel au régulateur ou à la personne concernée.

## Périmètre aujourd'hui, périmètre plus tard

Cette page livre uniquement RGPD art. 17 (effacement). Hors périmètre v1, par choix :

- Art. 16 rectification et art. 20 portabilité — atterriront plus tard comme valeurs `kind` supplémentaires sur la même page DSR, sans renommer la route.
- Portail libre-service côté personne — Tale est administré par conception.
- Vérification d'identité dans le produit — gérée hors-produit par l'admin.
- Notification email à la personne en fin de traitement — relève du chantier infra-email.
- Demandes massives (sociétés de gestion de réclamations).
- Templates multi-juridictions (CCPA, LGPD, etc.) — RGPD d'abord.
- Rédaction assistée par IA — Tale efface plutôt que rédiger.

## Liens connexes

- [Vue d'ensemble Gouvernance](/platform/admin/governance) — pages sœurs sur rétention, rétention légale et journal d'audit.
- [RGPD art. 12 — Information transparente et modalités](https://gdpr-info.eu/art-12-gdpr/)
- [RGPD art. 17 — Droit à l'effacement](https://gdpr-info.eu/art-17-gdpr/)
