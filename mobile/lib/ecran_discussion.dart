import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Une discussion entre l'employeur et la personne qui a repondu : la page
/// Discussion du site.
///
/// Le serveur n'envoie pas les nouveaux messages de lui-meme, ni au site ni
/// a l'application : on les voit en actualisant, comme en rechargeant la
/// page sur l'ordinateur.
class EcranDiscussion extends StatefulWidget {
  const EcranDiscussion({super.key, required this.api, required this.discussionId});

  final ApiPamConnect api;
  final int discussionId;

  @override
  State<EcranDiscussion> createState() => _EcranDiscussionState();
}

class _EcranDiscussionState extends State<EcranDiscussion> {
  Discussion? _discussion;
  String? _erreur;
  final _texte = TextEditingController();
  final _defilement = ScrollController();
  bool _envoi = false;
  String? _erreurEnvoi;

  /// Les messages dont le signalement est en cours d'envoi.
  final Set<int> _signalements = {};

  @override
  void initState() {
    super.initState();
    _charger(allerEnBas: true);
  }

  @override
  void dispose() {
    _texte.dispose();
    _defilement.dispose();
    super.dispose();
  }

  Future<void> _charger({bool allerEnBas = false}) async {
    try {
      final discussion = await widget.api.discussion(widget.discussionId);
      if (!mounted) return;
      setState(() {
        _discussion = discussion;
        _erreur = null;
      });
      // Une discussion se lit par la fin : c'est la que se trouvent le
      // dernier message et la zone pour repondre.
      if (allerEnBas) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!_defilement.hasClients) return;
          _defilement.animateTo(
            _defilement.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        });
      }
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _erreur = erreur.message);
    }
  }

  Future<void> _envoyer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      await widget.api.envoyerMessage(widget.discussionId, _texte.text);
      if (!mounted) return;
      _texte.clear();
      await _charger(allerEnBas: true);
      if (!mounted) return;
      setState(() => _envoi = false);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreurEnvoi = erreur.message;
      });
    }
  }

  Future<void> _signaler(MessageDiscussion message) async {
    if (_signalements.contains(message.id)) return;
    setState(() => _signalements.add(message.id));

    String? probleme;
    try {
      await widget.api.signalerMessage(widget.discussionId, message.id);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      probleme = erreur.message;
    }

    if (!mounted) return;
    await _charger();
    if (!mounted) return;
    setState(() => _signalements.remove(message.id));
    if (probleme != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(probleme)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Discussion'),
        actions: [
          IconButton(
            tooltip: 'Actualiser',
            onPressed: _envoi ? null : () => _charger(allerEnBas: true),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _charger,
          child: ListView(
            controller: _defilement,
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            children: _contenu(context),
          ),
        ),
      ),
    );
  }

  List<Widget> _contenu(BuildContext context) {
    final discussion = _discussion;
    final erreur = _erreur;

    if (discussion == null) {
      if (erreur == null) {
        return const [
          Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
        ];
      }
      return [
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
        OutlinedButton(
          onPressed: () => Navigator.of(context).pop(),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: const Text('Retour'),
        ),
      ];
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final lieu = discussion.lieu;
    final conditions = discussion.conditions;
    final metierAutre = discussion.metierAutre;
    final serviceTermine = discussion.serviceTermine;
    final declaration = discussion.declarationDeLaPersonne;
    final erreurEnvoi = _erreurEnvoi;

    return [
      if (erreur != null) ...[
        Avertissement(texte: erreur),
        const SizedBox(height: 16),
      ],
      // Le rappel de ce dont on parle : sans lui, on ouvre une discussion
      // sans savoir a quelle demande elle se rapporte.
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                discussion.titreDemande,
                style: texte.titleMedium?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
              ),
              LigneDetail(
                icone: Icons.person_outline,
                texte: 'Avec',
                enGras: discussion.avec,
                apresGras: metierAutre == null ? null : ', $metierAutre',
              ),
              LigneDetail(icone: Icons.calendar_today_outlined, texte: discussion.horaire),
              if (lieu != null) LigneDetail(icone: Icons.place_outlined, texte: lieu),
              if (conditions != null) LigneDetail(icone: Icons.info_outline, texte: conditions),
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.schedule, size: 18, color: Couleurs.encreDouce),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        discussion.phraseStatut,
                        style: texte.bodyMedium?.copyWith(color: Couleurs.encre, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      const TitreSection('Le prix'),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final ligne in discussion.prix.lignes) _LignePrix(ligne: ligne),
              if (discussion.prix.lignes.isNotEmpty) const SizedBox(height: 8),
              Text(discussion.prix.phrase, style: aide),
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      const TitreSection('Les messages'),
      if (discussion.messages.isEmpty)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Text("Aucun message pour l'instant. Écrivez le premier.", style: gris),
        ),
      for (final message in discussion.messages)
        _Message(
          message: message,
          auSignalement: _signaler,
          occupe: _signalements.contains(message.id),
        ),
      const SizedBox(height: 8),
      if (serviceTermine != null)
        // Le service est fait : on relit, on n'ecrit plus.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Couleurs.bleuClair,
            borderRadius: BorderRadius.circular(rayon),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(
                  'Service terminé',
                  style: texte.titleMedium?.copyWith(color: Couleurs.bleuFonce, fontWeight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: '${serviceTermine.nom} a déclaré ce service effectué le '),
                    TextSpan(text: serviceTermine.le, style: const TextStyle(fontWeight: FontWeight.w600)),
                    const TextSpan(text: '.'),
                  ],
                ),
                style: gris,
              ),
              const SizedBox(height: 8),
              Text(
                'Cette discussion est archivée. Vous pouvez la relire à tout moment, '
                'mais plus y écrire.',
                style: aide,
              ),
            ],
          ),
        )
      else if (discussion.peutEcrire)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Nommer celle ou celui qui lira leve tout doute : une
                // discussion n'a que deux personnes.
                TextField(
                  controller: _texte,
                  minLines: 3,
                  maxLines: 6,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    labelText: 'Écrire à ${discussion.avec}',
                    alignLabelWithHint: true,
                    hintText: 'ex : ${discussion.exempleMessage}',
                    hintMaxLines: 3,
                    helperText: 'Parlez du service, du tarif et des horaires. '
                        "N'indiquez pas votre adresse exacte : elle sera transmise "
                        'automatiquement après le paiement.',
                    helperMaxLines: 4,
                  ),
                ),
                const SizedBox(height: 12),
                if (erreurEnvoi != null) ...[
                  Avertissement(texte: erreurEnvoi),
                  const SizedBox(height: 12),
                ],
                FilledButton.icon(
                  onPressed: _envoi ? null : _envoyer,
                  icon: _envoi
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                        )
                      : const Icon(Icons.send),
                  label: const Text('Envoyer'),
                ),
              ],
            ),
          ),
        ),
      if (declaration != null) ...[
        const SizedBox(height: 16),
        // Elle a declare avoir travaille : l'employeur doit le savoir,
        // c'est lui qui detient la cle du paiement.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Couleurs.bleuClair,
            borderRadius: BorderRadius.circular(rayon),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${declaration.nom} indique avoir effectué le service',
                style: texte.titleMedium?.copyWith(color: Couleurs.bleuFonce, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  children: [
                    const TextSpan(text: "Elle l'a déclaré le "),
                    TextSpan(text: declaration.le, style: const TextStyle(fontWeight: FontWeight.w600)),
                    const TextSpan(
                      text: '. Si c\'est exact, déclarez-le de votre côté : c\'est ce qui la paie.',
                    ),
                  ],
                ),
                style: gris,
              ),
              const SizedBox(height: 8),
              Text(
                "Si ce n'est pas exact, ne déclarez rien et signalez le problème à l'équipe.",
                style: aide,
              ),
            ],
          ),
        ),
      ],
    ];
  }
}

