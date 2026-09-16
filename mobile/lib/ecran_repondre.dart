import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_mes_jetons.dart';
import 'ecran_verification.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Repondre a une demande : l'ecran de confirmation du site. Ce que la
/// personne recevra, et ce que la reponse lui coute en jetons, sont ecrits
/// par le serveur AVANT l'envoi.
///
/// En cas de succes, l'ecran rend la phrase du serveur a la liste des
/// demandes.
class EcranRepondre extends StatefulWidget {
  const EcranRepondre({super.key, required this.api, required this.demandeId});

  final ApiPamConnect api;
  final int demandeId;

  @override
  State<EcranRepondre> createState() => _EcranRepondreState();
}

class _EcranRepondreState extends State<EcranRepondre> {
  EcranReponse? _ecran;
  String? _refus;

  /// Le refus se regle en faisant verifier son identite.
  bool _proposeVerification = false;
  bool _envoi = false;
  String? _erreurEnvoi;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final ecran = await widget.api.ecranReponse(widget.demandeId);
      if (!mounted) return;
      setState(() {
        _ecran = ecran;
        _refus = null;
        _proposeVerification = false;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _refus = erreur.message;
        _proposeVerification = erreur.proposeVerification;
      });
    }
  }

  /// Le chemin que le site met sous la phrase du refus. Au retour, l'ecran
  /// se recharge : le statut a pu changer.
  Future<void> _faireVerifier() async {
    await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => EcranVerification(api: widget.api)),
    );
    if (!mounted) return;
    await _charger();
  }

  Future<void> _voirJetons() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => EcranMesJetons(api: widget.api)),
    );
    if (!mounted) return;
    await _charger();
  }

  Future<void> _envoyer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final envoi = await widget.api.repondre(widget.demandeId);
      if (!mounted) return;
      Navigator.of(context).pop(envoi.texte);
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
      appBar: AppBar(title: const Text('Répondre à cette demande')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final ecran = _ecran;
    const hauteurBouton = Size.fromHeight(48);

    // Une demande retiree, deja pourvue, ou une identite pas encore verifiee :
    // la phrase du serveur, et le retour.
    if (refus != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: refus),
          const SizedBox(height: 16),
          // Le bouton orange de la page du site, sans icone comme lui.
          if (_proposeVerification) ...[
            FilledButton(
              onPressed: _faireVerifier,
              child: const Text('Faire vérifier mon identité'),
            ),
            const SizedBox(height: 8),
          ],
          OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
            child: const Text('Retour aux demandes'),
          ),
        ],
      );
    }
    if (ecran == null) return const Center(child: CircularProgressIndicator());

    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final demande = ecran.demande;
    final employeur = ecran.employeur;
    final prix = ecran.prix;
    final cout = ecran.cout;
    final limite = ecran.limite;
    final metier = demande.metier;
    final quartier = demande.quartier;
    final arrondissement = demande.arrondissement;
    final conditions = demande.conditions;
    final prixAnnonce = prix.annonce;
    final duree = prix.dureeEstimee;
    final note = employeur.note;
    final erreurEnvoi = _erreurEnvoi;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          "Vérifiez les informations avant d'envoyer votre réponse.",
          style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  demande.titre,
                  style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
                ),
                if (metier != null) LigneRiche(icone: Icons.work_outline, morceaux: [TextSpan(text: metier, style: fort)]),
                LigneRiche(icone: Icons.calendar_today_outlined, morceaux: [TextSpan(text: demande.horaire)]),
                if (quartier != null || arrondissement != null)
                  LigneRiche(
                    icone: Icons.place_outlined,
                    morceaux: [
                      if (quartier != null) TextSpan(text: quartier, style: fort),
                      if (quartier != null && arrondissement != null) const TextSpan(text: ', '),
                      if (arrondissement != null) TextSpan(text: arrondissement),
                    ],
                  ),
                if (conditions != null) LigneRiche(icone: Icons.info_outline, morceaux: [TextSpan(text: conditions)]),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        // Chez qui elle va, et ce que la plateforme a verifie de lui.
        const TitreSection('Chez qui vous allez'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                LigneRiche(icone: Icons.person_outline, morceaux: [TextSpan(text: employeur.nom, style: fort)]),
                Padding(
                  padding: const EdgeInsets.only(top: 8, left: 26),
                  child: employeur.verifie
                      ? const Pastille(
                          texte: 'Identité et casier vérifiés',
                          icone: Icons.verified_user_outlined,
                          fond: Couleurs.vertFond,
                          couleur: Couleurs.vert,
                        )
                      : const Pastille(texte: 'Identité non vérifiée', fond: Couleurs.trait, couleur: Couleurs.encreDouce),
                ),
                // SA REPUTATION, A LUI AUSSI : une plateforme qui ne fait noter
                // que d'un cote met la pression sur celui qui a le moins de pouvoir.
                LigneRiche(
                  icone: Icons.star_border,
                  morceaux: note == null
                      ? [TextSpan(text: 'Aucun avis sur cet employeur pour le moment.', style: aide)]
                      : [
                          TextSpan(text: note, style: fort),
                          TextSpan(
                            text: ' sur ${employeur.nombreAvis} avis laissés par des personnes qui ont travaillé pour lui',
                            style: aide,
                          ),
                        ],
                ),
                const SizedBox(height: 8),
                // La phrase suit le badge : jamais "non verifiee" au-dessus de
                // "PamConnect a controle sa piece d'identite".
                Text(
                  employeur.verifie
                      ? "Vous vous déplacerez chez cette personne. PamConnect a contrôlé sa pièce d'identité "
                          'et son casier judiciaire, comme les vôtres.'
                      : "Vous vous déplacerez chez cette personne. Son identité n'a pas encore été vérifiée par "
                          'PamConnect. À vous de décider si vous souhaitez répondre à cette demande.',
                  style: aide,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const TitreSection('Ce que vous toucherez'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (prixAnnonce != null)
                  LigneRiche(
                    icone: Icons.payments_outlined,
                    morceaux: [const TextSpan(text: 'Prix annoncé : '), TextSpan(text: prixAnnonce, style: fort)],
                  ),
                if (duree != null)
                  LigneRiche(
                    icone: Icons.schedule,
                    morceaux: [const TextSpan(text: 'Durée estimée : '), TextSpan(text: duree, style: fort)],
                  ),
                if (prix.lignes.isNotEmpty) DetailMontants(lignes: prix.lignes),
                Text(
                  "C'est le prix fixé par l'employeur pour ce service. Si ce montant ne vous convient pas, "
                  'vous pouvez répondre à une autre demande.',
                  style: aide,
                ),
              ],
            ),
          ),
        ),
        // CE QUE CETTE REPONSE VA COUTER, avant de s'engager.
        if (ecran.proposee) ...[
          const SizedBox(height: 8),
          const TitreSection('Ce que cette réponse vous coûte'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text.rich(
                const TextSpan(
                  children: [
                    TextSpan(text: 'Rien.', style: fort),
                    TextSpan(text: ' Cette demande a été publiée pour vous : y répondre ne vous coûte aucun jeton.'),
                  ],
                ),
                style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
              ),
            ),
          ),
        ] else if (cout != null) ...[
          const SizedBox(height: 8),
          const TitreSection('Ce que cette réponse vous coûte'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DetailMontants(
                    lignes: [
                      LigneTarif(libelle: 'Envoyer cette réponse', montant: cout.envoyer, retenue: true, total: false),
                      LigneTarif(libelle: 'Il vous restera', montant: cout.reste, retenue: false, total: true),
                    ],
                  ),
                  if (cout.soldeInsuffisant) ...[
                    Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: 'Votre solde ne suffit pas.', style: fort),
                          TextSpan(text: ' Il vous reste ${cout.solde}.'),
                        ],
                      ),
                      style: aide,
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: _voirJetons,
                      icon: const Icon(Icons.toll_outlined),
                      label: const Text('Voir mes jetons'),
                      style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
                    ),
                  ],
                  // LA LIMITE DU JOUR, dite avant l'envoi.
                  if (limite != null) ...[
                    const SizedBox(height: 8),
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(text: 'Vous pouvez envoyer ${limite.parJour} réponses par tranche de 24 heures.'),
                          if (limite.restant == 0)
                            const TextSpan(text: ' Vous les avez toutes utilisées.', style: fort)
                          else ...[
                            const TextSpan(text: ' Il vous en reste '),
                            TextSpan(text: '${limite.restant}', style: fort),
                            const TextSpan(text: '.'),
                          ],
                        ],
                      ),
                      style: aide,
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 24),
        if (erreurEnvoi != null) ...[
          Avertissement(texte: erreurEnvoi),
          const SizedBox(height: 16),
        ],
        // La coche, comme le bouton du site.
        FilledButton.icon(
          onPressed: _envoi ? null : _envoyer,
          icon: _envoi
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                )
              : const Icon(Icons.check),
          label: const Text('Confirmer ma réponse'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _envoi ? null : () => Navigator.of(context).pop(),
          style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
          child: const Text('Annuler'),
        ),
      ],
    );
  }
}
