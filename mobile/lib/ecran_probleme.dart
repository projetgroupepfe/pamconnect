import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Signaler un probleme a l'equipe : la page du site. Le message part
/// directement a l'equipe, la personne concernee n'en est pas informee.
///
/// En cas de succes, l'ecran rend la phrase du serveur a la discussion.
class EcranProbleme extends StatefulWidget {
  const EcranProbleme({super.key, required this.api, required this.discussionId});

  final ApiPamConnect api;
  final int discussionId;

  @override
  State<EcranProbleme> createState() => _EcranProblemeState();
}

class _EcranProblemeState extends State<EcranProbleme> {
  FormulaireProbleme? _formulaire;
  String? _refus;
  final _texte = TextEditingController();
  bool _envoi = false;
  String? _erreurEnvoi;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void dispose() {
    _texte.dispose();
    super.dispose();
  }

  Future<void> _charger() async {
    try {
      final formulaire = await widget.api.formulaireProbleme(widget.discussionId);
      if (!mounted) return;
      setState(() => _formulaire = formulaire);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() => _refus = erreur.message);
    }
  }

  Future<void> _envoyer() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final reponse = await widget.api.signalerProbleme(widget.discussionId, _texte.text);
      if (!mounted) return;
      Navigator.of(context).pop(reponse.texte);
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Signaler un problème')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final formulaire = _formulaire;
    const hauteurBouton = Size.fromHeight(48);

    if (refus != null) {
      return ListView(padding: const EdgeInsets.all(16), children: [Avertissement(texte: refus)]);
    }
    if (formulaire == null) return const Center(child: CircularProgressIndicator());

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final erreurEnvoi = _erreurEnvoi;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          "Votre message part directement à l'équipe PamConnect. La personne concernée n'en est pas informée.",
          style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
        ),
        const SizedBox(height: 8),
        LigneDetail(icone: Icons.insert_drive_file_outlined, texte: 'Discussion :', enGras: formulaire.titreDemande),
        // La personne qui ecrit doit savoir QUI l'equipe pourra sanctionner.
        LigneDetail(icone: Icons.person_outline, texte: 'Personne concernée :', enGras: formulaire.autre),
        const SizedBox(height: 16),
        if (formulaire.dejaSignale)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Vous avez déjà signalé cette discussion',
                      style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Text(
                    "L'équipe ne l'a pas encore examinée. Elle traite les signalements dans l'ordre d'arrivée.",
                    style: gris,
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
                    child: const Text('Retour à la discussion'),
                  ),
                ],
              ),
            ),
          )
        else ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _texte,
                minLines: 5,
                maxLines: 10,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: "Que s'est-il passé ?",
                  alignLabelWithHint: true,
                  hintText: 'Décrivez la situation avec vos mots.',
                  helperText: "Vous n'avez pas besoin de montrer un message. Racontez ce qui s'est passé : "
                      "c'est ce que l'équipe lira.",
                  helperMaxLines: 3,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          // Ce que la plateforme fait de ce signalement, ecrit AVANT le bouton.
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Couleurs.bleuClair, borderRadius: BorderRadius.circular(rayon)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Ce qui se passe ensuite',
                    style: texte.titleSmall?.copyWith(color: Couleurs.bleu, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Text(formulaire.consequences, style: gris),
                const SizedBox(height: 8),
                Text(formulaire.apresSignalement, style: aide),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (erreurEnvoi != null) ...[
            Avertissement(texte: erreurEnvoi),
            const SizedBox(height: 16),
          ],
          FilledButton.icon(
            onPressed: _envoi ? null : _envoyer,
            icon: _envoi
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                  )
                : const Icon(Icons.file_upload_outlined),
            label: const Text("Envoyer à l'équipe"),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _envoi ? null : () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
            child: const Text('Annuler'),
          ),
        ],
      ],
    );
  }
}
