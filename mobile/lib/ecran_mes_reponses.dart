import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'ecran_discussion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mes reponses : les demandes auxquelles la personne a repondu, et ou elles
/// en sont. Le pendant de Mes demandes, du cote de celle qui travaille. Les
/// phrases viennent du serveur.
class EcranMesReponses extends StatefulWidget {
  const EcranMesReponses({super.key, required this.api, this.rafraichir = 0, this.auVoirDemandes});

  final ApiPamConnect api;

  /// Change quand l'onglet est rouvert : la liste se recharge.
  final int rafraichir;

  /// Mene a l'onglet Demandes, quand aucune reponse n'est encore partie.
  final VoidCallback? auVoirDemandes;

  @override
  State<EcranMesReponses> createState() => _EcranMesReponsesState();
}

class _EcranMesReponsesState extends State<EcranMesReponses> {
  MesReponses? _liste;
  String? _erreur;
  bool _enCours = true;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void didUpdateWidget(EcranMesReponses ancien) {
    super.didUpdateWidget(ancien);
    if (ancien.rafraichir != widget.rafraichir) _charger();
  }

  Future<void> _charger() async {
    try {
      final liste = await widget.api.mesReponses();
      if (!mounted) return;
      setState(() {
        _liste = liste;
        _erreur = null;
        _enCours = false;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _erreur = erreur.message;
        _enCours = false;
      });
    }
  }

  Future<void> _ouvrir(MaReponse reponse) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => EcranDiscussion(api: widget.api, discussionId: reponse.id)),
    );
    if (!mounted) return;
    await _charger();
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
        title: const Text('Mes réponses'),
        actions: [
          IconButton(tooltip: 'Actualiser', onPressed: _charger, icon: const Icon(Icons.refresh)),
          IconButton(tooltip: 'Se déconnecter', onPressed: _seDeconnecter, icon: const Icon(Icons.logout)),
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
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyLarge?.copyWith(color: Couleurs.encreDouce);
    const fort = TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre);
    final liste = _liste;
    final erreur = _erreur;

    return [
      Text('Les demandes auxquelles vous avez répondu, et où elles en sont.', style: gris),
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
      if (liste != null && liste.reponses.isEmpty) ...[
        const SizedBox(height: 16),
        Text("Vous n'avez répondu à aucune demande.", textAlign: TextAlign.center, style: gris),
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: widget.auVoirDemandes,
          icon: const Icon(Icons.insert_drive_file_outlined),
          label: const Text('Voir les demandes'),
        ),
      ],
      if (liste != null)
        for (final reponse in liste.reponses)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      reponse.titreDemande,
                      style: texte.titleMedium?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600),
                    ),
                    LigneRiche(icone: Icons.schedule, morceaux: [TextSpan(text: reponse.phrase, style: fort)]),
                    const SizedBox(height: 12),
                    OutlinedButton.icon(
                      onPressed: () => _ouvrir(reponse),
                      icon: const Icon(Icons.chat_bubble_outline),
                      label: const Text('Discuter'),
                      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    ),
                  ],
                ),
              ),
            ),
          ),
    ];
  }
}
