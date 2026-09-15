import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_demandes.dart';
import 'ecran_mes_demandes.dart';
import 'ecran_messages.dart';
import 'ecran_mon_profil.dart';
import 'ecran_rechercher.dart';
import 'modeles.dart';

/// L'application une fois connecte : une barre de menu en bas, comme le
/// menu du site.
///
/// CHAQUE ROLE A SES ENTREES, et seulement les siennes, dans l'ordre du site :
/// l'employeur a Rechercher et Mes demandes, la personne qui repond a Les
/// demandes ; Messages et Mon profil sont communs aux deux. Une entree
/// n'apparait qu'une fois son ecran construit.
class EcranPrincipal extends StatefulWidget {
  const EcranPrincipal({super.key, required this.api, required this.moi});

  final ApiPamConnect api;
  final Moi moi;

  @override
  State<EcranPrincipal> createState() => _EcranPrincipalState();
}

class _EcranPrincipalState extends State<EcranPrincipal> {
  bool get _employeur => widget.moi.publieDesDemandes;

  // La place de chaque entree dans la barre : Rechercher n'existe que pour
  // l'employeur, et decale les suivantes.
  int get _indexRechercher => 0;
  int get _indexTravail => _employeur ? 1 : 0;
  int get _indexMessages => _indexTravail + 1;
  int get _indexProfil => _indexTravail + 2;

  /// L'application s'ouvre sur ce sur quoi chacun travaille : Mes demandes
  /// pour l'employeur, Les demandes pour la personne qui repond.
  late int _onglet = _indexTravail;

  /// Les messages non lus et les decisions pas encore vues, comptes par le
  /// serveur comme la pastille du menu du site.
  late int _aVoir = widget.moi.aVoir;

  /// Un message de l'equipe ou un avertissement pas encore lu, compte comme
  /// la pastille de Mon profil sur le site.
  late int _aLire = widget.moi.aLire;

  /// Change a chaque retour sur un onglet : son ecran se recharge.
  late final List<int> _rafraichir = List<int>.filled(_indexProfil + 1, 0);

  void _majCompte(int aVoir) {
    if (!mounted || aVoir == _aVoir) return;
    setState(() => _aVoir = aVoir);
  }

  void _majALire(int aLire) {
    if (!mounted || aLire == _aLire) return;
    setState(() => _aLire = aLire);
  }

  void _majMoi(Moi moi) {
    _majCompte(moi.aVoir);
    _majALire(moi.aLire);
  }

  void _choisirOnglet(int onglet) {
    setState(() {
      _rafraichir[onglet]++;
      _onglet = onglet;
    });
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.api;
    final moi = widget.moi;
    final employeur = _employeur;

    return Scaffold(
      body: IndexedStack(
        index: _onglet,
        children: [
          if (employeur) EcranRechercher(api: api, rafraichir: _rafraichir[_indexRechercher]),
          employeur
              ? EcranMesDemandes(api: api, moi: moi, rafraichir: _rafraichir[_indexTravail], auMoi: _majMoi)
              : EcranDemandes(api: api, moi: moi, rafraichir: _rafraichir[_indexTravail], auMoi: _majMoi),
          EcranMessages(api: api, rafraichir: _rafraichir[_indexMessages], auCompte: _majCompte),
          EcranMonProfil(
            api: api,
            rafraichir: _rafraichir[_indexProfil],
            auALire: _majALire,
            auDonnerAvis: () => _choisirOnglet(_indexMessages),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _onglet,
        onDestinationSelected: _choisirOnglet,
        destinations: [
          if (employeur)
            const NavigationDestination(
              icon: Icon(Icons.search),
              label: 'Rechercher',
            ),
          employeur
              ? const NavigationDestination(
                  icon: Icon(Icons.description_outlined),
                  selectedIcon: Icon(Icons.description),
                  label: 'Mes demandes',
                )
              : const NavigationDestination(
                  icon: Icon(Icons.list_alt_outlined),
                  selectedIcon: Icon(Icons.list_alt),
                  label: 'Demandes',
                ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _aVoir > 0,
              label: Text('$_aVoir'),
              child: const Icon(Icons.chat_bubble_outline),
            ),
            selectedIcon: Badge(
              isLabelVisible: _aVoir > 0,
              label: Text('$_aVoir'),
              child: const Icon(Icons.chat_bubble),
            ),
            label: 'Messages',
            tooltip: _aVoir > 0 ? 'Messages, $_aVoir nouveauté${_aVoir > 1 ? 's' : ''}' : 'Messages',
          ),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _aLire > 0,
              label: Text('$_aLire'),
              child: const Icon(Icons.person_outline),
            ),
            selectedIcon: Badge(
              isLabelVisible: _aLire > 0,
              label: Text('$_aLire'),
              child: const Icon(Icons.person),
            ),
            label: 'Mon profil',
            tooltip: _aLire > 0 ? 'Mon profil, $_aLire à lire' : 'Mon profil',
          ),
        ],
      ),
    );
  }
}
