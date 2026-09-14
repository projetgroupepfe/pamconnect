import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_avis.dart';
import 'ecran_connexion.dart';
import 'ecran_discussion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Mes messages : la liste des discussions, la plus recente en premier,
/// comme sur le site. Les phrases viennent du serveur.
class EcranMessages extends StatefulWidget {
  const EcranMessages({super.key, required this.api, this.rafraichir = 0, this.auCompte});

  final ApiPamConnect api;

  /// Change quand l'onglet est rouvert : la liste se recharge.
  final int rafraichir;

  /// Donne le nombre de nouveautes a la barre de menu.
  final void Function(int aVoir)? auCompte;

  @override
  State<EcranMessages> createState() => _EcranMessagesState();
}

class _EcranMessagesState extends State<EcranMessages> {
  MesDiscussions? _liste;
  String? _erreur;
  bool _enCours = true;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void didUpdateWidget(EcranMessages ancien) {
    super.didUpdateWidget(ancien);
    if (ancien.rafraichir != widget.rafraichir) _charger();
  }

  Future<void> _charger() async {
    try {
      final liste = await widget.api.mesDiscussions();
      if (!mounted) return;
      setState(() {
        _liste = liste;
        _erreur = null;
        _enCours = false;
      });
      widget.auCompte?.call(liste.aVoir);
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

  Future<void> _ouvrir(ResumeDiscussion discussion) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => EcranDiscussion(api: widget.api, discussionId: discussion.id)),
    );
    if (!mounted) return;
    await _charger();
  }

  Future<void> _donnerAvis(ResumeDiscussion discussion) async {
    final texte = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => EcranAvis(api: widget.api, candidatureId: discussion.id)),
    );
    if (!mounted) return;
    await _charger();
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
        title: const Text('Mes messages'),
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
    final liste = _liste;
    final erreur = _erreur;
    final vide = liste?.vide;

    return [
      Text('Vos discussions, la plus récente en premier.', style: gris),
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
      if (liste != null && vide != null)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Column(
            children: [
              Text(vide.phrase, textAlign: TextAlign.center, style: gris),
              if (vide.aide != null) ...[
                const SizedBox(height: 8),
                Text(
                  vide.aide!,
                  textAlign: TextAlign.center,
                  style: texte.bodyMedium?.copyWith(color: Couleurs.encrePale),
                ),
              ],
            ],
          ),
        ),
      if (liste != null && vide == null) ...[
        if (liste.enCours.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text('Aucune discussion en cours.', style: gris),
          ),
        for (final discussion in liste.enCours)
          _CarteDiscussion(discussion: discussion, auOuvrir: _ouvrir, auAvis: _donnerAvis),
        if (liste.terminees.isNotEmpty) ...[
          const TitreSection('Services terminés'),
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text.rich(
              TextSpan(
                children: [
                  if (liste.chapeauTerminees.fort != null)
                    TextSpan(
                      text: '${liste.chapeauTerminees.fort} ',
                      style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
                    ),
                  TextSpan(text: liste.chapeauTerminees.suite),
                ],
              ),
              style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
            ),
          ),
          for (final discussion in liste.terminees)
            _CarteDiscussion(discussion: discussion, auOuvrir: _ouvrir, auAvis: _donnerAvis),
        ],
      ],
    ];
  }
}

class _CarteDiscussion extends StatelessWidget {
  const _CarteDiscussion({required this.discussion, required this.auOuvrir, required this.auAvis});

  final ResumeDiscussion discussion;
  final void Function(ResumeDiscussion) auOuvrir;
  final void Function(ResumeDiscussion) auAvis;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    const hauteurBouton = Size.fromHeight(48);
    final termineeLe = discussion.termineeLe;
    final phraseNonLus = discussion.phraseNonLus;
    final dernier = discussion.dernierMessage;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Couleurs.bleuClair,
                    foregroundColor: Couleurs.bleuFonce,
                    child: Text(discussion.avec.isEmpty ? '' : discussion.avec.characters.first),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          discussion.avec,
                          style: texte.titleSmall?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
                        ),
                        Text(discussion.titreDemande, style: gris),
                      ],
                    ),
                  ),
                ],
              ),
              if (termineeLe == null) ...[
                _LigneForte(
                  icone: Icons.schedule,
                  texte: discussion.phraseStatut,
                  marque: discussion.nouveau ? 'Nouveau' : null,
                ),
                // Ce qui attend d'etre lu passe avant le compte total.
                if (phraseNonLus != null) _LigneForte(icone: Icons.mark_chat_unread_outlined, texte: phraseNonLus),
                LigneDetail(
                  icone: Icons.chat_bubble_outline,
                  texte: discussion.phraseMessages,
                  aide: dernier == null ? null : 'dernier le $dernier',
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: () => auOuvrir(discussion),
                  icon: const Icon(Icons.chat_bubble_outline),
                  label: const Text('Ouvrir la discussion'),
                  style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
                ),
              ] else ...[
                LigneDetail(icone: Icons.task_alt, texte: 'Service effectué le', enGras: termineeLe),
                if (discussion.avisAttendu)
                  const _LigneForte(icone: Icons.star_border, texte: 'Votre avis est attendu'),
                LigneDetail(icone: Icons.chat_bubble_outline, texte: discussion.phraseMessages),
                const SizedBox(height: 12),
                // Le bouton, la ou l'on regarde : sans ouvrir la discussion.
                if (discussion.avisAttendu) ...[
                  FilledButton.icon(
                    onPressed: () => auAvis(discussion),
                    icon: const Icon(Icons.star_border),
                    label: const Text('Donner mon avis'),
                  ),
                  const SizedBox(height: 8),
                ],
                OutlinedButton.icon(
                  onPressed: () => auOuvrir(discussion),
                  icon: const Icon(Icons.description_outlined),
                  label: const Text('Relire la discussion'),
                  style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Une ligne en gras, avec parfois la marque "Nouveau".
class _LigneForte extends StatelessWidget {
  const _LigneForte({required this.icone, required this.texte, this.marque});

  final IconData icone;
  final String texte;
  final String? marque;

  @override
  Widget build(BuildContext context) {
    final marque = this.marque;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icone, size: 18, color: Couleurs.encreDouce),
          const SizedBox(width: 8),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  texte,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Couleurs.encre,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (marque != null) Pastille(texte: marque, fond: Couleurs.orange, couleur: Couleurs.surface),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
