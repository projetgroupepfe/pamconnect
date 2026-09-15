import 'package:flutter/material.dart';

import 'ecran_connexion.dart';
import 'theme.dart';

Future<void> main() async {
  // L'adresse retenue est lue AVANT le premier ecran : sans cela, le champ
  // apparaitrait un instant, puis disparaitrait.
  WidgetsFlutterBinding.ensureInitialized();
  final adresse = await lireAdresseRetenue();
  runApp(PamConnect(adresse: adresse));
}

/// L'application mobile de PamConnect.
///
/// Elle ne contient AUCUNE regle metier : elle demande au serveur, qui
/// decide, et elle affiche. Toutes les regles restent dans server.js, au
/// meme endroit que pour le site, couvertes par les memes tests. Une regle
/// recopiee dans deux langages finirait par dire deux choses.
class PamConnect extends StatelessWidget {
  const PamConnect({super.key, this.adresse = ''});

  /// L'adresse du serveur retenue sur le telephone, vide la premiere fois.
  final String adresse;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PamConnect',
      debugShowCheckedModeBanner: false,
      theme: themePamConnect(),
      home: EcranConnexion(adresseInitiale: adresse),
    );
  }
}
