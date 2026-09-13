import 'package:flutter/material.dart';

/// Les couleurs du site, reprises telles quelles de public/style.css.
///
/// Le site et l'application doivent se reconnaitre au premier coup d'oeil :
/// une personne qui passe de l'un a l'autre ne doit pas se demander si c'est
/// le meme service.
abstract final class Couleurs {
  static const bleu = Color(0xFF1F4E79);
  static const bleuFonce = Color(0xFF143656);
  static const bleuClair = Color(0xFFE8F0F7);
  static const orange = Color(0xFFC25E14);
  static const orangeFonce = Color(0xFF9E4B0E);
  static const encre = Color(0xFF1A2430);
  static const encreDouce = Color(0xFF4E5D6C);
  static const trait = Color(0xFFE3DDD5);
  static const fond = Color(0xFFFAF8F5);
  static const surface = Color(0xFFFFFFFF);
  static const rouge = Color(0xFFA32B33);
  static const rougeFond = Color(0xFFFBE7E8);
}

/// Le rayon des angles du site (--rayon: 12px).
const double rayon = 12;

ThemeData themePamConnect() {
  return ThemeData(
    colorScheme: ColorScheme.fromSeed(
      seedColor: Couleurs.bleu,
      primary: Couleurs.bleu,
      secondary: Couleurs.orange,
      surface: Couleurs.surface,
      error: Couleurs.rouge,
    ),
    scaffoldBackgroundColor: Couleurs.fond,
    appBarTheme: const AppBarTheme(
      backgroundColor: Couleurs.surface,
      foregroundColor: Couleurs.bleuFonce,
      elevation: 0,
      scrolledUnderElevation: 1,
    ),
    cardTheme: CardThemeData(
      color: Couleurs.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(rayon),
        side: const BorderSide(color: Couleurs.trait),
      ),
    ),
    // L'action principale est orange, comme le bouton "Publier une demande"
    // du site.
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Couleurs.orange,
        foregroundColor: Couleurs.surface,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(rayon)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Couleurs.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(rayon)),
    ),
  );
}

/// Un message qui demande de l'attention : une erreur, un refus, une
/// session perdue.
///
/// liveRegion : un lecteur d'ecran l'annonce des qu'il apparait, sinon une
/// personne malvoyante ne saurait pas pourquoi rien ne se passe.
class Avertissement extends StatelessWidget {
  const Avertissement({super.key, required this.texte});

  final String texte;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Couleurs.rougeFond,
          borderRadius: BorderRadius.circular(rayon),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.info_outline, color: Couleurs.rouge),
            const SizedBox(width: 8),
            Expanded(
              child: Text(texte, style: const TextStyle(color: Couleurs.rouge)),
            ),
          ],
        ),
      ),
    );
  }
}
