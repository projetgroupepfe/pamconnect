import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Donner son avis apres un service termine : la page du site, champ pour
/// champ. L'echelle, les criteres et l'exemple viennent du serveur.
///
/// En cas de succes, l'ecran rend la phrase du serveur a la discussion.
class EcranAvis extends StatefulWidget {
  const EcranAvis({super.key, required this.api, required this.candidatureId});

  final ApiPamConnect api;
  final int candidatureId;

  @override
  State<EcranAvis> createState() => _EcranAvisState();
}

class _EcranAvisState extends State<EcranAvis> {
  FormulaireAvis? _formulaire;

  /// Le serveur refuse d'ouvrir le formulaire : il dit pourquoi.
  String? _refus;

  int? _note;
  final _commentaire = TextEditingController();
  final Map<String, int?> _criteres = {};
  bool _envoi = false;
  String? _erreurEnvoi;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void dispose() {
    _commentaire.dispose();
    super.dispose();
  }

  Future<void> _charger() async {
    try {
      final formulaire = await widget.api.formulaireAvis(widget.candidatureId);
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

  Future<void> _publier(FormulaireAvis formulaire) async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final reponse = await widget.api.donnerAvis(widget.candidatureId, {
        'note': _note,
        'commentaire': _commentaire.text,
        for (final critere in formulaire.criteres) critere.cle: _criteres[critere.cle],
      });
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
      appBar: AppBar(title: const Text('Donner mon avis')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final formulaire = _formulaire;
    const hauteurBouton = Size.fromHeight(48);

    if (refus != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: refus),
          const SizedBox(height: 16),
          OutlinedButton(
            onPressed: () => Navigator.of(context).pop(),
            style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
            child: const Text('Retour à la discussion'),
          ),
        ],
      );
    }
    if (formulaire == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final texte = Theme.of(context).textTheme;
    final gris = texte.bodyLarge?.copyWith(color: Couleurs.encreDouce);
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final erreurEnvoi = _erreurEnvoi;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: 'Sur '),
              TextSpan(
                text: formulaire.nomVise,
                style: const TextStyle(fontWeight: FontWeight.w600, color: Couleurs.encre),
              ),
              TextSpan(text: ', après « ${formulaire.titreDemande} ».'),
            ],
          ),
          style: gris,
        ),
        const SizedBox(height: 16),
        // Ce qui est definitif est dit AVANT : un avis ne se modifie pas.
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Couleurs.bleuClair,
            borderRadius: BorderRadius.circular(rayon),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text.rich(
                const TextSpan(
                  children: [
                    TextSpan(text: 'Votre avis sera '),
                    TextSpan(text: 'visible par tout le monde', style: TextStyle(fontWeight: FontWeight.w600)),
                    TextSpan(text: ', avec votre nom.'),
                  ],
                ),
                style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
              ),
              const SizedBox(height: 8),
              Text(
                "Il ne pourra plus être modifié : un avis que l'on peut réécrire devient un "
                'moyen de pression après coup. ${formulaire.nomVise} pourra le signaler à '
                "l'équipe s'il le juge faux, insultant ou discriminatoire.",
                style: aide,
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        const TitreSection('Votre note'),
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              children: [
                for (final niveau in formulaire.echelle)
                  _ChoixNote(
                    niveau: niveau,
                    choisi: _note == niveau.note,
                    auChoix: () => setState(() => _note = niveau.note),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 8),
        const TitreSection('Ce que vous voulez dire'),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _commentaire,
              minLines: 3,
              maxLines: 6,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                labelText: 'Votre commentaire, si vous le souhaitez',
                alignLabelWithHint: true,
                hintText: formulaire.exempleCommentaire,
                helperText: "Facultatif. Écrivez ce que vous diriez à quelqu'un qui hésite.",
                helperMaxLines: 2,
              ),
            ),
          ),
        ),
        const SizedBox(height: 16),
        // Les criteres sont replies : imposer cinq notes ferait abandonner
        // le formulaire.
        Card(
          clipBehavior: Clip.antiAlias,
          child: ExpansionTile(
            shape: const Border(),
            collapsedShape: const Border(),
            title: Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: 'Noter plus précisément '),
                  TextSpan(text: '(facultatif)', style: TextStyle(color: Couleurs.encrePale, fontSize: aide?.fontSize)),
                ],
              ),
            ),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              for (final critere in formulaire.criteres)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: InputDecorator(
                    decoration: InputDecoration(labelText: critere.libelle),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<int?>(
                        value: _criteres[critere.cle],
                        isExpanded: true,
                        isDense: true,
                        items: [
                          const DropdownMenuItem<int?>(value: null, child: Text('Ne pas noter')),
                          for (final niveau in formulaire.echelle)
                            DropdownMenuItem<int?>(value: niveau.note, child: Text('${niveau.note} sur 5')),
                        ],
                        onChanged: (choix) => setState(() => _criteres[critere.cle] = choix),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        if (erreurEnvoi != null) ...[
          Avertissement(texte: erreurEnvoi),
          const SizedBox(height: 16),
        ],
        FilledButton.icon(
          onPressed: _envoi ? null : () => _publier(formulaire),
          icon: _envoi
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                )
              : const Icon(Icons.star_border),
          label: const Text('Publier mon avis'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _envoi ? null : () => Navigator.of(context).pop(),
          style: OutlinedButton.styleFrom(minimumSize: hauteurBouton),
          child: const Text('Annuler'),
        ),
      ],
    );
  }
}

/// Une note de l'echelle, sous forme de ligne a toucher : sur un telephone,
/// cinq etoiles cote a cote se touchent mal, et un chiffre seul ne dit pas
/// ce qu'il vaut.
class _ChoixNote extends StatelessWidget {
  const _ChoixNote({required this.niveau, required this.choisi, required this.auChoix});

  final NiveauNote niveau;
  final bool choisi;
  final VoidCallback auChoix;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: choisi,
      child: InkWell(
        onTap: auChoix,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Icon(
                choisi ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                color: choisi ? Couleurs.bleu : Couleurs.encreDouce,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: '${niveau.note}', style: const TextStyle(fontWeight: FontWeight.w600)),
                      TextSpan(text: ' sur 5, ${niveau.libelle}'),
                    ],
                  ),
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encre),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
