import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_publier.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// La fiche d'une personne : la page du site, ecrite par le serveur.
///
/// Ce qui vient de la plateforme (la verification, la note) se distingue de
/// ce que la personne declare (metier, tarif, disponibilites).
class EcranFiche extends StatefulWidget {
  const EcranFiche({super.key, required this.api, required this.personneId});

  final ApiPamConnect api;
  final int personneId;

  @override
  State<EcranFiche> createState() => _EcranFicheState();
}

class _EcranFicheState extends State<EcranFiche> {
  FichePersonne? _fiche;
  String? _refus;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final fiche = await widget.api.fiche(widget.personneId);
      if (!mounted) return;
      setState(() => _fiche = fiche);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _refus = erreur.message);
    }
  }

  Future<void> _publier() async {
    final texte = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => EcranPublier(api: widget.api)),
    );
    if (!mounted || texte == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texte)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_fiche?.nom ?? 'Profil')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final fiche = _fiche;
    if (refus != null) {
      return ListView(padding: const EdgeInsets.all(16), children: [Avertissement(texte: refus)]);
    }
    if (fiche == null) return const Center(child: CircularProgressIndicator());

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final metier = fiche.metier;
    final trancheAge = fiche.trancheAge;
    final lieu = fiche.lieu;
    final moyenne = fiche.avis.moyenne;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 26,
                      backgroundColor: Couleurs.bleuClair,
                      foregroundColor: Couleurs.bleuFonce,
                      child: Text(fiche.nom.isEmpty ? '' : fiche.nom.characters.first),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(fiche.nom, style: texte.titleLarge?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
                          if (metier != null) Text(metier, style: gris),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                // Le vert pour ce que l'equipe a controle, le bleu pour ce que la
                // personne declare.
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    fiche.verifiee
                        ? Pastille(
                            texte: fiche.libelleVerification,
                            icone: Icons.verified_user_outlined,
                            fond: Couleurs.vertFond,
                            couleur: Couleurs.vert,
                          )
                        : Pastille(texte: fiche.libelleVerification, couleur: Couleurs.encreDouce),
                    Pastille(texte: fiche.note.badge, icone: fiche.note.notee ? Icons.star_border : null),
                    Text(fiche.note.detail, style: gris),
                    for (final badge in fiche.badges) Pastille(texte: badge),
                  ],
                ),
                if (trancheAge != null) LigneDetail(icone: Icons.person_outline, texte: trancheAge),
                if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              ],
            ),
          ),
        ),
        if (fiche.disponibilites.isNotEmpty) ...[
          const SizedBox(height: 8),
          const TitreSection('Ses disponibilités'),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final creneau in fiche.disponibilites)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.calendar_today_outlined, size: 18, color: Couleurs.encreDouce),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text.rich(
                              TextSpan(
                                children: [
                                  TextSpan(text: creneau.jour, style: fort),
                                  TextSpan(text: ' : ${creneau.moments}'),
                                ],
                              ),
                              style: gris,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
        const TitreSection('Le tarif demandé'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Ce montant n'est PAS ce qui sera paye : c'est l'employeur qui
                // fixe le prix de sa demande.
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: fiche.tarif, style: fort),
                      const TextSpan(text: ' pour une prestation.'),
                    ],
                  ),
                  style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
                ),
                const SizedBox(height: 8),
                Text(
                  'C\'est le montant souhaité. Le prix payé est celui que vous annoncez dans votre demande.',
                  style: aide,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // Ce que la verification couvre, et ce qu'elle ne couvre pas.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Ce que nous vérifions, et ce que nous ne vérifions pas',
                style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text.rich(
                const TextSpan(
                  children: [
                    TextSpan(text: "Le badge vert dit une seule chose : l'équipe a contrôlé "),
                    TextSpan(text: "la pièce d'identité et le casier judiciaire", style: fort),
                    TextSpan(text: '. Le '),
                    TextSpan(text: "métier n'est pas vérifié", style: fort),
                    TextSpan(text: ' : il est déclaré par la personne, posez vos questions avant de choisir.'),
                  ],
                ),
                style: gris,
              ),
            ],
          ),
        ),
        if (fiche.peutPublier) ...[
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Travailler avec cette personne', style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(
                    "Publiez votre demande avec le service, l'horaire et le prix : cette personne "
                    'pourra y répondre.',
                    style: gris,
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _publier,
                    icon: const Icon(Icons.add),
                    label: const Text('Publier une demande'),
                  ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 8),
        const TitreSection('Ce que disent les employeurs'),
        // Pas de note n'est pas une mauvaise note : on ne dit pas "0 sur 5".
        if (fiche.avis.nombre == 0)
          Text("Personne ne l'a encore notée.", style: gris)
        else ...[
          if (moyenne != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Pastille(texte: moyenne, icone: Icons.star_border),
                  Text('sur ${fiche.avis.nombre} avis', style: gris),
                ],
              ),
            ),
          for (final avis in fiche.avis.liste) CarteAvis(avis: avis),
        ],
      ],
    );
  }
}
