import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mon compte : ce que l'employeur doit payer apres un service, et ce que
/// la personne qui a travaille a recu.
///
/// Aucun numero Mobile Money ni compte bancaire : l'argent ne passe pas
/// par la plateforme, qui en garde seulement la trace.
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
      // CE QUE CETTE PAGE N'EST PAS : un portefeuille. C'est une trace.
      const _CarteCirculation(),
      const SizedBox(height: 8),
      if (compte.jeSuisEmployeur) ..._servicesAPayer(context, compte) else ..._servicesRecus(context, compte),
    ];
  }

  List<Widget> _servicesAPayer(BuildContext context, MonCompte compte) {
    final texte = Theme.of(context).textTheme;
    return [
      const TitreSection('Vos services'),
      if (compte.envoyes.isEmpty) ...[
        Text('Aucun service pour le moment.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 4),
        Text(
          "Un montant apparaît ici quand l'équipe vous a mis en relation.",
          style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale),
        ),
      ] else
        for (final service in compte.envoyes) _CarteServiceAPayer(service: service),
    ];
  }

  List<Widget> _servicesRecus(BuildContext context, MonCompte compte) {
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
                    TextSpan(text: 'Vous recevez '),
                    TextSpan(
                      text: 'exactement le prix que vous annoncez',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    TextSpan(
                      text: " à l'équipe : la commission s'ajoute par-dessus, elle ne vous est pas retirée.",
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
      if (compte.recus.isEmpty) ...[
        Text('Aucun service pour le moment.', style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce)),
        const SizedBox(height: 4),
        Text("L'équipe vous appelle quand un service vous est proposé.", style: aide),
      ] else
        for (final service in compte.recus) _CarteServiceRecu(service: service),
    ];
  }
}

/// "Comment l'argent circule", le texte du site.
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
            "Comment l'argent circule",
            style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(text: "Rien n'est payé à la publication. Après le service, l'employeur paie "),
                TextSpan(text: 'PamConnect', style: gras),
                TextSpan(text: ", qui reverse à la personne qui a travaillé."),
              ],
            ),
            style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
          ),
          const SizedBox(height: 8),
          Text(
            "Le paiement se fait à l'agence ou par Mobile Money, jamais sur la plateforme : "
            "elle en garde seulement la trace.",
            style: texte.bodySmall?.copyWith(color: Couleurs.encrePale),
          ),
        ],
      ),
    );
  }
}

class _CarteServiceAPayer extends StatelessWidget {
  const _CarteServiceAPayer({required this.service});

  final ServiceAPayer service;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final paye = service.paye;
    // La couleur suit l'etat : le vert pour ce qui est paye, l'ambre pour
    // ce qui attend, comme sur le site.
    final pastille = service.etat == 'paye'
        ? Pastille(
            texte: service.libelleEtat,
            icone: Icons.check,
            fond: Couleurs.vertFond,
            couleur: Couleurs.vert,
          )
        : Pastille(texte: service.libelleEtat, fond: Couleurs.ambreFond, couleur: Couleurs.ambre);

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                service.titreDemande,
                style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              Text('Avec ${service.avec}', style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce)),
              const SizedBox(height: 8),
              pastille,
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  children: [
                    const Icon(Icons.payments_outlined, size: 18, color: Couleurs.encreDouce),
                    const SizedBox(width: 8),
                    Text(
                      service.montant,
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                    ),
                  ],
                ),
              ),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: 'Convenu le ${service.convenuLe}'),
              if (paye != null) LigneDetail(icone: Icons.check, texte: paye),
              // L'OBLIGATION, ecrite la ou la somme est encore due.
              if (service.rappelPaiement) ...[
                const SizedBox(height: 12),
                Text.rich(
                  const TextSpan(
                    children: [
                      TextSpan(
                        text: 'Après le service, payez ce montant à PamConnect.',
                        style: TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                      ),
                      TextSpan(text: " L'équipe le reverse ensuite à la personne qui a travaillé."),
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

class _CarteServiceRecu extends StatelessWidget {
  const _CarteServiceRecu({required this.service});

  final ServiceRecu service;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final verseLe = service.verseLe;
    final moyen = service.moyen;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                service.titreDemande,
                style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              Text('Chez ${service.chez}', style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce)),
              const SizedBox(height: 8),
              service.reverse
                  ? Pastille(
                      texte: service.libelleEtat,
                      icone: Icons.check,
                      fond: Couleurs.vertFond,
                      couleur: Couleurs.vert,
                    )
                  : Pastille(texte: service.libelleEtat, fond: Couleurs.ambreFond, couleur: Couleurs.ambre),
              const SizedBox(height: 8),
              DetailMontants(lignes: service.lignes),
              if (verseLe != null)
                LigneDetail(
                  icone: Icons.calendar_today_outlined,
                  texte: 'Reversé le $verseLe${moyen != null ? ' ($moyen)' : ''}',
                ),
            ],
          ),
        ),
      ),
    );
  }
}
