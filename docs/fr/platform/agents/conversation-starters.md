---
title: Amorces de conversation
description: Rédiger les prompts d'exemple qu'un agent montre sur son écran de chat vide — ajout, traduction, et l'option d'auto-traduction.
---

Une **Amorce** est un court prompt d'exemple que l'agent montre sur un écran de chat vide. Tape dessus et le texte tombe dans le composer ; l'utilisateur édite s'il le souhaite, puis envoie. Les amorces sont les points d'entrée curatés par l'auteur de l'agent dans ce à quoi l'agent sert.

Cette page est le côté auteur. Le côté utilisateur — comment les amorces s'affichent dans un chat tout neuf — est sur [Amorces et prompts](/fr/platform/chat/starters-and-prompts).

## Ajouter une amorce

Ouvre l'agent et passe à l'onglet **Starters**. **Add starter** ouvre un éditeur avec deux champs : le titre de l'amorce (ce que l'utilisateur voit comme tuile sur le chat vide) et le corps (ce qui tombe dans le composer quand l'utilisateur tape la tuile). Enregistre et l'amorce apparaît dans tout chat tout neuf choisi avec cet agent.

## Valeurs par défaut et traductions

Chaque amorce a une version **default** (le corps EN) et une version traduite optionnelle par locale. Le default est ce qui s'affiche quand aucune traduction n'existe pour la locale de l'utilisateur. Les amorces non traduites sont marquées **untranslated** dans la vue auteur ; les utilisateurs dans ces locales voient le default.

## Auto-traduction

L'onglet Starters expose une action **Auto-translate** qui appelle le fournisseur de traduction de l'organisation pour remplir les locales manquantes. Les traductions sont enregistrées comme chaînes éditables — l'auteur peut ajuster après. L'auto-traduction respecte la configuration du fournisseur de traduction de l'organisation ; les fournisseurs non configurés échouent avec un toast.

## Où ça s'inscrit

Les amorces de conversation sont la plus petite surface dans la zone des agents — quelques phrases chacune, mais elles décident si l'écran de chat vide a l'air invitant ou blanc. La page à coupler avec ça est [Amorces et prompts](/fr/platform/chat/starters-and-prompts), qui montre comment elles s'affichent pour l'utilisateur ; le reste du comportement de l'agent vit dans [Concepts d'agent](/fr/platform/agents/concepts).
