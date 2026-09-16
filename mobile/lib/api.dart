import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'modeles.dart';

/// Une erreur que la personne peut lire telle quelle.
///
/// Quand le serveur explique un refus, c'est SON message qui s'affiche :
/// l'application ne reformule pas une decision qu'elle n'a pas prise.
class ErreurApi implements Exception {
  const ErreurApi(this.message, {this.code, this.proposeVerification = false, this.adresseEnCause = false});

  final String message;
  final int? code;

  /// Le refus se regle en faisant verifier son identite : l'ecran propose
  /// alors le bouton du site, "Faire vérifier mon identité".
  final bool proposeVerification;

  /// Le serveur est introuvable a cette adresse, ou ce n'est pas lui qui
  /// repond : l'ecran de connexion montre alors l'adresse, pour la corriger.
  final bool adresseEnCause;

  /// 401 : la session ne vaut plus rien, par exemple apres un redemarrage du
  /// serveur, qui garde ses sessions en memoire.
  bool get sessionPerdue => code == 401;

  /// 403 : le compte est suspendu, ou l'action n'est pas permise.
  bool get refus => code == 403;

  @override
  String toString() => message;
}

const _injoignable = "Le serveur ne répond pas. Vérifiez l'adresse, et que le "
    "téléphone est sur le même réseau que l'ordinateur.";

/// Un document choisi sur le telephone, pret a partir : son nom (avec son
/// extension, que le serveur verifie), sa taille, et de quoi le lire.
class DocumentAEnvoyer {
  const DocumentAEnvoyer({required this.nom, required this.taille, required this.lire});

  final String nom;
  final int taille;
  final Stream<List<int>> Function() lire;
}

/// Le SEUL endroit de l'application qui parle au serveur.
///
/// La session est celle du site : le serveur rend un jeton a la connexion,
/// que l'application renvoie dans l'en-tete Authorization. Il n'est garde
/// qu'en memoire : fermer l'application demande de se reconnecter.
class ApiPamConnect {
  ApiPamConnect(String adresse) : racine = normaliserAdresse(adresse);

  /// L'adresse du serveur, sans barre finale.
  final String racine;

  String? _jeton;

  /// "192.168.1.200:3000/" devient "http://192.168.1.200:3000".
  ///
  /// Le port n'est jamais ajoute : on ne devine pas une valeur a la place
  /// de la personne. Seul le http:// oublie est complete.
  static String normaliserAdresse(String saisie) {
    var adresse = saisie.trim();
    if (adresse.isEmpty) return adresse;
    if (!adresse.startsWith('http://') && !adresse.startsWith('https://')) {
      adresse = 'http://$adresse';
    }
    while (adresse.endsWith('/')) {
      adresse = adresse.substring(0, adresse.length - 1);
    }
    return adresse;
  }

  Future<Moi> connexion(String email, String motdepasse) async {
    final donnees = await _appeler(
      '/api/connexion',
      corps: {'email': email, 'motdepasse': motdepasse},
    );
    final connexion = _interpreter(() => Connexion.depuisJson(donnees));
    _jeton = connexion.jeton;
    return connexion.moi;
  }

  /// Qui est connecte, avec le solde de jetons a jour. C'est aussi ce qui
  /// revele une session perdue : la liste des demandes, elle, est publique.
  Future<Moi> moi() async {
    final donnees = await _appeler('/api/moi');
    return _interpreter(() => Moi.depuisReponse(donnees));
  }

  /// L'ecran Repondre a cette demande : le prix, ce qu'elle recevra, et ce
  /// que la reponse coute, ecrits par le serveur.
  Future<EcranReponse> ecranReponse(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/reponse');
    return _interpreter(() => EcranReponse.depuisJson(donnees));
  }

  Future<ReponseEnvoyee> repondre(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/reponse', corps: const {});
    return _interpreter(() => ReponseEnvoyee.depuisJson(donnees));
  }

  Future<ListeDemandes> demandes() async {
    final donnees = await _appeler('/api/demandes');
    return _interpreter(() => ListeDemandes.depuisJson(donnees));
  }

  /// Les demandes de l'employeur connecte et les reponses recues : ce que
  /// montre la page Mes demandes du site, decide par la meme fonction.
  Future<MesDemandes> mesDemandes() async {
    final donnees = await _appeler('/api/mes-demandes');
    return _interpreter(() => MesDemandes.depuisJson(donnees));
  }

  /// Les listes du formulaire de publication. Refuse (403) a qui ne peut
  /// pas publier, avec la raison que donne aussi le site.
  ///
  /// [pour] : la demande est proposee a cette personne, depuis sa fiche.
  Future<FormulaireDemande> formulaireDemande({int? pour}) async {
    final donnees = await _appeler('/api/formulaire-demande${pour == null ? '' : '?pour=$pour'}');
    return _interpreter(() => FormulaireDemande.depuisJson(donnees));
  }

