import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_demandes.dart';
import 'ecran_mes_demandes.dart';
import 'ecran_messages.dart';
import 'ecran_mon_profil.dart';
import 'modeles.dart';

/// L'application une fois connecte : une barre de menu en bas, comme le
/// menu du site.
///
/// CHAQUE ROLE A SES ENTREES, et seulement les siennes : l'employeur a
/// Mes demandes, la personne qui repond a Les demandes ; Messages et Mon
/// profil sont communs aux deux. Une entree n'apparait qu'une fois son ecran construit.
class EcranPrincipal extends StatefulWidget {
  const EcranPrincipal({super.key, required this.api, required this.moi});

  final ApiPamConnect api;
  final Moi moi;

  @override
  State<EcranPrincipal> createState() => _EcranPrincipalState();
}

class _EcranPrincipalState extends State<EcranPrincipal> {
  int _onglet = 0;

  /// Les messages non lus et les decisions pas encore vues, comptes par le
  /// serveur comme la pastille du menu du site.
  late int _aVoir = widget.moi.aVoir;

  /// Un message de l'equipe ou un avertissement pas encore lu, compte comme
  /// la pastille de Mon profil sur le site.
  late int _aLire = widget.moi.aLire;

  /// Change a chaque retour sur un onglet : son ecran se recharge.
  final List<int> _rafraichir = [0, 0, 0];

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
    final employeur = moi.publieDesDemandes;

    final premier = employeur
        ? EcranMesDemandes(api: api, moi: moi, rafraichir: _rafraichir[0], auMoi: _majMoi)
        : EcranDemandes(api: api, moi: moi, rafraichir: _rafraichir[0], auMoi: _majMoi);

    return Scaffold(
      body: IndexedStack(
        index: _onglet,
        children: [
          premier,
          EcranMessages(api: api, rafraichir: _rafraichir[1], auCompte: _majCompte),
          EcranMonProfil(
            api: api,
            rafraichir: _rafraichir[2],
            auALire: _majALire,
            auDonnerAvis: () => _choisirOnglet(1),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _onglet,
        onDestinationSelected: _choisirOnglet,
        destinations: [
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
