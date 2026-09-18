import 'package:flutter/material.dart';

import 'api.dart';
import 'elements.dart';
import 'theme.dart';

/// Un mot de passe oublie, rattrape par un appel de l'equipe.
///
/// AUCUN EMAIL N'EST ENVOYE : la plateforme n'a pas de service d'envoi, et
/// le numero de telephone est deja au dossier. L'equipe appelle ce numero,
/// s'assure que c'est bien la personne, et lui lit un code a six chiffres.
///
/// La personne entre ce code et choisit ELLE-MEME son mot de passe :
/// l'equipe ne le connait jamais.
///
/// Les deux temps tiennent sur un seul ecran, parce qu'ils se suivent : on
/// demande l'appel, puis on entre le code quand il arrive.
class EcranMotDePasseOublie extends StatefulWidget {
  const EcranMotDePasseOublie({super.key, required this.api, this.email = ''});

  final ApiPamConnect api;

  /// L'adresse deja tapee sur l'ecran de connexion : la retaper ne
  /// servirait a rien.
  final String email;

  @override
  State<EcranMotDePasseOublie> createState() => _EcranMotDePasseOublieState();
}

class _EcranMotDePasseOublieState extends State<EcranMotDePasseOublie> {
  final _formulaire = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.email);
  final _code = TextEditingController();
  final _motdepasse = TextEditingController();

  bool _enCours = false;
  String? _message;
  String? _confirmation;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _motdepasse.dispose();
    super.dispose();
  }

  bool _adresseDonnee() {
    final adresse = _email.text.trim();
    if (adresse.isEmpty) {
      setState(() => _message = 'Indiquez votre adresse email.');
      return false;
    }
    return true;
  }

  Future<void> _demanderUnAppel() async {
    if (_enCours || !_adresseDonnee()) return;
    setState(() {
      _enCours = true;
      _message = null;
      _confirmation = null;
    });

    try {
      final phrase = await widget.api.demanderUnCode(_email.text.trim());
      if (!mounted) return;
      setState(() {
        _enCours = false;
        _confirmation = phrase.texte;
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      setState(() {
        _enCours = false;
        _message = erreur.message;
      });
    }
  }

  Future<void> _choisirMonMotDePasse() async {
    if (_enCours || !_formulaire.currentState!.validate()) return;
    setState(() {
      _enCours = true;
      _message = null;
      _confirmation = null;
    });

    try {
      final phrase = await widget.api.choisirUnMotDePasse(
        _email.text.trim(),
        _code.text.trim(),
        _motdepasse.text,
      );
      if (!mounted) return;
      Navigator.of(context).pop(phrase.texte);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      setState(() {
        _enCours = false;
        _message = erreur.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final aide = texte.bodyMedium?.copyWith(color: Couleurs.encrePale);

    return Scaffold(
      appBar: AppBar(title: const Text('Mot de passe oublié')),
      body: SafeArea(
        child: Form(
          key: _formulaire,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // CE QUI VA SE PASSER, dit avant : sinon la personne attend
              // un message qui ne viendra jamais.
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
                      'Comment ça se passe',
                      style: texte.titleSmall?.copyWith(
                        color: Couleurs.bleu,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text.rich(
                      const TextSpan(
                        children: [
                          TextSpan(text: "L'équipe PamConnect appelle le "),
                          TextSpan(
                            text: 'numéro de téléphone de votre compte',
                            style: TextStyle(fontWeight: FontWeight.w600),
                          ),
                          TextSpan(
                            text: " et vous donne un code. Vous entrez ce code et vous choisissez "
                                'vous-même votre nouveau mot de passe.',
                          ),
                        ],
                      ),
                      style: texte.bodyMedium?.copyWith(color: Couleurs.encreDouce),
                    ),
                    const SizedBox(height: 8),
                    Text("L'équipe ne connaît jamais votre mot de passe.", style: aide),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              if (_message != null) ...[
                Avertissement(texte: _message!),
                const SizedBox(height: 16),
              ],
              if (_confirmation != null) ...[
                Confirmation(texte: _confirmation!),
                const SizedBox(height: 16),
              ],
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Adresse email de votre compte'),
                validator: (valeur) => (valeur == null || valeur.trim().isEmpty)
                    ? 'Indiquez votre adresse email.'
                    : null,
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: _enCours ? null : _demanderUnAppel,
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                icon: const Icon(Icons.phone_outlined),
                label: const Text('Demander un appel'),
              ),
              const SizedBox(height: 24),
              const TitreSection('Le code reçu au téléphone'),
              TextFormField(
                controller: _code,
                keyboardType: TextInputType.number,
                autocorrect: false,
                maxLength: 6,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Code à six chiffres'),
                validator: (valeur) =>
                    (valeur == null || valeur.trim().isEmpty) ? "Entrez le code que l'équipe vous a lu." : null,
              ),
              ChampMotDePasse(
                controleur: _motdepasse,
                libelle: 'Nouveau mot de passe',
                aide: 'Vous êtes la seule personne à le connaître.',
                autofill: const [AutofillHints.newPassword],
                action: TextInputAction.done,
                auValider: (_) => _choisirMonMotDePasse(),
                verifier: (valeur) => (valeur == null || valeur.isEmpty)
                    ? 'Choisissez un nouveau mot de passe.'
                    : null,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _enCours ? null : _choisirMonMotDePasse,
                child: _enCours
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
                      )
                    : const Text('Changer mon mot de passe'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