  /// L'arrondissement que le serveur retiendra pour ce quartier.
  Future<LieuTrouve> quartier(String nom) async {
    final donnees = await _appeler('/api/quartier?nom=${Uri.encodeQueryComponent(nom)}');
    return _interpreter(() => LieuTrouve.depuisJson(donnees));
  }

  /// Publie une demande. Les champs partent tels que la personne les a
  /// saisis : c'est le serveur qui verifie, et qui explique un refus.
  Future<Publication> publierDemande(Map<String, String> champs) async {
    final donnees = await _appeler('/api/demandes', corps: champs);
    return _interpreter(() => Publication.depuisJson(donnees));
  }

  /// Ce que l'employeur relit avant de choisir quelqu'un.
  Future<ConfirmationChoix> confirmationChoix(int candidatureId) async {
    final donnees = await _appeler('/api/candidatures/$candidatureId/confirmation');
    return _interpreter(() => ConfirmationChoix.depuisJson(donnees));
  }

  /// Choisir la personne. C'est le serveur qui ferme la demande et refuse
  /// les autres reponses en attente.
  Future<void> choisirCandidature(int candidatureId) => _decider(candidatureId, 'choisir');

  /// Refuser une reponse : la demande reste ouverte.
  Future<void> refuserCandidature(int candidatureId) => _decider(candidatureId, 'refuser');

  /// Les personnes d'un metier, classees par le serveur. Aucune position
  /// n'est envoyee.
  Future<ResultatRecherche> rechercher(String metier) async {
    final donnees = await _appeler('/api/recherche?metier=${Uri.encodeQueryComponent(metier)}');
    return _interpreter(() => ResultatRecherche.depuisJson(donnees));
  }

  /// Mes jetons, formules par le serveur.
  Future<MesJetons> mesJetons() async {
    final donnees = await _appeler('/api/mes-jetons');
    return _interpreter(() => MesJetons.depuisJson(donnees));
  }

