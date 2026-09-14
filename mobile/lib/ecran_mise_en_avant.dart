import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mettre une demande en avant : l'ecran de confirmation du site. Le cout,
/// la duree et le solde viennent du serveur, deja ecrits.
///
/// En cas de succes, l'ecran rend la phrase du serveur a Mes demandes.
class EcranMiseEnAvant extends StatefulWidget {
  const EcranMiseEnAvant({super.key, required this.api, required this.demandeId});

  final ApiPamConnect api;
  final int demandeId;

  @override
  State<EcranMiseEnAvant> createState() => _EcranMiseEnAvantState();
}

class _EcranMiseEnAvantState extends State<EcranMiseEnAvant> {
  InfoMiseEnAvant? _info;
  String? _refus;
  bool _envoi = false;
  String? _erreurEnvoi;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final info = await widget.api.infoMiseEnAvant(widget.demandeId);
      if (!mounted) return;
      setState(() => _info = info);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _refus = erreur.message);
    }
  }

  Future<void> _confirmer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final reponse = await widget.api.mettreEnAvant(widget.demandeId);
      if (!mounted) return;
      Navigator.of(context).pop(reponse.texte);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreurEnvoi = erreur.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mettre en avant')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final info = _info;
    const hauteurBouton = Size.fromHeight(48);
    final retour = OutlinedButton(
      onPressed: () => Navigator.of(context).pop(),
      style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
      child: const Text('Retour à mes demandes'),
    );

    if (refus != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [Avertissement(texte: refus), const SizedBox(height: 16), retour],
      );
    }
    if (info == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final metier = info.metier;
    final lieu = info.lieu;
    final finActuelle = info.finActuelle;
    final erreurEnvoi = _erreurEnvoi;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Vérifiez ce que cela change avant de confirmer.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(info.titre, style: texte.titleMedium?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600)),
                if (metier != null) LigneDetail(icone: Icons.work_outline, texte: metier),
                if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        if (finActuelle != null) ...[
          // DEJA EN AVANT. On ne propose pas de prolonger : quelqu'un qui
          // appuie deux fois paierait deux fois sans s'en apercevoir.
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Pastille(texte: 'Mise en avant', fond: Couleurs.vertFond, couleur: Couleurs.vert),
                const SizedBox(height: 8),
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: "Cette demande est déjà en avant jusqu'au "),
                      TextSpan(text: finActuelle, style: fort),
                      const TextSpan(text: '.'),
                    ],
                  ),
                  style: gris,
                ),
                const SizedBox(height: 8),
                Text(
                  "Vous pourrez la remettre en avant après cette date. D'ici là, rien ne vous sera prélevé.",
                  style: aide,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          retour,
        ] else if (!info.disponible) ...[
          // Aucun prix invente : si le reglage manque, on le dit.
          Text('Cette option n\'est pas disponible pour le moment.', style: gris),
          const SizedBox(height: 4),
          Text("Le prix n'a pas encore été réglé par l'équipe.", style: aide),
          const SizedBox(height: 16),
          retour,
        ] else ...[
          const TitreSection('Ce que cela change'),
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LigneDetail(
                    icone: Icons.arrow_upward,
                    texte: 'Votre demande passe',
                    enGras: metier == null ? 'devant les autres demandes' : 'devant les autres demandes de $metier',
                    apresGras: ' dans la liste.',
                  ),
                  const LigneDetail(
                    icone: Icons.info_outline,
                    texte: 'Elle porte le badge',
                    enGras: 'Mise en avant',
                    apresGras: ', visible de tous.',
                  ),
                  LigneDetail(
                    icone: Icons.calendar_today_outlined,
                    texte: 'Pendant',
                    enGras: '${info.jours} jours',
                    apresGras: '. Ensuite elle reprend sa place, sans que vous ayez rien à faire.',
                  ),
                  const SizedBox(height: 12),
                  // CE QUE LA MISE EN AVANT NE FAIT PAS : le dire evite une
                  // deception.
                  Text.rich(
                    const TextSpan(
                      children: [
                        TextSpan(text: "Elle ne passe pas devant les demandes d'un "),
                        TextSpan(text: 'autre métier', style: fort),
                        TextSpan(
                          text: " : une personne voit d'abord celles qui correspondent au sien. "
                              "On ne paie pas pour être vu par quelqu'un qui cherche autre chose.",
                        ),
                      ],
                    ),
                    style: aide,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          const TitreSection('Ce que cela coûte'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _LigneCout(libelle: 'Mise en avant, ${info.jours} jours', montant: '− ${info.cout}'),
                  const Divider(height: 20),
                  _LigneCout(libelle: 'Il vous restera', montant: info.resteApres ?? '', fort: true),
                  const SizedBox(height: 12),
                  if (!info.soldeSuffit)
                    Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: 'Votre solde ne suffit pas.', style: fort),
                          TextSpan(text: ' Il vous reste ${info.solde}.'),
                        ],
                      ),
                      style: gris,
                    )
                  else
                    // DIT AVANT, PAS APRES : le decouvrir apres avoir paye
                    // serait une mauvaise surprise.
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: "Si vous retirez votre demande ou si vous choisissez quelqu'un avant la fin "
                                'des ${info.jours} jours, ',
                          ),
                          const TextSpan(text: 'les jetons ne sont pas rendus', style: fort),
                          const TextSpan(text: '.'),
                        ],
                      ),
                      style: aide,
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          if (erreurEnvoi != null) ...[
            Avertissement(texte: erreurEnvoi),
            const SizedBox(height: 16),
          ],
          FilledButton(
            onPressed: _envoi || !info.soldeSuffit ? null : _confirmer,
            child: _envoi
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                  )
                : const Text('Confirmer la mise en avant'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _envoi ? null : () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
            child: const Text('Annuler'),
          ),
        ],
      ],
    );
  }
}

class _LigneCout extends StatelessWidget {
  const _LigneCout({required this.libelle, required this.montant, this.fort = false});

  final String libelle;
  final String montant;
  final bool fort;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge?.copyWith(
          color: fort ? Couleurs.encre : Couleurs.encreDouce,
          fontWeight: fort ? FontWeight.w600 : FontWeight.normal,
        );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: Text(libelle, style: style)),
        const SizedBox(width: 12),
        Text(montant, style: style),
      ],
    );
  }
}
