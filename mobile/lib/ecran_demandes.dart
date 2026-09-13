import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
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

/// Les demandes ouvertes, dans l'ordre que le serveur a decide : celles du
/// metier de la personne d'abord, les autres ensuite.
class EcranDemandes extends StatefulWidget {
  const EcranDemandes({super.key, required this.api, required this.moi});

  final ApiPamConnect api;
  final Moi moi;

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
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        _revenirALaConnexion("Votre session n'est plus valable, par exemple après "
            'un redémarrage du serveur. Reconnectez-vous.');
        return;
      }
      if (erreur.refus) {
        _revenirALaConnexion(erreur.message);
        return;
      }
      setState(() {
        _erreur = erreur.message;
        _enCours = false;
      });
    }
  }

  void _revenirALaConnexion(String? message) {
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => EcranConnexion(adresseInitiale: widget.api.racine, message: message),
      ),
    );
  }

  Future<void> _seDeconnecter() async {
    await widget.api.deconnexion();
    if (!mounted) return;
    _revenirALaConnexion(null);
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
      _EnTete(moi: _moi),
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
        if (deuxListes) const _Titre('Pour votre métier'),
        for (final demande in liste.pourMoi) _CarteDemande(demande: demande),
        if (deuxListes) const _Titre('Les autres demandes'),
        for (final demande in liste.autres) _CarteDemande(demande: demande),
      ],
    ];
  }
}

class _EnTete extends StatelessWidget {
  const _EnTete({required this.moi});

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

class _Titre extends StatelessWidget {
  const _Titre(this.texte);

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
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: Couleurs.bleuClair,
                    borderRadius: BorderRadius.circular(rayon),
                  ),
                  child: Text(
                    'Mise en avant',
                    style: texte.labelMedium?.copyWith(
                      color: Couleurs.bleuFonce,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
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
              if (lieu != null) _Detail(icone: Icons.place_outlined, texte: lieu),
              if (horaire != null) _Detail(icone: Icons.schedule, texte: horaire),
            ],
          ),
        ),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.icone, required this.texte});

  final IconData icone;
  final String texte;

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
            child: Text(
              texte,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encreDouce),
            ),
          ),
        ],
      ),
    );
  }
}