  /// Seule la quantite part : le prix est relu par le serveur.
  Future<TexteDuServeur> demanderPack(int quantite) async {
    final donnees = await _appeler('/api/mes-jetons/acheter', corps: {'quantite': quantite});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// Mon compte : les sommes, leurs etats et leurs dates, formules par le serveur.
  Future<MonCompte> monCompte() async {
    final donnees = await _appeler('/api/mon-compte');
    return _interpreter(() => MonCompte.depuisJson(donnees));
  }

  /// Mon profil, formule par le serveur.
  Future<MonProfil> monProfil() async {
    final donnees = await _appeler('/api/mon-profil');
    return _interpreter(() => MonProfil.depuisJson(donnees));
  }

  /// Les chiffres des pages de presentation. Aucune session.
  Future<Presentation> presentation() async {
    final donnees = await _appeler('/api/presentation');
    return _interpreter(() => Presentation.depuisJson(donnees));
  }

  /// Creer un compte. Aucune session : le compte n'existe pas encore.
  Future<FormulaireInscription> formulaireInscription() async {
    final donnees = await _appeler('/api/inscription');
    return _interpreter(() => FormulaireInscription.depuisJson(donnees));
  }

  Future<InscriptionFaite> inscrire(Map<String, dynamic> champs) async {
    final donnees = await _appeler('/api/inscription', corps: champs);
    return _interpreter(() => InscriptionFaite.depuisJson(donnees));
  }

  /// La verification d'identite, ecrite par le serveur.
  Future<DossierDeVerification> verification() async {
    final donnees = await _appeler('/api/verification');
    return _interpreter(() => DossierDeVerification.depuisJson(donnees));
  }

  /// Les deux documents d'identite ("cni" et "casier"), comme le formulaire
  /// du site les envoie.
  Future<TexteDuServeur> envoyerDocuments(Map<String, DocumentAEnvoyer> documents) async {
    final donnees = await _envoyerFichiers('/api/verification', documents);
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// Le formulaire Modifier mon profil, rempli par le serveur.
  Future<FormulaireProfil> formulaireProfil() async {
    final donnees = await _appeler('/api/mon-profil/modification');
    return _interpreter(() => FormulaireProfil.depuisJson(donnees));
  }

  Future<TexteDuServeur> enregistrerProfil(Map<String, dynamic> champs) async {
    final donnees = await _appeler('/api/mon-profil', corps: champs);
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// Le mot de passe actuel est exige : le serveur le verifie.
  Future<AdresseChangee> changerEmail(String nouveau, String motdepasse) async {
    final donnees = await _appeler('/api/mon-profil/email', corps: {'nouveau': nouveau, 'motdepasse': motdepasse});
    return _interpreter(() => AdresseChangee.depuisJson(donnees));
  }

  Future<TexteDuServeur> changerMotDePasse(String ancien, String nouveau) async {
    final donnees = await _appeler('/api/mon-profil/mot-de-passe', corps: {'ancien': ancien, 'nouveau': nouveau});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// Le detail d'un tarif pendant la saisie : la commission reste au serveur.
  Future<TarifDuProfil> detailTarif(String montant) async {
    final donnees = await _appeler('/api/detail-tarif?montant=${Uri.encodeQueryComponent(montant)}');
    return _interpreter(() => TarifDuProfil.depuisJson(donnees));
  }

  /// "J'ai lu" sous le message de l'equipe.
  Future<void> marquerMessageEquipeLu() async {
    await _appeler('/api/mon-profil/message-equipe/lu', corps: const {});
  }

  /// "J'ai lu cet avertissement".
  Future<void> marquerAvertissementLu() async {
    await _appeler('/api/mon-profil/avertissement/lu', corps: const {});
  }

  /// La fiche d'une personne, formulee par le serveur.
  Future<FichePersonne> fiche(int personneId) async {
    final donnees = await _appeler('/api/personnes/$personneId');
    return _interpreter(() => FichePersonne.depuisJson(donnees));
  }

  Future<FormulaireProbleme> formulaireProbleme(int discussionId) async {
    final donnees = await _appeler('/api/discussions/$discussionId/probleme');
    return _interpreter(() => FormulaireProbleme.depuisJson(donnees));
  }

  Future<TexteDuServeur> signalerProbleme(int discussionId, String texte) async {
    final donnees = await _appeler('/api/discussions/$discussionId/probleme', corps: {'texte': texte});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// La liste Mes messages, deja rangee et formulee par le serveur.
  Future<MesDiscussions> mesDiscussions() async {
    final donnees = await _appeler('/api/discussions');
    return _interpreter(() => MesDiscussions.depuisJson(donnees));
  }

  /// Ouvrir une discussion, c'est l'avoir lue : le serveur le note.
  Future<Discussion> discussion(int discussionId) async {
    final donnees = await _appeler('/api/discussions/$discussionId');
    return _interpreter(() => Discussion.depuisJson(donnees));
  }

  Future<void> envoyerMessage(int discussionId, String texte) async {
    final donnees = await _appeler('/api/discussions/$discussionId/messages', corps: {'texte': texte});
    _interpreter(() => ActionFaite.depuisJson(donnees));
  }

  Future<void> signalerMessage(int discussionId, int messageId) async {
    final donnees = await _appeler(
      '/api/discussions/$discussionId/messages/$messageId/signaler',
      corps: const {},
    );
    _interpreter(() => ActionFaite.depuisJson(donnees));
  }

  /// Declarer le service effectue : le serveur clot la discussion et verse
  /// la somme bloquee a la personne qui a travaille.
  /// Les reponses de la personne, et ou elles en sont.
  Future<MesReponses> mesReponses() async {
    final donnees = await _appeler('/api/mes-reponses');
    return _interpreter(() => MesReponses.depuisJson(donnees));
  }

  /// "J'ai effectue ce service" : une trace datee, qui ne verse rien.
  Future<TexteDuServeur> declarerAvoirTravaille(int candidatureId) async {
    final donnees = await _appeler('/api/candidatures/$candidatureId/jai-effectue', corps: const {});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  Future<void> declarerServiceEffectue(int candidatureId) async {
    final donnees = await _appeler('/api/candidatures/$candidatureId/terminer', corps: const {});
    _interpreter(() => ActionFaite.depuisJson(donnees));
  }

  /// Le formulaire Donner mon avis, apres un service termine.
  Future<FormulaireAvis> formulaireAvis(int candidatureId) async {
    final donnees = await _appeler('/api/avis/$candidatureId');
    return _interpreter(() => FormulaireAvis.depuisJson(donnees));
  }

  /// Publie l'avis tel que la personne l'a saisi : c'est le serveur qui
  /// verifie, et qui explique un refus.
  Future<TexteDuServeur> donnerAvis(int candidatureId, Map<String, dynamic> champs) async {
    final donnees = await _appeler('/api/avis/$candidatureId', corps: champs);
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  Future<TexteDuServeur> signalerAvis(int avisId) async {
    final donnees = await _appeler('/api/avis/$avisId/signaler', corps: const {});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  /// Le formulaire de modification, prerempli par le serveur.
  Future<ModificationDemande> modificationDemande(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/modification');
    return _interpreter(() => ModificationDemande.depuisJson(donnees));
  }

  Future<TexteDuServeur> modifierDemande(int demandeId, Map<String, String> champs) async {
    final donnees = await _appeler('/api/demandes/$demandeId', corps: champs);
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  Future<InfoMiseEnAvant> infoMiseEnAvant(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/mise-en-avant');
    return _interpreter(() => InfoMiseEnAvant.depuisJson(donnees));
  }

  /// Le serveur preleve les jetons et pose la date, ou refuse en disant
  /// pourquoi.
  Future<TexteDuServeur> mettreEnAvant(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/mise-en-avant', corps: const {});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  Future<TexteDuServeur> retirerDemande(int demandeId) async {
    final donnees = await _appeler('/api/demandes/$demandeId/retirer', corps: const {});
    return _interpreter(() => TexteDuServeur.depuisJson(donnees));
  }

  Future<void> _decider(int candidatureId, String decision) async {
    final donnees = await _appeler('/api/candidatures/$candidatureId/$decision', corps: const {});
    _interpreter(() => DecisionPrise.depuisJson(donnees));
  }

  /// La session est effacee cote serveur. Meme si le serveur ne repond pas,
  /// l'application oublie le jeton : la personne a demande a partir.
  Future<void> deconnexion() async {
    try {
      await _appeler('/api/deconnexion', corps: const {});
    } on ErreurApi {
      // Rien de plus a faire : le jeton est oublie juste en dessous.
    } finally {
      _jeton = null;
    }
  }

  Future<Map<String, dynamic>> _appeler(String chemin, {Map<String, dynamic>? corps}) async {
    final uri = Uri.tryParse('$racine$chemin');
    if (uri == null || uri.host.isEmpty) {
      throw const ErreurApi("Cette adresse de serveur n'est pas valide.", adresseEnCause: true);
    }

    final entetes = {
      'Content-Type': 'application/json',
      if (_jeton != null) 'Authorization': 'Bearer $_jeton',
    };

    final http.Response reponse;
    try {
      final envoi = corps == null
          ? http.get(uri, headers: entetes)
          : http.post(uri, headers: entetes, body: jsonEncode(corps));
      reponse = await envoi.timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    } on SocketException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    } on http.ClientException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    } on HandshakeException {
      throw const ErreurApi("Cette adresse attend une connexion sécurisée, "
          "mais le serveur PamConnect s'ouvre en http://.", adresseEnCause: true);
    }

    return _lireReponse(reponse);
  }

  /// Des fichiers en multipart, comme un formulaire du site avec
  /// enctype="multipart/form-data". Le delai est plus long : deux photos
  /// peuvent peser plusieurs Mo.
  Future<Map<String, dynamic>> _envoyerFichiers(String chemin, Map<String, DocumentAEnvoyer> documents) async {
    final uri = Uri.tryParse('$racine$chemin');
    if (uri == null || uri.host.isEmpty) {
      throw const ErreurApi("Cette adresse de serveur n'est pas valide.", adresseEnCause: true);
    }

    final requete = http.MultipartRequest('POST', uri);
    final jeton = _jeton;
    if (jeton != null) requete.headers['Authorization'] = 'Bearer $jeton';
    documents.forEach((champ, document) {
      requete.files.add(http.MultipartFile(champ, document.lire(), document.taille, filename: document.nom));
    });

    final http.Response reponse;
    try {
      final envoye = await requete.send().timeout(const Duration(minutes: 2));
      reponse = await http.Response.fromStream(envoye).timeout(const Duration(minutes: 2));
    } on TimeoutException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    } on SocketException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    } on FileSystemException {
      throw const ErreurApi("Un document n'a pas pu être lu sur le téléphone. Choisissez-le de nouveau.");
    } on http.ClientException {
      throw const ErreurApi(_injoignable, adresseEnCause: true);
    }
    return _lireReponse(reponse);
  }

  Map<String, dynamic> _lireReponse(http.Response reponse) {
    // Toute reponse de l'API est du JSON, les erreurs comprises. Une page
    // HTML veut dire que l'adresse mene ailleurs.
    final Map<String, dynamic> donnees;
    try {
      final decode = jsonDecode(utf8.decode(reponse.bodyBytes));
      if (decode is! Map<String, dynamic>) throw const FormatException();
      donnees = decode;
    } on FormatException {
      throw ErreurApi(
        'Cette adresse répond, mais pas comme le serveur PamConnect.',
        code: reponse.statusCode,
        adresseEnCause: true,
      );
    }

    if (reponse.statusCode >= 400) {
      final message = donnees['erreur'];
      throw ErreurApi(
        message is String ? message : 'Le serveur a refusé la demande.',
        code: reponse.statusCode,
        proposeVerification: donnees['verification'] == true,
      );
    }
    return donnees;
  }

  T _interpreter<T>(T Function() lecture) {
    try {
      return lecture();
    } on FormeInattendue {
      throw const ErreurApi("Le serveur a répondu sous une forme inattendue. Il date "
          "peut-être d'avant la dernière mise à jour : relancez npm start sur "
          "l'ordinateur.");
    }
  }
}