class _LignePrix extends StatelessWidget {
  const _LignePrix({required this.ligne});

  final LignePrix ligne;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyLarge?.copyWith(
          color: ligne.fort ? Couleurs.encre : Couleurs.encreDouce,
          fontWeight: ligne.fort ? FontWeight.w600 : FontWeight.normal,
        );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(ligne.libelle, style: style)),
          const SizedBox(width: 12),
          Text(ligne.montant, style: style),
        ],
      ),
    );
  }
}

/// Un message. Le sien est decale et marque d'un trait bleu, comme sur le
/// site.
class _Message extends StatelessWidget {
  const _Message({required this.message, required this.auSignalement, required this.occupe});

  final MessageDiscussion message;
  final void Function(MessageDiscussion) auSignalement;
  final bool occupe;

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodySmall?.copyWith(color: Couleurs.encrePale);

    return Padding(
      padding: EdgeInsets.only(bottom: 12, left: message.deMoi ? 20 : 0),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (message.deMoi) Container(width: 3, color: Couleurs.bleu),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: message.auteur,
                              style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encreDouce),
                            ),
                            TextSpan(text: ' · ${message.quand}'),
                            if (message.signale) const TextSpan(text: " · signalé à l'équipe"),
                          ],
                        ),
                        style: aide,
                      ),
                      const SizedBox(height: 4),
                      Text(message.texte, style: texte.bodyLarge?.copyWith(color: Couleurs.encre)),
                      // L'avertissement s'affiche aux DEUX personnes : celle
                      // qui a ecrit prend un risque, elle aussi.
                      if (message.risquePaiement)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text.rich(
                            const TextSpan(
                              children: [
                                TextSpan(
                                  text: 'Pour votre sécurité, ne payez pas directement en dehors de la plateforme.',
                                  style: TextStyle(fontWeight: FontWeight.w600),
                                ),
                                TextSpan(
                                  text: ' Le paiement doit passer par PamConnect pour que la personne reçoive '
                                      'son argent après confirmation de la prestation. En dehors, personne '
                                      "n'a de recours en cas de problème.",
                                ),
                              ],
                            ),
                            style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
                          ),
                        ),
                      // Une action rare : son poids a l'ecran suit sa
                      // frequence, pas son importance.
                      if (message.peutSignaler)
                        TextButton(
                          onPressed: occupe ? null : () => auSignalement(message),
                          style: TextButton.styleFrom(
                            foregroundColor: Couleurs.encreDouce,
                            padding: EdgeInsets.zero,
                            minimumSize: const Size(0, 36),
                          ),
                          child: const Text('Signaler ce message'),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
