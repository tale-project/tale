---
title: Alertes d’intégrité du journal d’audit
description: Comment réagir quand le contrôle quotidien d’intégrité du journal d’audit lève une alerte.
---

Tale vérifie la chaîne de hachage du journal d’audit de chaque organisation selon un planning et lève une alerte à l’instant où une vérification échoue. Cette page est le runbook de l’opérateur ou de l’admin qui a reçu cette alerte : comment lire le constat, comment séparer un vrai signal de falsification d’un artefact ordinaire de rétention ou de configuration, et quoi préserver avant de toucher à quoi que ce soit. L’alerte est volontairement bruyante parce qu’une vraie rupture est rare et grave — mais la plupart des ruptures qui se déclenchent en pratique ont une explication banale, donc le travail consiste à les écarter méthodiquement plutôt qu’à paniquer.

## Ce qui la déclenche

Un cron quotidien parcourt la chaîne d’audit en append-only de chaque organisation, avec ses points de contrôle de rétention et de scrub. Quand une chaîne ne se vérifie pas, l’exécution fait deux choses. Elle écrit une ligne d’audit in-band de catégorie `security` — à chaque exécution en échec, pour que l’enregistrement durable soit toujours complet — et elle lève une notification out-of-band vers les admins de l’organisation, dans la cloche de notifications et dans ton canal Slack quand il y en a un de connecté.

L’alerte out-of-band est dédupliquée. Tu reçois une notification à la première détection d’une rupture, et une autre seulement si elle change — une autre ligne rompue, ou un autre point de contrôle en échec — pas une nouvelle alarme chaque jour pour la même rupture. Une exécution propre ultérieure efface l’alerte d’elle-même ; une rupture différente, plus tard, en lève une nouvelle.

## Falsification ou lacune de configuration

L’alerte arrive sous deux formes, et le titre te dit laquelle. **Échec du contrôle d'intégrité du journal d'audit** est la critique : la chaîne de hachage elle-même ne se vérifie pas, ou la signature d’un point de contrôle signé ne correspond pas à la clé configurée. Traite-la comme un signal de falsification possible tant que tu ne l’as pas expliquée.

**Les signatures du journal d'audit ne peuvent pas être vérifiées** est un avertissement calme, pas une intrusion : un point de contrôle est signé, mais le déploiement n’a aucune `TALE_AUDIT_SIGNING_KEY` configurée pour vérifier cette signature. Rien n’a été forgé — Tale ne peut pas prouver que le point de contrôle est authentique tant que tu n’as pas restauré la clé. Le panneau dans le produit reflète la distinction : une chaîne saine montre le badge vert **Vérifié**, un incident actif le badge rouge **Alerte d'intégrité active**, et une organisation que le cron n’a pas encore atteinte montre **Pas encore vérifié**.

## Ouvrir le panneau d’intégrité

Les admins d’une organisation inspectent la chaîne depuis **Paramètres > Gouvernance > Journaux d'audit**. Le panneau **Intégrité de la chaîne** en haut de la page montre le badge de statut, l’heure du dernier contrôle automatique et un bouton **Vérifier maintenant** qui relance la même vérification à la demande. Si tu arrives depuis la notification, cliquer sur l’alerte te mène directement à la ligne signalée dans le tableau d’audit au lieu du haut du journal.

Lance **Vérifier maintenant** pour voir le constat structuré. Pour une rupture de la chaîne de hachage, le panneau montre **Intégrité de la chaîne rompue** avec l’**ID de l'entrée** de la première ligne en échec, le moment (**Survenue le**), le **Hachage attendu** et le **Hachage stocké** qui n’a pas correspondu — plus un bouton **Ouvrir cette entrée** qui révèle la ligne dans le tableau. Pour un problème de point de contrôle, il montre **Échec de la vérification du point de contrôle** avec l’**ID du point de contrôle** et une **Raison**. Note ces détails avant de changer quoi que ce soit : ils sont la preuve.

## Écarter les causes bénignes

Une rupture de hachage n’est un signal de falsification que si rien de légitime ne l’explique, et le vérificateur connaît déjà les trois événements ordinaires derrière presque toutes les alertes — les confirmer est ton premier geste.

