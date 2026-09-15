import 'package:flutter/material.dart';

import 'api.dart';
import 'ecran_modifier_profil.dart';
import 'ecran_principal.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Ce que lit la personne quand le serveur ne reconnait plus sa session.
const messageSessionPerdue = "Votre session n'est plus valable, par exemple "
    'après un redémarrage du serveur. Reconnectez-vous.';

/// Revient a l'ecran de connexion en gardant l'adresse du serveur, et en
/// disant pourquoi. Partagee par tous les ecrans qui ont besoin d'une
/// session.
///
/// Tous les ecrans ouverts sont fermes : le bouton retour ne doit pas
/// rouvrir un ecran dont la session ne vaut plus rien.
void revenirALaConnexion(BuildContext context, ApiPamConnect api, [String? message]) {
  Navigator.of(context).pushAndRemoveUntil(
    MaterialPageRoute<void>(
      builder: (_) => EcranConnexion(adresseInitiale: api.racine, message: message),
    ),
    (_) => false,
  );
}

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
  final _champAdresse = GlobalKey<FormFieldState<String>>();
  late final _adresse = TextEditingController(text: widget.adresseInitiale);
  final _email = TextEditingController();
  final _motdepasse = TextEditingController();
  bool _enCours = false;
  late String? _message = widget.message;

  /// La phrase du site une fois le compte cree.
  String? _confirmation;

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
      _confirmation = null;
    });

    final api = ApiPamConnect(_adresse.text);
    try {
      final moi = await api.connexion(_email.text.trim(), _motdepasse.text);
      if (!mounted) return;

      // CHAQUE ROLE ARRIVE SUR SA PAGE DE TRAVAIL, comme sur le site : la
      // personne qui repond sur les demandes ouvertes, l'employeur sur ses
      // demandes. L'espace de l'equipe reste sur le site web : c'est une
      // decision prise avec l'encadreur. Il s'ouvre aussi dans le
      // navigateur d'un telephone.
      // La barre de menu choisit ensuite les entrees de chaque role.
      final Widget accueil;
      if (moi.repondAuxDemandes || moi.publieDesDemandes) {
        accueil = EcranPrincipal(api: api, moi: moi);
      } else {
        await api.deconnexion();
        if (!mounted) return;
        setState(() {
          _enCours = false;
          _message = "L'espace de l'équipe s'utilise sur le site PamConnect, depuis un navigateur.";
        });
        return;
      }

      Navigator.of(context).pushReplacement(MaterialPageRoute<void>(builder: (_) => accueil));
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      setState(() {
        _enCours = false;
        _message = erreur.message;
      });
    }
  }

  /// Creer un compte ne demande ici que l'adresse du serveur : l'email et le
  /// mot de passe se choisissent dans le formulaire. Une fois le compte cree,
  /// l'adresse revient remplie, il ne reste que le mot de passe a taper.
  Future<void> _creerUnCompte() async {
    if (_enCours || !_champAdresse.currentState!.validate()) return;
    setState(() {
      _message = null;
      _confirmation = null;
    });

    final faite = await Navigator.of(context).push<InscriptionFaite>(
      MaterialPageRoute(builder: (_) => EcranModifierProfil.inscription(api: ApiPamConnect(_adresse.text))),
    );
    if (!mounted || faite == null) return;
    setState(() {
      _email.text = faite.email;
      _motdepasse.clear();
      _confirmation = '${faite.titre} ${faite.texte}';
    });
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
                    'Connectez-vous à votre compte.',
                    textAlign: TextAlign.center,
                    style: texte.bodyLarge?.copyWith(color: Couleurs.encreDouce),
                  ),
                  const SizedBox(height: 32),
                  if (_message != null) ...[
                    Avertissement(texte: _message!),
                    const SizedBox(height: 16),
                  ],
                  if (_confirmation != null) ...[
                    Confirmation(texte: _confirmation!),
                    const SizedBox(height: 16),
                  ],
                  TextFormField(
                    key: _champAdresse,
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
                  const SizedBox(height: 8),
                  // Le second bouton de la page Se connecter du site.
                  OutlinedButton(
                    onPressed: _enCours ? null : _creerUnCompte,
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    child: const Text('Créer un compte'),
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
