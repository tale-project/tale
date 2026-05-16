---
title: Demandes des personnes concernées
description: Déposer des demandes d'effacement RGPD Art. 17 directement depuis l'interface admin, avec suivi SLA, prolongation Art. 12(3) à octroi unique et reçus chaînés au journal d'audit.
---

Demandes des personnes concernées est l'endroit où les Admins d'organisation traitent les demandes d'effacement RGPD Art. 17 sans quitter le produit. Chaque dépôt insère un reçu durable avec un délai SLA de 30 jours, fait tourner la cascade d'effacement en tâche de fond et écrit une entrée au journal d'audit pour chaque transition d'état — déposée, bloquée, exécutée, prolongée, réessayée, partielle, échouée. La page porte le nom de l'ombrelle DSR plutôt que seulement « effacement » afin que les futurs flux Art. 16 (rectification) et Art. 20 (portabilité) puissent atterrir sur la même surface sans renommer la route ; aujourd'hui, seule Art. 17 est livrée.

Le public, c'est l'Admin d'organisation en charge de la conformité. Membres, Éditeurs et Développeurs ne voient pas cette page. La surface est **Paramètres > Gouvernance > Demandes des personnes concernées**.

## La vérification d'identité se fait hors-bande

Tale est admin-médié par conception — il n'y a pas de portail libre-service pour la personne concernée. L'Admin qui dépose la demande **est** le point de vérification d'identité, ayant confirmé l'identité de la personne via le processus propre à l'organisation avant d'ouvrir la boîte (offboarding RH, flux de support ticketé, vérification en personne). Le produit n'ajoute pas d'étape IDV en cours de flux.

Ce contrat fait de l'Admin l'autorité sur la demande. Le service juridique devrait traiter la phrase de confirmation saisie sur la boîte de dépôt comme la barrière IDV : la taper est un signal délibéré et audit-logué que l'Admin a vérifié la personne.

## Déposer une demande

Clique **Déposer une demande** en haut de la page. La boîte demande quatre champs :

- **Personne concernée** — n'importe quel membre actif de l'organisation, choisi dans une liste de recherche. Le sélecteur est le même que celui utilisé par l'interface des holds légaux.
- **Base légale** — un parmi sept codes structurés qui mappent sur RGPD Art. 17(1)(a)–(f), plus la base opérationnelle `contract_termination` utilisée lors de l'offboarding RH. Les régulateurs attendent des demandes classifiées par base à des fins de reporting ; c'est pourquoi les outils DSR de production (OneTrust, TrustArc, Ketch) portent tous un code structuré à côté du récit.
- **Récit motivant** — texte libre, minimum 10 caractères, qui décrit le contexte de vérification. Le récit est porté sur le reçu et dans le journal d'audit.
- **Confirmation tapée** — tape `ERASE` pour activer le bouton d'envoi. La phrase est stable d'une langue à l'autre, de sorte que l'exigence de frappe est identique partout.

Au dépôt, la cascade tourne en tâche de fond : elle supprime les threads de chat de la personne, les documents indexés RAG, les blobs de métadonnées de fichiers, et neuf catégories par table de portée-personne, puis efface les données personnelles dans les lignes du journal d'audit que la personne a écrites.

Si la personne est sous un hold légal actif — à l'échelle de l'organisation ou par custodian — la demande est **refusée à la barrière**. Un panneau en ligne fait remonter le compte de threads et documents tenus, plus un lien profond vers la page des holds légaux. Le reçu est tout de même inséré à l'état **bloquée** afin que le chemin d'audit régulateur ait la preuve structurée que la demande a été reçue.

## Badge SLA et la prolongation Art. 12(3)

Chaque demande porte un délai de 30 jours compté depuis la date de dépôt. Les vues liste et détail rendent un badge de compte à rebours SLA avec quatre seaux :

- **Vert** — plus de 7 jours restants.
- **Jaune** — 7 jours ou moins restants.
- **Rouge** — en retard.
- **Gris** — statut terminal (terminée ou échouée) ; le compte à rebours est sans objet.

