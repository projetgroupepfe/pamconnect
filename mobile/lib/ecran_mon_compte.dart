import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mon compte : ce que l'argent est devenu. Pour l'employeur, les sommes
/// qu'il a posees ; pour la personne qui repond, ce qu'elle a recu.
///
/// Aucun numero Mobile Money ni compte bancaire : la plateforme n'en
/// demande pas, et les montants sont simules.
class EcranMonCompte extends StatefulWidget {
  const EcranMonCompte({super.key, required this.api});

  final ApiPamConnect api;

  @override
  State<EcranMonCompte> createState() => _EcranMonCompteState();
}

class _EcranMonCompteState extends State<EcranMonCompte> {
  MonCompte? _compte;
  String? _erreur;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final compte = await widget.api.monCompte();
      if (!mounted) return;
      setState(() {
        _compte = compte;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mon compte'),
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
    final compte = _compte;
    final erreur = _erreur;

    if (compte == null) {
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

    return [
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      // CE QUE CETTE PAGE N'EST PAS : un portefeuille. Le solde est un
      // montant du, et les montants sont simules.
      const _CarteCirculation(),
      const SizedBox(height: 8),
      if (compte.jeSuisEmployeur) ..._versementsEnvoyes(context, compte) else ..._versementsRecus(context, compte),
    ];
  }

  List<Widget> _versementsEnvoyes(BuildContext context, MonCompte compte) {
    final texte = Theme.of(context).textTheme;
    return [
      const TitreSection('Vos versements'),
      if (compte.envoyes.isEmpty) ...[
        Text('Aucun versement pour le moment.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 4),
        Text(
          'Une somme est bloquée dès que vous publiez une demande.',
          style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale),
        ),
      ] else
        for (final versement in compte.envoyes) _CarteVersementEnvoye(versement: versement),
    ];
  }

  List<Widget> _versementsRecus(BuildContext context, MonCompte compte) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final total = compte.totalRecu;

    return [
      const TitreSection('Ce que vous avez reçu'),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (total != null)
                DetailMontants(
                  lignes: [LigneTarif(libelle: 'Total reçu', montant: total, retenue: false, total: true)],
                ),
              const SizedBox(height: 8),
              Text.rich(
                const TextSpan(
                  children: [
                    TextSpan(
                      text: 'Ce montant est la somme de vos services terminés, commission déduite. '
                          'Le transfert vers votre propre compte se fait ',
                    ),
                    TextSpan(text: 'en dehors de PamConnect', style: TextStyle(fontWeight: FontWeight.w600)),
                    TextSpan(text: ' : la plateforme ne demande ni numéro Mobile Money, ni compte bancaire.'),
                  ],
                ),
                style: aide,
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      if (compte.recus.isEmpty) ...[
        Text('Aucun versement pour le moment.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 4),
        Text(
          "Vous recevez la somme d'une demande lorsque l'employeur déclare le service effectué.",
          style: aide,
        ),
      ] else
        for (final versement in compte.recus) _CarteVersementRecu(versement: versement),
    ];
  }
}

/// "Comment l'argent circule sur PamConnect", le texte du site.
class _CarteCirculation extends StatelessWidget {
  const _CarteCirculation();

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    const gras = TextStyle(fontWeight: FontWeight.w600);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            "Comment l'argent circule sur PamConnect",
            style: texte.titleSmall?.copyWith(color: Couleurs.bleuFonce, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(text: "Quand un employeur publie une demande, la somme qu'il annonce est "),
                TextSpan(text: 'bloquée par PamConnect', style: gras),
                TextSpan(
                  text: ". Elle ne repart qu'à la fin : chez la personne qui a travaillé une fois le "
                      "service déclaré effectué, ou chez l'employeur s'il retire sa demande sans avoir "
                      'choisi personne.',
                ),
              ],
            ),
            style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(text: 'Les montants affichés ici sont '),
                TextSpan(text: 'simulés', style: gras),
                TextSpan(
                  text: " : aucun argent réel ne circule encore. Encaisser puis reverser une somme est "
                      "une activité d'intermédiaire financier, qui suppose un agrément et un contrat "
                      'avec les opérateurs.',
                ),
              ],
            ),
            style: texte.bodySmall?.copyWith(color: Couleurs.encrePale),
          ),
        ],
      ),
    );
  }
}

class _CarteVersementEnvoye extends StatelessWidget {
  const _CarteVersementEnvoye({required this.versement});

  final VersementEnvoye versement;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final denoue = versement.denoue;
    // La couleur suit l'etat : le vert pour ce qui est verse, l'ambre pour
    // ce qui attend, comme sur le site.
    final pastille = switch (versement.etat) {
      'bloque' => Pastille(texte: versement.libelleEtat, fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
      'rembourse' => Pastille(texte: versement.libelleEtat, fond: Couleurs.trait, couleur: Couleurs.encreDouce),
      _ => Pastille(
          texte: versement.libelleEtat,
          icone: Icons.check,
          fond: Couleurs.vertFond,
          couleur: Couleurs.vert,
        ),
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
                versement.titreDemande,
                style: texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              pastille,
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    const Icon(Icons.payments_outlined, size: 18, color: Couleurs.encreDouce),
                    const SizedBox(width: 8),
                    Text(
                      versement.montant,
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                    ),
                  ],
                ),
              ),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Bloqué le ${versement.bloqueLe}'),
              if (denoue != null) LigneDetail(icone: Icons.check, texte: denoue),
              // L'OBLIGATION, ecrite la ou la somme est encore bloquee.
              if (versement.rappelDeclaration) ...[
                const SizedBox(height: 12),
                Text.rich(
                  const TextSpan(
                    children: [
                      TextSpan(
                        text: 'Après chaque service effectué, déclarez-le à PamConnect.',
                        style: TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                      ),
                      TextSpan(
                        text: " C'est ce qui déclenche le versement. Sans cette déclaration, la personne "
                            "qui a travaillé n'est pas payée, et un désaccord s'ouvre pour rien.",
                      ),
                    ],
                  ),
                  style: aide,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CarteVersementRecu extends StatelessWidget {
  const _CarteVersementRecu({required this.versement});

  final VersementRecu versement;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                versement.titreDemande,
                style: texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
              ),
              Text('Chez ${versement.chez}', style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce)),
              const SizedBox(height: 8),
              DetailMontants(lignes: versement.lignes),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Versé le ${versement.verseLe}'),
            ],
          ),
        ),
      ),
    );
  }
}
