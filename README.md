# Indicateurs — panneau de suivi pour Claude Code

Un panneau affiché à côté du chat, dans chaque session et pour n'importe quel projet :

- **Environnement** : cloud ou local, dossier, branche git, dépôt, modèle
- **Contexte** : % utilisé, barre colorée, détail par catégorie, coût de la session (mis à jour après chaque réponse)
- **Connecteurs** : connectés / à connecter / bloqués
- **Modifications** : fichiers modifiés, lignes ajoutées et supprimées
- Bouton **Actualiser**, et commande `/indicateurs` pour rouvrir le panneau

## Installation

À l'invite d'une session Claude Code dans un terminal :

```
/plugin install indicateurs --marketplace JDname0/claude-mods
```

Réponds `y` pour ajouter la marketplace, puis choisis la portée **user** (Entrée) pour l'avoir dans tous tes projets.

Depuis un shell :

```
claude plugin install indicateurs --marketplace JDname0/claude-mods
```

Dans l'app desktop, où `/plugin` ne marche pas : clique sur **+** à côté de la zone de saisie, puis **Plugins**, **Add marketplace** avec `JDname0/claude-mods`, puis **Add plugin**.

Le dépôt est privé : la machine doit déjà avoir un accès git à github.com (clé SSH, ou `gh auth login` puis `gh auth setup-git`).
