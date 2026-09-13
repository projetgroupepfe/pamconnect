import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_demandes.dart';
import 'theme.dart';

/// L'ecran d'entree : l'adresse du serveur, puis les identifiants.
///
/// L'adresse est demandee ici plutot que fixee a la fabrication : elle change
/// a chaque fois que l'ordinateur rejoint le partage de connexion, et le jour
/// de la soutenance il faut pouvoir la corriger sur place.
class EcranConnexion extends StatefulWidget {
  const EcranConnexion({super.key, this.adresseInitiale = '', this.message});

  /// L'adresse deja tapee, rendue apres une deconnexion : la redemander ne
  /// servirait a rien.
  final String adresseInitiale;

  /// Pourquoi on revient ici, par exemple une session perdue.
  final String? message;

  @override
  State<EcranConnexion> createState() => _EcranConnexionState();
}

class _EcranConnexionState extends State<EcranConnexion> {
  final _formulaire = GlobalKey<FormState>();
  late final _adresse = TextEditingController(text: widget.adresseInitiale);
  final _email = TextEditingController();
  final _motdepasse = TextEditingController();
  bool _enCours = false;
  late String? _message = widget.message;

  @override
  void dispose() {
    _adresse.dispose();
    _email.dispose();
    _motdepasse.dispose();
    super.dispose();
  }

  Future<void> _seConnecter() async {
    if (_enCours || !_formulaire.currentState!.validate()) return;
    setState(() {
      _enCours = true;
      _message = null;
    });

    final api = ApiPamConnect(_adresse.text);
    try {
      final moi = await api.connexion(_email.text.trim(), _motdepasse.text);
      if (!mounted) return;

      // LA SEPARATION DES ROLES VA JUSQU'A L'APPLICATION. Cette premiere
      // version sert les personnes qui repondent aux demandes : un employeur
      // ou l'equipe est deconnecte aussitot, et on lui dit ou aller.
      if (!moi.repondAuxDemandes) {
        await api.deconnexion();
        if (!mounted) return;
        setState(() {
          _enCours = false;
          _message = "Cette première version de l'application est réservée aux "
              "personnes qui répondent aux demandes. Les employeurs et l'équipe "
              "continuent d'utiliser le site.";
        });
        return;
      }

      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => EcranDemandes(api: api, moi: moi)),
      );
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
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formulaire,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'PamConnect',
                    textAlign: TextAlign.center,
                    style: texte.headlineMedium?.copyWith(
                      color: Couleurs.bleuFonce,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Connectez-vous pour voir les demandes.',
                    textAlign: TextAlign.center,
                    style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
                  ),
                  const SizedBox(height: 32),
                  if (_message != null) ...[
                    Avertissement(texte: _message!),
                    const SizedBox(height: 16),
                  ],
                  TextFormField(
                    controller: _adresse,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Adresse du serveur',
                      helperText: "L'adresse affichée par npm start sur l'ordinateur",
                    ),
                    validator: (valeur) => (valeur == null || valeur.trim().isEmpty)
                        ? "Indiquez l'adresse du serveur."
                        : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    autofillHints: const [AutofillHints.email],
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(labelText: 'Email'),
                    validator: (valeur) => (valeur == null || valeur.trim().isEmpty)
                        ? 'Indiquez votre email.'
                        : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _motdepasse,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _seConnecter(),
                    decoration: const InputDecoration(labelText: 'Mot de passe'),
                    validator: (valeur) =>
                        (valeur == null || valeur.isEmpty) ? 'Indiquez votre mot de passe.' : null,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _enCours ? null : _seConnecter,
                    child: _enCours
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Couleurs.bleuFonce,
                            ),
                          )
                        : const Text('Se connecter'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
