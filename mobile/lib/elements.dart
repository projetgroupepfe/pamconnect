/// Les pieces d'ecran que plusieurs pages partagent.
///
/// Ecrites une seule fois : deux copies finiraient par ne plus se
/// ressembler, et le telephone ne dirait plus la meme chose d'un ecran a
/// l'autre.
library;

import 'package:flutter/material.dart';

import 'modeles.dart';
import 'theme.dart';

/// "Vous avez 3 jetons, dont 3 offerts."
///
/// Les jetons offerts sont nommes parce qu'ils perissent, contrairement aux
/// jetons achetes : ne donner que le total cacherait ce qui va disparaitre.
String phraseJetons(Jetons jetons) {
  if (jetons.total == 0) return "Vous n'avez aucun jeton.";
  final base = 'Vous avez ${jetons.total} jeton${jetons.total > 1 ? 's' : ''}';
  if (jetons.offerts == 0) return '$base.';
  return '$base, dont ${jetons.offerts} offert${jetons.offerts > 1 ? 's' : ''}.';
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

/// "Bonjour Nabila", et le solde de jetons.
class EnTetePersonne extends StatelessWidget {
  const EnTetePersonne({super.key, required this.moi});

  final Moi moi;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Couleurs.bleuClair,
        borderRadius: BorderRadius.circular(rayon),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Bonjour ${moi.nom}',
            style: texte.titleLarge?.copyWith(
              color: Couleurs.bleuFonce,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            phraseJetons(moi.jetons),
            style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
          ),
        ],
      ),
    );
  }
}

/// Un titre de section, annonce comme tel aux lecteurs d'ecran.
class TitreSection extends StatelessWidget {
  const TitreSection(this.texte, {super.key});

  final String texte;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 12),
      child: Semantics(
        header: true,
        child: Text(
          texte,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: Couleurs.bleuFonce,
                fontWeight: FontWeight.w600,
              ),
        ),
      ),
    );
  }
}

/// Une ligne d'information precedee de son icone.
///
/// [aide] s'ajoute a la suite dans un ton plus discret, comme la classe
/// "aide" du site (la duree estimee a cote du prix, par exemple).
/// [enGras] met la valeur en avant apres un debut de phrase ordinaire :
/// "Disponible" puis les jours.
class LigneDetail extends StatelessWidget {
  const LigneDetail({
    super.key,
    required this.icone,
    required this.texte,
    this.aide,
    this.enGras,
    this.apresGras,
  });

  final IconData icone;
  final String texte;
  final String? aide;
  final String? enGras;

  /// Colle a la valeur en gras, sans espace : "Avec Awa, Menage".
  final String? apresGras;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = this.aide;
    final enGras = this.enGras;
    final apresGras = this.apresGras;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: Couleurs.encreDouce),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(text: texte),
                  if (enGras != null)
                    TextSpan(
                      text: ' $enGras',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                    ),
                  if (apresGras != null) TextSpan(text: apresGras),
                  if (aide != null)
                    TextSpan(text: ' $aide', style: const TextStyle(color: Couleurs.encrePale)),
                ],
              ),
              style: style,
            ),
          ),
        ],
      ),
    );
  }
}

/// Une petite etiquette : "Mise en avant", l'etat d'une identite, une note.
///
/// Par defaut, le bleu de la classe badge-info du site : une information,
/// pas une verification. Le vert reste reserve a ce qui a ete controle.
class Pastille extends StatelessWidget {
  const Pastille({
    super.key,
    required this.texte,
    this.icone,
    this.fond = Couleurs.bleuClair,
    this.couleur = Couleurs.bleu,
  });

  final String texte;
  final IconData? icone;
  final Color fond;
  final Color couleur;

  @override
  Widget build(BuildContext context) {
    final icone = this.icone;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      // Entierement arrondie, comme les pastilles du site (999px).
      decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icone != null) ...[
            Icon(icone, size: 16, color: couleur),
            const SizedBox(width: 4),
          ],
          Text(
            texte,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: couleur,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }
}

/// Ce qui vient de reussir, par exemple une demande publiee.
///
/// liveRegion, pour la meme raison que l'avertissement : la personne qui
/// utilise un lecteur d'ecran doit entendre que c'est fait.
class Confirmation extends StatelessWidget {
  const Confirmation({super.key, required this.texte});

  final String texte;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Couleurs.vertFond,
          borderRadius: BorderRadius.circular(rayon),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.check_circle_outline, color: Couleurs.vert),
            const SizedBox(width: 8),
            Expanded(
              child: Text(texte, style: const TextStyle(color: Couleurs.vert)),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Voulez-vous vraiment refuser ?" : la meme question que sur le site,
/// avant un geste qui ne s'annule pas. Rend true seulement si la personne
/// confirme ; fermer la fenetre vaut Annuler.
Future<bool> confirmerRefus(BuildContext context, String nom) async {
  final reponse = await showDialog<bool>(
    context: context,
    builder: (contexte) => AlertDialog(
      title: Text('Voulez-vous vraiment refuser la candidature de $nom ?'),
      content: const Text(
        "Votre demande reste ouverte : d'autres personnes pourront encore y répondre.",
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(contexte).pop(false),
          child: const Text('Annuler'),
        ),
        TextButton(
          onPressed: () => Navigator.of(contexte).pop(true),
          style: TextButton.styleFrom(foregroundColor: Couleurs.rouge),
          child: const Text('Refuser'),
        ),
      ],
    ),
  );
  return reponse == true;
}
