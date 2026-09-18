import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mes jetons : le solde, ce qu'il permet, les packs, les demandes d'achat
/// et l'historique. Les phrases et les nombres viennent du serveur.
///
/// UNE DEMANDE, PAS UN PAIEMENT. L'application n'envoie que la quantite du
/// pack : le prix est relu par le serveur, et l'equipe ajoute les jetons a
/// la main une fois le paiement constate.
class EcranMesJetons extends StatefulWidget {
  const EcranMesJetons({super.key, required this.api});

  final ApiPamConnect api;

  @override
  State<EcranMesJetons> createState() => _EcranMesJetonsState();
}

class _EcranMesJetonsState extends State<EcranMesJetons> {
  MesJetons? _jetons;
  String? _erreur;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final jetons = await widget.api.mesJetons();
      if (!mounted) return;
      setState(() {
        _jetons = jetons;
        _erreur = null;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _erreur = erreur.message);
    }
  }

  /// La meme question que sur le site : une demande envoyee ne s'annule pas
  /// depuis le compte, et l'equipe attendra un paiement.
  Future<void> _demander(PackJetons pack) async {
    if (_envoi) return;
    final oui = await demanderConfirmation(
      context,
      question: 'Demander ${pack.quantite} jetons pour ${pack.prix} ?',
      precision: "L'équipe ajoutera les jetons à votre solde une fois le paiement reçu. "
          "Une demande envoyée ne s'annule pas depuis votre compte.",
      action: 'Demander',
    );
    if (!oui || !mounted) return;
    setState(() => _envoi = true);

    String message;
    try {
      message = (await widget.api.demanderPack(pack.quantite)).texte;
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      message = erreur.message;
    }

    if (!mounted) return;
    await _charger();
    if (!mounted) return;
    setState(() => _envoi = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mes jetons'),
        actions: [
          IconButton(tooltip: 'Actualiser', onPressed: _charger, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _charger,
        child: ListView(
          padding: const EdgeInsets.all(16),
          physics: const AlwaysScrollableScrollPhysics(),
          children: _contenu(context),
        ),
      ),
    );
  }

  List<Widget> _contenu(BuildContext context) {
    final jetons = _jetons;
    final erreur = _erreur;

    if (jetons == null) {
      return [
        if (erreur != null)
          Avertissement(texte: erreur)
        else
          const Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
      ];
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final perdus = jetons.perdusMaintenant;
    final valeurJeton = jetons.valeurJeton;

    return [
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      if (perdus != null) ...[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Pastille(texte: 'Jetons offerts expirés', fond: Couleurs.trait, couleur: Couleurs.encreDouce),
                const SizedBox(height: 8),
                Text(
                  'Vos $perdus jetons offerts ne sont plus utilisables : le délai est passé.',
                  style: texte.bodyLarge?.copyWith(color: Couleurs.encre),
                ),
                const SizedBox(height: 4),
                Text("Les jetons que vous achetez, eux, n'ont pas de date limite.", style: aide),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
      ],
      _CarteUsage(jetons: jetons),
      const SizedBox(height: 16),
      _CarteSolde(jetons: jetons),
      const SizedBox(height: 8),
      const TitreSection('Acheter des jetons'),
      // Aucun prix invente : si le reglage manque, on le dit.
      if (valeurJeton == null || jetons.packs.isEmpty) ...[
        Text("Aucun pack n'est en vente pour le moment.", style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 4),
        Text("Les prix n'ont pas encore été réglés par l'équipe.", style: aide),
      ] else ...[
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Un jeton vaut '),
              TextSpan(text: valeurJeton, style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre)),
              const TextSpan(text: '.'),
            ],
          ),
          style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
        ),
        const SizedBox(height: 12),
        if (jetons.demandeEnCours)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Pastille(texte: 'Demande en cours', fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
                  const SizedBox(height: 8),
                  Text(
                    "Une demande attend la confirmation de l'équipe. Vous pourrez en envoyer une autre "
                    'une fois celle-ci traitée.',
                    style: aide,
                  ),
                ],
              ),
            ),
          )
        else
          for (final pack in jetons.packs)
            _CartePack(pack: pack, uneAction: jetons.uneAction, envoi: _envoi, auDemander: _demander),
        const SizedBox(height: 4),
        const _CartePaiement(),
      ],
      const SizedBox(height: 8),
      const TitreSection("Vos demandes d'achat"),
      if (jetons.achats.isEmpty)
        Text('Aucune demande pour le moment.', style: gris)
      else
        for (final achat in jetons.achats) _CarteAchat(achat: achat),
      const SizedBox(height: 8),
      const TitreSection('Vos mouvements'),
      if (jetons.mouvements.isEmpty)
        Text('Aucun mouvement pour le moment.', style: gris)
      else
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Column(
              children: [
                for (final mouvement in jetons.mouvements) _LigneMouvement(mouvement: mouvement),
              ],
            ),
          ),
        ),
    ];
  }
}

