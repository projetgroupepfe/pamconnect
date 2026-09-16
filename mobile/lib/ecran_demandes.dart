import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_repondre.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Les demandes ouvertes, comme la page Demandes disponibles du site, dans
/// l'ordre que le serveur a decide : celles du metier de la personne
/// d'abord, les autres ensuite.
class EcranDemandes extends StatefulWidget {
  const EcranDemandes({super.key, required this.api, required this.moi, this.rafraichir = 0, this.auMoi});

  final ApiPamConnect api;
  final Moi moi;

  /// Change quand l'onglet est rouvert : l'ecran se recharge.
  final int rafraichir;

  /// Donne la personne a jour a la barre de menu, pour sa pastille.
  final void Function(Moi moi)? auMoi;

  @override
  State<EcranDemandes> createState() => _EcranDemandesState();
}

class _EcranDemandesState extends State<EcranDemandes> {
  late Moi _moi = widget.moi;
  ListeDemandes? _liste;
  String? _erreur;
  bool _enCours = true;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void didUpdateWidget(EcranDemandes ancien) {
    super.didUpdateWidget(ancien);
    if (ancien.rafraichir != widget.rafraichir) _actualiser();
  }

  Future<void> _actualiser() async {
    setState(() {
      _enCours = true;
      _erreur = null;
    });
    await _charger();
  }

  Future<void> _charger() async {
    try {
      // /api/moi d'abord : la liste des demandes est publique et repondrait
      // meme sans session. C'est /api/moi qui revele une session perdue, et
      // qui remet le solde de jetons a jour.
      final moi = await widget.api.moi();
      final liste = await widget.api.demandes();
      if (!mounted) return;
      setState(() {
        _moi = moi;
        _liste = liste;
        _erreur = null;
        _enCours = false;
      });
      widget.auMoi?.call(moi);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      if (erreur.refus) {
        revenirALaConnexion(context, widget.api, erreur.message);
        return;
      }
      setState(() {
        _erreur = erreur.message;
        _enCours = false;
      });
    }
  }

  Future<void> _repondre(Demande demande) async {
    final texte = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => EcranRepondre(api: widget.api, demandeId: demande.id)),
    );
    if (!mounted) return;
    // Le solde de jetons a pu changer : l'en-tete se recharge aussi.
    await _actualiser();
    if (!mounted || texte == null) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(texte)));
  }

  Future<void> _seDeconnecter() async {
    await widget.api.deconnexion();
    if (!mounted) return;
    revenirALaConnexion(context, widget.api);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Demandes disponibles'),
        actions: [
          IconButton(
            tooltip: 'Actualiser',
            onPressed: _enCours ? null : _actualiser,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Se déconnecter',
            onPressed: _seDeconnecter,
            icon: const Icon(Icons.logout),
          ),
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
    final liste = _liste;
    final erreur = _erreur;
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyLarge?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final monMetier = liste?.monMetier;

    return [
      EnTetePersonne(moi: _moi),
      const SizedBox(height: 12),
      Text('Les demandes publiées par les employeurs de Yaoundé.', style: gris),
      const SizedBox(height: 16),
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      if (liste == null && _enCours)
        const Padding(
          padding: EdgeInsets.all(32),
          child: Center(child: CircularProgressIndicator()),
        ),
      if (liste != null && liste.vide)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 32),
          child: Text('Aucune demande pour le moment.', textAlign: TextAlign.center, style: gris),
        ),
      if (liste != null && !liste.vide) ...[
        // EN PREMIER : les demandes qu'un employeur a publiees pour elle.
        if (liste.proposees.isNotEmpty) ...[
          const TitreSection('Demandes qui vous sont proposées'),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              '${liste.proposees.length == 1 ? 'Un employeur a publié cette demande pour vous.' : 'Des employeurs ont publié ces demandes pour vous.'} '
              'Y répondre ne vous coûte aucun jeton.',
              style: aide,
            ),
          ),
          for (final demande in liste.proposees) _CarteDemande(demande: demande, auRepondre: _repondre),
        ],
        // Les demandes de son metier passent devant, sans masquer les autres :
        // rien n'empeche une aide-menagere de garder des enfants.
        if (monMetier != null) ...[
          TitreSection('Pour vous : $monMetier'),
          if (liste.pourMoi.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text('Aucune demande de $monMetier pour le moment.', style: gris),
            ),
          for (final demande in liste.pourMoi) _CarteDemande(demande: demande, auRepondre: _repondre),
          if (liste.autres.isNotEmpty) ...[
            const TitreSection('Les autres demandes'),
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                "Elles ne correspondent pas à ce que vous avez indiqué, mais rien ne vous empêche d'y répondre.",
                style: aide,
              ),
            ),
          ],
        ],
        for (final demande in liste.autres) _CarteDemande(demande: demande, auRepondre: _repondre),
      ],
    ];
  }
}

/// Une demande, comme la carte du site : le titre, le badge s'il a ete
/// paye, puis le metier, l'horaire, le prix, ce qu'il faut savoir et le lieu.
class _CarteDemande extends StatelessWidget {
  const _CarteDemande({required this.demande, required this.auRepondre});

  final Demande demande;
  final void Function(Demande) auRepondre;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final metier = demande.metier;
    final prix = demande.prixLisible;
    final duree = demande.dureeEstimee;
    final conditions = demande.conditions;
    final quartier = demande.quartier;
    final arrondissement = demande.arrondissement;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                demande.titre,
                style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
              ),
              // LE BADGE EST OBLIGATOIRE, pas decoratif : une demande qui passe
              // devant parce que son auteur a paye doit le dire.
              if (demande.misEnAvant) ...[
                const SizedBox(height: 6),
                const Align(alignment: Alignment.centerLeft, child: Pastille(texte: 'Mise en avant')),
              ],
              if (metier != null) LigneRiche(icone: Icons.work_outline, morceaux: [TextSpan(text: metier, style: fort)]),
              LigneRiche(
                icone: Icons.calendar_today_outlined,
                morceaux: [TextSpan(text: demande.horaire ?? 'Horaire non précisé', style: fort)],
              ),
              if (prix != null)
                LigneRiche(
                  icone: Icons.payments_outlined,
                  morceaux: [
                    TextSpan(text: prix, style: fort),
                    if (duree != null) TextSpan(text: '  $duree', style: aide),
                  ],
                ),
              if (conditions != null) LigneRiche(icone: Icons.info_outline, morceaux: [TextSpan(text: conditions)]),
              if (quartier != null || arrondissement != null)
                LigneRiche(
                  icone: Icons.place_outlined,
                  morceaux: [
                    if (quartier != null) TextSpan(text: quartier, style: fort),
                    if (quartier != null && arrondissement != null) const TextSpan(text: ', '),
                    if (arrondissement != null) TextSpan(text: arrondissement),
                  ],
                ),
              const SizedBox(height: 12),
              // La coche, comme le bouton du site.
              FilledButton.icon(
                onPressed: () => auRepondre(demande),
                icon: const Icon(Icons.check),
                label: const Text('Je suis disponible'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