L'Art. 12(3) du RGPD permet au responsable de prolonger la fenêtre de réponse jusqu'à deux mois de plus pour les demandes complexes, **mais la prolongation doit être communiquée à la personne dans le mois initial, avec motifs**. L'action **Prolonger le délai** dans le tiroir de détail met en œuvre cette contrainte :

- Disponible tant que la demande est non terminale et que le délai initial n'est pas écoulé.
- Ajouter de 1 à 60 jours, avec un motif de prolongation obligatoire d'au moins 10 caractères.
- Chaque demande peut être prolongée **au plus une fois** — une seconde tentative est refusée avec une erreur « déjà prolongée ».
- Le badge SLA affiche le délai prolongé dès qu'une prolongation est accordée, sinon le délai initial — une prolongation accordée change immédiatement le seau de couleur et le compte à rebours affiché.

Le journal d'audit enregistre qui a accordé la prolongation, le motif et le nouveau délai.

## Réessayer les exécutions partielles, bloquées ou échouées

Trois états sont rejouables depuis l'action **Réessayer** du tiroir de détail :

- **partielle** — la cascade a tourné mais certaines catégories ont été sautées par un hold posé en cours de route, ou le plafond de tentatives par page a été atteint sur un thread précis.
- **bloquée** — la demande a été refusée à la barrière du hold légal au moment du dépôt. Relâche le hold gênant, puis réessaie.
- **échouée** — la cascade a planté (service RAG injoignable, erreur d'infra transitoire) ou a été ramassée par le watchdog après avoir dépassé le plafond de 30 minutes pour l'action.

La barrière du hold tourne à nouveau au démarrage du processeur, ce qui ferme la fenêtre durant l'intervalle « relâcher le hold puis réessayer » de l'opérateur.

## Ce que montre le reçu

Le tiroir de détail rend le reçu Art. 17 / Art. 19 complet pour une demande :

- Badge de statut plus compte à rebours SLA.
- Identifiant de la personne, base légale, récit motivant, qui a déposé et quand, délai SLA courant (avec info de prolongation le cas échéant).
- Compteurs : threads effacés et ciblés, documents RAG retirés, documents effacés, documents sautés par hold, message d'erreur en cas d'échec.
- Chronologie d'audit : chaque ligne du journal d'audit d'effacement RGPD liée à la personne, triée par horodatage de chaîne.

**Aucun contenu PII effacé n'est rendu** — uniquement des compteurs agrégés et des identifiants. Le reçu est sûr à remettre directement à un régulateur ou à la personne.

## Périmètre aujourd'hui, périmètre demain

Seul l'effacement Art. 17 est livré aujourd'hui. Les exclusions intentionnelles de la coupe v1 :

- Art. 16 rectification et Art. 20 portabilité — atterriront comme des types de demande supplémentaires sur la même page DSR, sans renommage de route.
- Portail libre-service pour la personne concernée — Tale est admin-médié par conception.
- Vérification d'identité dans le produit — traitée hors-bande par l'organisation de l'Admin.
- Notification courriel à la personne à la complétion — différée vers le chantier d'infrastructure courriel.
- Demandes groupées (dépôts par sociétés de gestion de réclamations).
- Modèles multi-juridictions (CCPA, LGPD) — RGPD d'abord.
- Rédaction pilotée par IA — Tale efface plutôt que rédige.

## Où cela s'insère

Demandes des personnes concernées est la trappe de secours conformité qui prouve que Tale prend au sérieux le droit à l'effacement. Elle est posée à côté de [Gouvernance](/fr/platform/admin/governance) (rétention, hold légal, audit-logging) — ces trois pages couvrent ensemble les commandes de cycle de vie des données dont un délégué à la protection a besoin pour construire un argument défendable sous RGPD. Atteins cette page quand un dépôt vérifié de personne concernée arrive ; atteins Gouvernance quand la question est « quelle est notre rétention par défaut ? ».

Références externes :

- [RGPD Art. 12 — Information transparente et modalités](https://gdpr-info.eu/art-12-gdpr/)
- [RGPD Art. 17 — Droit à l'effacement](https://gdpr-info.eu/art-17-gdpr/)
