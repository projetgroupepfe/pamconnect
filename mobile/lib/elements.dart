/// Les pieces d'ecran que plusieurs pages partagent.
///
/// Ecrites une seule fois : deux copies finiraient par ne plus se
/// ressembler, et le telephone ne dirait plus la meme chose d'un ecran a
/// l'autre.
library;

import 'package:flutter/material.dart';

import 'modeles.dart';
import 'theme.dart';

// LES ICONES DU SITE ET LEUR EQUIVALENT ANDROID. Le dessin differe, le
// symbole est le meme : un bouton porte ici l'equivalent de l'icone qu'il
// porte sur le site (views/partiels/icone.ejs). Toutes sont rangees dans
// l'application : aucune ne vient d'internet.
//
//   lieu           Icons.place_outlined          profil     Icons.person_outline
//   verifie        Icons.verified_user_outlined  equipe     Icons.group_outlined
//   disponibilite  Icons.schedule                envoi      Icons.file_upload_outlined
//   calendrier     Icons.calendar_today_outlined ajouter    Icons.add
//   message        Icons.chat_bubble_outline     valider    Icons.check
//   avis           Icons.star_border             refuser    Icons.close
//   experience     Icons.work_outline            info       Icons.info_outline
//   remuneration   Icons.payments_outlined       suivant    Icons.chevron_right
//   recherche      Icons.search                  document   Icons.insert_drive_file_outlined
//   email          Icons.mail_outline            jeton      Icons.toll_outlined
//   signaler       Icons.flag_outlined           modifier   Icons.edit_outlined

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
                color: Couleurs.bleu,
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

/// Une question avant un geste qui ne s'annule pas, la meme que sur le
/// site. Rend true seulement si la personne confirme ; fermer la fenetre
/// vaut Annuler.
Future<bool> demanderConfirmation(
  BuildContext context, {
  required String question,
  required String precision,
  required String action,
  bool danger = false,
}) async {
  final reponse = await showDialog<bool>(
    context: context,
    builder: (contexte) => AlertDialog(
      title: Text(question),
      content: Text(precision),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(contexte).pop(false),
          child: const Text('Annuler'),
        ),
        TextButton(
          onPressed: () => Navigator.of(contexte).pop(true),
          style: danger ? TextButton.styleFrom(foregroundColor: Couleurs.rouge) : null,
          child: Text(action),
        ),
      ],
    ),
  );
  return reponse == true;
}

/// "Voulez-vous vraiment refuser ?"
Future<bool> confirmerRefus(BuildContext context, String nom) => demanderConfirmation(
      context,
      question: 'Voulez-vous vraiment refuser la candidature de $nom ?',
      precision: "Votre demande reste ouverte : d'autres personnes pourront encore y répondre.",
      action: 'Refuser',
      danger: true,
    );

/// Declarer le service effectue verse la somme bloquee : on le confirme
/// d'abord.
Future<bool> confirmerDeclarationService(BuildContext context, String nom) => demanderConfirmation(
      context,
      question: 'Confirmez-vous que le service a été effectué ?',
      precision: "La somme bloquée sera versée à $nom. Cette déclaration ne s'annule pas.",
      action: 'Déclarer',
    );

/// Un avis recu, comme le site l'affiche : la note, son auteur, le
/// commentaire et les criteres.
///
/// Sur son propre profil, le seul recours possible : le signaler. On ne
/// peut pas effacer un avis qui nous vise.
class CarteAvis extends StatelessWidget {
  const CarteAvis({super.key, required this.avis, this.auSignaler, this.signalementEnCours = false});

  final AvisPublic avis;

