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
  static const orangeClair = Color(0xFFFDF0E3);
  static const encre = Color(0xFF1A2430);
  static const encreDouce = Color(0xFF4E5D6C);
  static const encrePale = Color(0xFF67757F);
  static const trait = Color(0xFFE3DDD5);
  static const fond = Color(0xFFFAF8F5);
  static const surface = Color(0xFFFFFFFF);
  static const vert = Color(0xFF1B6B3A);
  static const vertFond = Color(0xFFE3F3E8);
  static const ambre = Color(0xFF8A5A05);
  static const ambreFond = Color(0xFFFBF0DA);
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
    // Les pastilles de la barre, orange comme .pastille sur le site. Sans
    // cela, Flutter leur donne la couleur des erreurs : un rouge d'alerte.
    badgeTheme: const BadgeThemeData(backgroundColor: Couleurs.orange, textColor: Couleurs.surface),
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