/// "A quoi servent les jetons" : ce que ca coute, ce que le solde permet, et
/// ce qu'un jeton n'est pas.
class _CarteUsage extends StatelessWidget {
  const _CarteUsage({required this.jetons});

  final MesJetons jetons;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final paragraphe = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const gras = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final cout = jetons.cout;
    final permet = jetons.permet;
    final manque = jetons.manque;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'À quoi servent les jetons',
            style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text.rich(
            TextSpan(
              children: [
                if (jetons.jeSuisEmployeur) ...[
                  const TextSpan(text: 'Mettre une demande en avant', style: gras),
                  if (cout != null) ...[
                    const TextSpan(text: ' coûte '),
                    TextSpan(text: cout, style: gras),
                  ],
                  const TextSpan(text: ', depuis vos demandes'),
                ] else ...[
                  const TextSpan(text: 'Mettre votre profil en avant', style: gras),
                  if (cout != null) ...[
                    const TextSpan(text: ' coûte '),
                    TextSpan(text: cout, style: gras),
                  ],
                  const TextSpan(text: ', depuis votre profil'),
                ],
                const TextSpan(text: '.'),
                if (permet != null) ...[
                  const TextSpan(text: ' Votre solde vous permet de '),
                  TextSpan(text: permet, style: gras),
                  const TextSpan(text: '.'),
                ] else if (manque != null) ...[
                  const TextSpan(text: ' Il vous manque '),
                  TextSpan(text: manque, style: gras),
                  const TextSpan(text: '.'),
                ],
              ],
            ),
            style: paragraphe,
          ),
          if (!jetons.jeSuisEmployeur) ...[
            // CE QUE LES JETONS N'ACHETENT PAS. Repondre est gratuit, et
            // la place dans la recherche d'un employeur ne se paie pas.
            const SizedBox(height: 8),
            Text.rich(
              const TextSpan(
                children: [
                  TextSpan(text: 'Répondre à une demande est gratuit.', style: gras),
                  TextSpan(
                    text: " La mise en avant vous fait appeler en premier par l'équipe ; elle ne "
                        'change rien à votre place dans la recherche.',
                  ),
                ],
              ),
              style: aide,
            ),
          ],
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(text: 'Un jeton '),
                TextSpan(text: "n'est pas de l'argent", style: gras),
                TextSpan(
                  text: ' : il ne se donne pas, il ne se retire pas, et il ne paie jamais une prestation. '
                      'Pour cela, voir Mon compte.',
                ),
              ],
            ),
            style: aide,
          ),
        ],
      ),
    );
  }
}

/// Le solde, en deux parts : les melanger cacherait ce qui va expirer.
class _CarteSolde extends StatelessWidget {
  const _CarteSolde({required this.jetons});

  final MesJetons jetons;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final petit = texte.bodySmall?.copyWith(color: Couleurs.encrePale);
    final expireLe = jetons.expireLe;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Le meme cadre que sur le site : le solde en gras et en noir, les
            // deux parts en dessous.
            DetailMontants(
              lignes: [LigneTarif(libelle: 'Votre solde', montant: jetons.soldeTotal, retenue: false, total: true)],
              suite: [
                if (jetons.offerts > 0)
                  _LigneSolde(
                    libelle: 'Jetons offerts',
                    precision: expireLe == null
                        ? 'Offerts à la vérification de votre compte'
                        : 'Offerts à la vérification de votre compte, à utiliser avant le $expireLe',
                    nombre: jetons.offerts,
                    style: petit,
                  ),
                if (jetons.achetes > 0)
                  _LigneSolde(
                    libelle: 'Jetons achetés',
                    precision: 'Sans date limite',
                    nombre: jetons.achetes,
                    style: petit,
                  ),
              ],
            ),
            if (jetons.soldeVide) ...[
              const SizedBox(height: 12),
              // Une personne non verifiee n'a rien a acheter tout de suite :
              // des jetons l'attendent.
              if (jetons.verificationAFaire)
                Text.rich(
                  const TextSpan(
                    children: [
                      TextSpan(text: "Vous n'avez pas encore de jetons. Des jetons vous seront "),
                      TextSpan(text: 'offerts', style: TextStyle(fontWeight: FontWeight.w600)),
                      TextSpan(text: ' dès que votre identité aura été vérifiée.'),
                    ],
                  ),
                  style: aide,
                )
              else
                Text("Vous n'avez pas encore de jetons. Choisissez un pack ci-dessous.", style: aide),
            ],
          ],
        ),
      ),
    );
  }
}

