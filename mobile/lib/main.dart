import 'package:flutter/material.dart';

import 'ecran_connexion.dart';
import 'theme.dart';

void main() {
  runApp(const PamConnect());
}

/// L'application mobile de PamConnect.
///
/// Elle ne contient AUCUNE regle metier : elle demande au serveur, qui
/// decide, et elle affiche. Toutes les regles restent dans server.js, au
/// meme endroit que pour le site, couvertes par les memes tests. Une regle
/// recopiee dans deux langages finirait par dire deux choses.
class PamConnect extends StatelessWidget {
  const PamConnect({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PamConnect',
      debugShowCheckedModeBanner: false,
      theme: themePamConnect(),
      home: const EcranConnexion(),
    );
  }
}