  /// Absent sur la fiche d'une autre personne.
  final void Function(AvisPublic avis)? auSignaler;
  final bool signalementEnCours;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final commentaire = avis.commentaire;
    final titreDemande = avis.titreDemande;
    final auSignaler = this.auSignaler;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: avis.note, style: fort),
                    TextSpan(
                      text: titreDemande == null
                          ? '  par ${avis.auteur}'
                          : '  par ${avis.auteur}, après « $titreDemande »',
                      style: aide,
                    ),
                  ],
                ),
              ),
              if (commentaire != null) ...[
                const SizedBox(height: 8),
                Text(commentaire, style: texte.bodyLarge?.copyWith(color: Couleurs.encre)),
              ],
              for (final critere in avis.criteres) LigneDetail(icone: Icons.star_border, texte: critere),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: avis.date),
              if (auSignaler != null && avis.id != null) ...[
                const SizedBox(height: 12),
                if (avis.signale)
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      const Pastille(texte: 'Signalé', fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
                      Text("L'équipe examine cet avis. Il reste visible en attendant.", style: aide),
                    ],
                  )
                else
                  OutlinedButton.icon(
                    onPressed: signalementEnCours ? null : () => auSignaler(avis),
                    icon: const Icon(Icons.flag_outlined),
                    label: const Text('Signaler cet avis'),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Un champ avec la liste de suggestions du site (le datalist).
///
/// Un simple filtre d'affichage : on peut toujours ecrire un nom absent de
/// la liste, comme sur le site.
class ChampAvecSuggestions extends StatelessWidget {
  const ChampAvecSuggestions({
    super.key,
    required this.liste,
    required this.libelle,
    required this.exemple,
    required this.garder,
    this.valeurDepart = '',
    this.aide,
    this.auChangement,
  });

  final List<String> liste;
  final String libelle;
  final String exemple;

  /// Recoit le controleur du champ, pour lire la saisie a l'envoi.
  final void Function(TextEditingController) garder;
  final String valeurDepart;
  final String? aide;
  final void Function(String)? auChangement;

  Iterable<String> _suggestions(String saisie) {
    final cherche = saisie.trim().toLowerCase();
    if (cherche.isEmpty) return const Iterable<String>.empty();
    return liste.where((nom) => nom.toLowerCase().contains(cherche));
  }

  @override
  Widget build(BuildContext context) {
    return Autocomplete<String>(
      initialValue: TextEditingValue(text: valeurDepart),
      optionsBuilder: (saisie) => _suggestions(saisie.text),
      onSelected: (choix) => auChangement?.call(choix),
      fieldViewBuilder: (context, controleur, focus, valider) {
        garder(controleur);
        return TextField(
          controller: controleur,
          focusNode: focus,
          autocorrect: false,
          textInputAction: TextInputAction.next,
          onChanged: auChangement,
          onSubmitted: (_) => valider(),
          decoration: InputDecoration(
            labelText: libelle,
            hintText: exemple,
            helperText: aide,
            helperMaxLines: 2,
          ),
        );
      },
    );
  }
}

/// Des lignes de montants, comme le bloc detail-tarif du site : le meme
/// cadre au fond clair, les montants en gras et en noir, la commission en
/// orange, le total sous un trait.
///
/// [suite] ajoute d'autres lignes dans le meme cadre, par exemple les deux
/// parts d'un solde de jetons.
class DetailMontants extends StatelessWidget {
  const DetailMontants({super.key, required this.lignes, this.suite = const []});

  final List<LigneTarif> lignes;
  final List<Widget> suite;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    // Les couleurs de .ligne-tarif dans public/style.css : le libelle en gris, le
    // montant en noir, la commission en orange, et le total en vert, plus grand.
    final libelle = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final montant = texte.bodyLarge?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600);
    final montantTotal = texte.titleMedium?.copyWith(color: Couleurs.vert, fontWeight: FontWeight.w600, fontSize: 19);
    final retenue = texte.bodyMedium?.copyWith(color: Couleurs.orange, fontWeight: FontWeight.w600);

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
      decoration: BoxDecoration(
        color: Couleurs.fond,
        border: Border.all(color: Couleurs.trait),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final ligne in lignes)
            Container(
              margin: EdgeInsets.only(top: ligne.total ? 6 : 0),
              padding: EdgeInsets.only(top: ligne.total ? 10 : 4, bottom: 4),
              decoration: ligne.total
                  ? const BoxDecoration(border: Border(top: BorderSide(color: Couleurs.trait)))
                  : null,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text(ligne.libelle, style: libelle)),
                  const SizedBox(width: 12),
                  Text(ligne.montant, style: ligne.retenue ? retenue : (ligne.total ? montantTotal : montant)),
                ],
              ),
            ),
          ...suite,
        ],
      ),
    );
  }
}

/// Une ligne d'information avec son icone, dont une partie peut etre en gras :
/// les listes <ul class="infos"> du site.
class LigneRiche extends StatelessWidget {
  const LigneRiche({super.key, required this.icone, required this.morceaux});

  final IconData icone;
  final List<InlineSpan> morceaux;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: Couleurs.encreDouce),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(children: morceaux),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce),
            ),
          ),
        ],
      ),
    );
  }
}
