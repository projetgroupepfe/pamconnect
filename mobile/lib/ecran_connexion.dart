import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'ecran_accueil.dart';
import 'ecran_modifier_profil.dart';
import 'ecran_mot_de_passe_oublie.dart';
import 'ecran_principal.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

/// Ce que lit la personne quand le serveur ne reconnait plus sa session.
const messageSessionPerdue = "Votre session n'est plus valable, par exemple "
    'après un redémarrage du serveur. Reconnectez-vous.';

const _cleAdresse = 'adresse_serveur';

/// L'adresse du serveur retenue sur le telephone, ou '' la premiere fois.
///
/// Elle est demandee une seule fois : la retaper a chaque ouverture ne
/// servait a rien, et une autre personne qui decouvre l'application n'a pas
/// a voir ce reglage.
Future<String> lireAdresseRetenue() async {
  try {
    return await SharedPreferencesAsync().getString(_cleAdresse) ?? '';
  } catch (_) {
    // Sans memoire lisible, l'adresse est simplement redemandee.
    return '';
  }
}

/// Retenue seulement apres une reponse du serveur : une adresse fausse ne
/// doit pas se cacher derriere le lien.
Future<void> _retenirAdresse(String adresse) async {
  try {
    await SharedPreferencesAsync().setString(_cleAdresse, adresse);
  } catch (_) {
    // Elle sera redemandee a la prochaine ouverture, rien de plus.
  }
}

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
///
/// Une fois retenue, elle se cache derriere "Changer l'adresse du serveur" ;
/// elle ne revient d'elle-meme que si le serveur est introuvable.
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

  /// Le champ de l'adresse : affiche la premiere fois, cache ensuite.
  late bool _adresseVisible = widget.adresseInitiale.trim().isEmpty;

  /// La phrase du site une fois le compte cree.
  String? _confirmation;

  /// Pourquoi un bouton des pages de presentation ramene ici.
  String? _information;

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
      _information = null;
    });

    final api = ApiPamConnect(_adresse.text);
    try {
      final moi = await api.connexion(_email.text.trim(), _motdepasse.text);
      // Le serveur a repondu : cette adresse est la bonne, on la retient.
      await _retenirAdresse(api.racine);
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
        // Introuvable a cette adresse : on la montre, pour la corriger.
        if (erreur.adresseEnCause) _adresseVisible = true;
      });
    }
  }

  /// Creer un compte et Decouvrir PamConnect ne demandent ici que l'adresse
  /// du serveur : le reste se choisit plus loin.
  bool _adresseValide() {
    // Cache, le champ n'est pas a l'ecran : l'adresse retenue suffit.
    final champ = _champAdresse.currentState;
    if (_enCours || (champ != null && !champ.validate())) return false;
    setState(() {
      _message = null;
      _confirmation = null;
      _information = null;
    });
    return true;
  }

  Future<void> _creerUnCompte() async {
    if (_adresseValide()) await _ouvrirInscription();
  }

  /// L'adresse deja tapee part avec : la personne ne la retape pas.
  Future<void> _motDePasseOublie() async {
    if (!_adresseValide()) return;

    final phrase = await Navigator.of(context).push<String>(
      MaterialPageRoute<String>(
        builder: (_) => EcranMotDePasseOublie(
          api: ApiPamConnect(_adresse.text),
          email: _email.text.trim(),
        ),
      ),
    );

    if (!mounted || phrase == null) return;
    setState(() => _confirmation = phrase);
  }

  /// Une fois le compte cree, on revient ici, meme depuis l'accueil :
  /// l'adresse revient remplie, il ne reste que le mot de passe a taper.
  Future<void> _ouvrirInscription({bool proposerSesServices = false}) async {
    final faite = await Navigator.of(context).push<InscriptionFaite>(
      MaterialPageRoute(
        builder: (_) => EcranModifierProfil.inscription(
          api: ApiPamConnect(_adresse.text),
          proposerSesServices: proposerSesServices,
        ),
      ),
    );
    if (faite == null) return;
    // Le compte a ete cree : l'adresse est la bonne, on la retient.
    await _retenirAdresse(ApiPamConnect.normaliserAdresse(_adresse.text));
    if (!mounted) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
    setState(() {
      _adresseVisible = false;
      _email.text = faite.email;
      _motdepasse.clear();
      _confirmation = '${faite.titre} ${faite.texte}';
    });
  }

  /// L'accueil du site et ses deux pages, avant tout compte.
  void _decouvrir() {
    if (!_adresseValide()) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EcranAccueil(
          api: ApiPamConnect(_adresse.text),
          seConnecter: _revenirAvecInformation,
          proposerSesServices: () => _ouvrirInscription(proposerSesServices: true),
        ),
      ),
    );
  }

  /// Un bouton des pages de presentation qui, sur le site, ouvre un ecran
  /// sans compte : ici, il ramene a la connexion en disant pourquoi.
  void _revenirAvecInformation(String information) {
    Navigator.of(context).popUntil((route) => route.isFirst);
    setState(() {
      _message = null;
      _confirmation = null;
      _information = information;
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
                  if (_information != null) ...[
                    Information(texte: _information!),
                    const SizedBox(height: 16),
                  ],
                  if (_adresseVisible) ...[
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
                  ],
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
                  ChampMotDePasse(
                    controleur: _motdepasse,
                    libelle: 'Mot de passe',
                    action: TextInputAction.done,
                    auValider: (_) => _seConnecter(),
                    verifier: (valeur) =>
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
                  const SizedBox(height: 8),
                  // Le lien "Mot de passe oublie ?" du site. Il mene a
                  // l'appel de l'equipe, pas a un email : la plateforme
                  // n'en envoie pas.
                  OutlinedButton.icon(
                    onPressed: _enCours ? null : _motDePasseOublie,
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    icon: const Icon(Icons.phone_outlined),
                    label: const Text('Mot de passe oublié ?'),
                  ),
                  const SizedBox(height: 8),
                  // L'entree Accueil du site : ce qu'est PamConnect, avant tout compte.
                  OutlinedButton.icon(
                    onPressed: _enCours ? null : _decouvrir,
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    icon: const Icon(Icons.home_outlined),
                    label: const Text('Découvrir PamConnect'),
                  ),
                  // Le reglage reste a portee, sans s'afficher a chaque personne
                  // qui ouvre l'application.
                  if (!_adresseVisible) ...[
                    const SizedBox(height: 16),
                    TextButton(
                      onPressed: _enCours ? null : () => setState(() => _adresseVisible = true),
                      child: const Text("Changer l'adresse du serveur"),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