class _LigneSolde extends StatelessWidget {
  const _LigneSolde({required this.libelle, required this.precision, required this.nombre, this.style});

  final String libelle;
  final String precision;
  final int nombre;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final encre = Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(libelle, style: encre),
                Text(precision, style: style),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text('$nombre', style: encre),
        ],
      ),
    );
  }
}

class _CartePack extends StatelessWidget {
  const _CartePack({required this.pack, required this.uneAction, required this.envoi, required this.auDemander});

  final PackJetons pack;
  final String uneAction;
  final bool envoi;
  final void Function(PackJetons) auDemander;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final apres = pack.apres;
    final dequoi = pack.dequoi;
    final manqueEncore = pack.manqueEncore;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${pack.quantite} jetons',
                style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              DetailMontants(
                lignes: [LigneTarif(libelle: 'Prix', montant: pack.prix, retenue: false, total: true)],
              ),
              // LE TOTAL APRES ACHAT, et pas seulement ce que le pack apporte.
              if (apres != null && dequoi != null)
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'Après cet achat : '),
                      TextSpan(text: '$apres jetons', style: fort),
                      TextSpan(text: ', de quoi $dequoi.'),
                    ],
                  ),
                  style: aide,
                )
              else if (apres != null && manqueEncore != null)
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'Après cet achat : '),
                      TextSpan(text: '$apres jetons', style: fort),
                      const TextSpan(text: '. Il vous en manquera encore '),
                      TextSpan(text: '$manqueEncore', style: fort),
                      TextSpan(text: ' pour $uneAction.'),
                    ],
                  ),
                  style: aide,
                ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: envoi ? null : () => auDemander(pack),
                icon: const Icon(Icons.toll_outlined),
                label: const Text('Demander ce pack'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Comment se passe le paiement" : la simulation, dite simplement.
class _CartePaiement extends StatelessWidget {
  const _CartePaiement();

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Comment se passe le paiement',
            style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            "Vous demandez un pack ici, et l'équipe ajoute les jetons à votre solde.",
            style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
          ),
          const SizedBox(height: 8),
          Text(
            "PamConnect n'encaisse aucun paiement pour l'instant : chaque demande est confirmée à la "
            "main par l'équipe.",
            style: texte.bodySmall?.copyWith(color: Couleurs.encrePale),
          ),
        ],
      ),
    );
  }
}

class _CarteAchat extends StatelessWidget {
  const _CarteAchat({required this.achat});

  final AchatJetons achat;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final motif = achat.motifRefus;
    final pastille = switch (achat.etat) {
      'en attente' => Pastille(texte: achat.libelleEtat, fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
      'confirme' => Pastille(
          texte: achat.libelleEtat,
          icone: Icons.check,
          fond: Couleurs.vertFond,
          couleur: Couleurs.vert,
        ),
      _ => Pastille(texte: achat.libelleEtat, fond: Couleurs.rougeFond, couleur: Couleurs.rouge),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${achat.quantite} jetons',
                style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              pastille,
              LigneDetail(icone: Icons.payments_outlined, texte: achat.montant),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Demandé le ${achat.demandeLe}'),
              if (motif != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text('Motif : $motif', style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LigneMouvement extends StatelessWidget {
  const _LigneMouvement({required this.mouvement});

  final MouvementJetons mouvement;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(mouvement.libelle, style: texte.bodyMedium?.copyWith(color: Couleurs.encre)),
                Text(mouvement.date, style: texte.bodySmall?.copyWith(color: Couleurs.encrePale)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            mouvement.quantite,
            style: mouvement.retrait ? gris : const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
          ),
        ],
      ),
    );
  }
}
