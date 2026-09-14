import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Les demandes ouvertes, dans l'ordre que le serveur a decide : celles du
/// metier de la personne d'abord, les autres ensuite.
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

  Future<void> _seDeconnecter() async {
    await widget.api.deconnexion();
    if (!mounted) return;
    revenirALaConnexion(context, widget.api);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Les demandes'),
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
    // UN TITRE SERT A DISTINGUER, PAS A ETIQUETER : il n'apparait que si les
    // deux listes existent. Seul au-dessus d'une liste unique, il n'apprendrait
    // rien. C'est la regle deja appliquee sur le site.
    final deuxListes = liste != null && liste.pourMoi.isNotEmpty && liste.autres.isNotEmpty;

    return [
      EnTetePersonne(moi: _moi),
      const SizedBox(height: 16),
      if (_erreur != null) ...[
        Avertissement(texte: _erreur!),
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
          child: Text(
            'Aucune demande ouverte pour le moment.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encreDouce),
          ),
        ),
      if (liste != null) ...[
        if (deuxListes) const TitreSection('Pour votre métier'),
        for (final demande in liste.pourMoi) _CarteDemande(demande: demande),
        if (deuxListes) const TitreSection('Les autres demandes'),
        for (final demande in liste.autres) _CarteDemande(demande: demande),
      ],
    ];
  }
}

class _CarteDemande extends StatelessWidget {
  const _CarteDemande({required this.demande});

  final Demande demande;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final lieu = demande.lieu;
    final horaire = demande.horaire;
    final prix = demande.prixLisible;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (demande.misEnAvant) ...[
                const Pastille(texte: 'Mise en avant'),
                const SizedBox(height: 8),
              ],
              Text(
                demande.titre,
                style: texte.titleMedium?.copyWith(
                  color: Couleurs.encre,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (prix != null) ...[
                const SizedBox(height: 6),
                Text(
                  prix,
                  style: texte.bodyLarge?.copyWith(
                    color: Couleurs.orangeFonce,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              if (horaire != null) LigneDetail(icone: Icons.schedule, texte: horaire),
            ],
          ),
        ),
      ),
    );
  }
}
