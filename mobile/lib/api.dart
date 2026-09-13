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
  const ErreurApi(this.message, {this.code});

  final String message;
  final int? code;

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
      throw const ErreurApi("Cette adresse de serveur n'est pas valide.");
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
      throw const ErreurApi(_injoignable);
    } on SocketException {
      throw const ErreurApi(_injoignable);
    } on http.ClientException {
      throw const ErreurApi(_injoignable);
    } on HandshakeException {
      throw const ErreurApi("Cette adresse attend une connexion sécurisée, "
          "mais le serveur PamConnect s'ouvre en http://.");
    }

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
      );
    }

    if (reponse.statusCode >= 400) {
      final message = donnees['erreur'];
      throw ErreurApi(
        message is String ? message : 'Le serveur a refusé la demande.',
        code: reponse.statusCode,
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
