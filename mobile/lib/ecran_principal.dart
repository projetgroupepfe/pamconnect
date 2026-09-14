import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_demandes.dart';
import 'ecran_mes_demandes.dart';
import 'ecran_messages.dart';
import 'modeles.dart';

/// L'application une fois connecte : une barre de menu en bas, comme le
/// menu du site.
///
/// CHAQUE ROLE A SES ENTREES, et seulement les siennes : l'employeur a
/// Mes demandes, la personne qui repond a Les demandes ; Messages est
/// commun aux deux. Une entree n'apparait qu'une fois son ecran construit.
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

  /// Change a chaque retour sur un onglet : son ecran se recharge.
  final List<int> _rafraichir = [0, 0];

  void _majCompte(int aVoir) {
    if (!mounted || aVoir == _aVoir) return;
    setState(() => _aVoir = aVoir);
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
        ? EcranMesDemandes(api: api, moi: moi, rafraichir: _rafraichir[0], auMoi: (m) => _majCompte(m.aVoir))
        : EcranDemandes(api: api, moi: moi, rafraichir: _rafraichir[0], auMoi: (m) => _majCompte(m.aVoir));

    return Scaffold(
      body: IndexedStack(
        index: _onglet,
        children: [
          premier,
          EcranMessages(api: api, rafraichir: _rafraichir[1], auCompte: _majCompte),
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
        ],
      ),
    );
  }
}
