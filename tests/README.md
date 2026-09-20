# Les tests de PamConnect

Ce dossier ne fait pas partie de l'application. `server.js` ne le lit
jamais : si vous le supprimiez, la plateforme fonctionnerait à
l'identique.

Il sert à une seule chose : vérifier qu'une correction n'en casse pas
une autre.

## Les lancer

```
npm test
```

Chaque série démarre le serveur sur le port **3999**, jamais 3000, pour
ne pas gêner celui que vous avez peut-être ouvert.

## Ce qu'il faut savoir avant

Les séries écrivent dans la vraie base, `data/pamconnect.db`. Elles
créent leurs propres comptes — tous en `@example.com` — et les
suppriment à la fin.

**Ne les lancez pas pendant une démonstration.** Avant ou après.

Si une série s'arrête en cours de route, ses comptes restent. Pour le
vérifier :

```sql
SELECT COUNT(*) FROM utilisateurs WHERE email LIKE '%example.com';
```

## Comment lire le résultat

```
  test_tarif_equipe        37 tests
  test_liberer_demande     34 tests
  test_demonstration       48 tests

  TOTAL : 1917 tests, 0 échec(s), 0 série(s) plantée(s)
```

Une série qui **plante** n'affiche aucun échec : elle s'arrête avant
d'avoir pu en compter un. C'est pourquoi le total les compte à part —
sans cette colonne, on croirait tout vert alors que rien n'a tourné.

## Une série à part : `test_demonstration.js`

Elle ne vérifie pas une fonctionnalité. Elle rejoue les **six écrans du
scénario de soutenance**, dans l'ordre, et contrôle que chacun affiche ce
que la fiche annonce — jusqu'aux montants et aux libellés des boutons.

Tant qu'elle passe, le scénario écrit est vrai. Le jour où une
modification le rendrait faux, elle le dira avant le jury.

Elle utilise des comptes jetables : les comptes de la démonstration ne
doivent jamais être consommés par un test.