**Une coupe de rétention.** Quand la rétention supprime définitivement d’anciennes lignes, la tête de chaîne survivante pointe vers une ligne qui n’existe plus. Le vérificateur ré-ancre la chaîne par-dessus la coupe grâce à un point de contrôle de rétention signé — une coupe propre se vérifie donc normalement. Si tu vois à la place **Les signatures du journal d'audit ne peuvent pas être vérifiées**, la coupe elle-même va bien — il manque au déploiement la `TALE_AUDIT_SIGNING_KEY` qui authentifie le point de contrôle. C’est une lacune de configuration, pas une falsification.

**Un scrub RGPD.** Effacer une personne concernée vide ses champs sur place, ce qui changerait les hachages de ces lignes — un scrub écrit donc un point de contrôle de scrub signé couvrant les lignes touchées, et le vérificateur leur fait confiance sur cette base. Un scrub ne devrait jamais apparaître comme une rupture sur un déploiement qui a une clé de signature.

**Les anciennes lignes d’avant la chaîne.** Les lignes écrites avant l’existence du chaînage de hachage d’audit ne portent aucun hachage d’intégrité. Le vérificateur les saute automatiquement ; ce n’est pas une rupture.

Un vrai signal de falsification est un écart de hachage sans aucune de ces explications : pas de coupe de rétention à cet endroit, pas de scrub couvrant la ligne, et la clé de signature présente et correcte.

## Réagir à une vraie rupture

Si le constat survit à ce triage — un écart de hachage que tu ne peux pas expliquer —, traite-le comme un incident de sécurité et préserve d’abord les preuves. Les lignes d’audit sont en append-only par conception ; ne supprime ni ne modifie aucune ligne, y compris la ligne signalée, car cela détruit l’enregistrement dont une enquête dépend.

1. Note le constat mot pour mot — l’**ID de l'entrée**, l’heure sous **Survenue le**, le **Hachage attendu** et le **Hachage stocké** (ou l’**ID du point de contrôle** et la **Raison**) affichés dans le panneau. Copie-les ou fais-en une capture plutôt que de te fier à la seule alerte.
2. Confirme si la clé de signature est configurée sur l’hôte, pour distinguer un vrai écart d’un point de contrôle invérifiable. Ceci rapporte la présence sans imprimer le secret :
   ```bash
   grep -q '^TALE_AUDIT_SIGNING_KEY=' .env && echo configured || echo missing
   ```
3. Corrèle l’horodatage de la rupture avec l’activité récente — une passe de rétention, un scrub de personne concernée, un déploiement, une restauration de base de données ou un accès direct à la base. Une rupture alignée sur une action de maintenance a le plus souvent une cause ordinaire que tu peux maintenant nommer.
4. Si rien ne l’explique, escalade via ta politique d’incident de sécurité et traite la base de données comme potentiellement compromise jusqu’à preuve du contraire. Garde un snapshot de sauvegarde d’avant et d’après la rupture détectée pour l’investigation.

## Effacer l’alerte

L’alerte est liée à l’incident, pas récurrente. Une fois la rupture résolue ou expliquée — la clé restaurée, l’artefact de rétention compris, une base falsifiée reconstruite depuis une sauvegarde saine —, la prochaine exécution quotidienne se vérifie proprement et efface l’alerte d’elle-même, et le badge **Intégrité de la chaîne** revient à **Vérifié**. Il n’y a aucune étape d’accusé de réception ou de rejet à retenir. Si une rupture différente apparaît plus tard, le contrôle lève une nouvelle alerte pour celle-là — couper le son n’est donc jamais nécessaire.

## Où cela s’inscrit

Une alerte d’intégrité est une invitation à enquêter, pas un verdict — le contrôle quotidien tourne fort pour qu’une rare vraie rupture ne puisse pas se cacher parmi les journaux, et ce runbook est la façon de séparer ce cas rare des artefacts de rétention et de scrub derrière la plupart des alertes. Le mécanisme que le vérificateur contrôle — la chaîne de hachage SHA-256 et les points de contrôle signés en HMAC — est documenté dans [Cryptographie](/fr/self-hosted/operate/security/cryptography), et les coupes de rétention qui la ré-ancrent légitimement sont dans [Rétention](/fr/self-hosted/configuration/retention). Le panneau, les colonnes et l’export avec lesquels tu lis une ligne signalée vivent dans la référence [Journaux d'audit](/fr/platform/admin/governance/audit-logs) ; la checklist [Durcissement](/fr/self-hosted/operate/security/hardening) est l’endroit où ce monitoring s’allume en premier lieu.
