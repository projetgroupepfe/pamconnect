/// La forme des donnees que renvoie l'API du serveur.
///
/// AUCUNE REGLE ICI : ces classes ne font que LIRE ce que le serveur a
/// decide. Le prix arrive deja ecrit en toutes lettres, le tri par metier
/// est deja fait. Si une reponse n'a pas la forme attendue, on le signale
/// au lieu de deviner une valeur.
library;

/// Levee quand un champ attendu manque ou n'a pas le bon type.
class FormeInattendue implements Exception {
  const FormeInattendue(this.champ);

  final String champ;

  @override
  String toString() => 'Champ absent ou invalide : $champ';
}

T _lire<T>(Map<String, dynamic> json, String champ) {
  final valeur = json[champ];
  if (valeur is T) return valeur;
  throw FormeInattendue(champ);
}

T? _lireFacultatif<T>(Map<String, dynamic> json, String champ) {
  final valeur = json[champ];
  if (valeur == null) return null;
  if (valeur is T) return valeur;
  throw FormeInattendue(champ);
}

/// Le solde de jetons, detaille : les jetons offerts perissent, les achetes
/// jamais. Ne garder que le total cacherait ce qui va disparaitre.
class Jetons {
  const Jetons({required this.offerts, required this.achetes, required this.total});

  factory Jetons.depuisJson(Map<String, dynamic> json) => Jetons(
        offerts: _lire<int>(json, 'offerts'),
        achetes: _lire<int>(json, 'achetes'),
        total: _lire<int>(json, 'total'),
      );

  final int offerts;
  final int achetes;
  final int total;
}

/// La personne connectee.
class Moi {
  const Moi({required this.id, required this.nom, required this.role, required this.jetons});

  factory Moi.depuisJson(Map<String, dynamic> json) => Moi(
        id: _lire<int>(json, 'id'),
        nom: _lire<String>(json, 'nom'),
        role: _lire<String>(json, 'role'),
        jetons: Jetons.depuisJson(_lire<Map<String, dynamic>>(json, 'jetons')),
      );

  /// La reponse de /api/moi : { "moi": { ... } }.
  factory Moi.depuisReponse(Map<String, dynamic> json) =>
      Moi.depuisJson(_lire<Map<String, dynamic>>(json, 'moi'));

  final int id;
  final String nom;
  final String role;
  final Jetons jetons;

  /// La premiere version de l'application sert les personnes qui repondent
  /// aux demandes. Ce n'est PAS un droit accorde ici : le serveur refuse de
  /// lui-meme ce qu'un role ne peut pas faire. C'est seulement le choix de
  /// l'ecran a montrer.
  bool get repondAuxDemandes => role == 'prestataire';
}

/// Ce que renvoie /api/connexion : la session, et la personne.
class Connexion {
  const Connexion({required this.jeton, required this.moi});

  factory Connexion.depuisJson(Map<String, dynamic> json) => Connexion(
        jeton: _lire<String>(json, 'jeton'),
        moi: Moi.depuisJson(_lire<Map<String, dynamic>>(json, 'moi')),
      );

  final String jeton;
  final Moi moi;
}

/// Une demande ouverte, telle que la montre la liste publique.
class Demande {
  const Demande({
    required this.id,
    required this.titre,
    required this.misEnAvant,
    this.quartier,
    this.arrondissement,
    this.horaire,
    this.prixLisible,
  });

  factory Demande.depuisJson(Map<String, dynamic> json) => Demande(
        id: _lire<int>(json, 'id'),
        titre: _lire<String>(json, 'titre'),
        misEnAvant: _lire<bool>(json, 'misEnAvant'),
        quartier: _lireFacultatif<String>(json, 'quartier'),
        arrondissement: _lireFacultatif<String>(json, 'arrondissement'),
        horaire: _lireFacultatif<String>(json, 'horaire'),
        prixLisible: _lireFacultatif<String>(json, 'prixLisible'),
      );

  final int id;
  final String titre;
  final bool misEnAvant;
  final String? quartier;
  final String? arrondissement;
  final String? horaire;
  final String? prixLisible;

  /// "Manguier, Yaounde 1" : seulement ce qui est connu. Une demande sans
  /// quartier n'en recoit pas un invente a sa place.
  String? get lieu {
    final parties = [quartier, arrondissement]
        .whereType<String>()
        .where((partie) => partie.trim().isNotEmpty)
        .toList();
    return parties.isEmpty ? null : parties.join(', ');
  }
}

/// La reponse de /api/demandes, dans l'ordre decide par le serveur.
class ListeDemandes {
  const ListeDemandes({required this.pourMoi, required this.autres});

  factory ListeDemandes.depuisJson(Map<String, dynamic> json) => ListeDemandes(
        pourMoi: _lireDemandes(json, 'pourMoi'),
        autres: _lireDemandes(json, 'autres'),
      );

  /// Les demandes du metier de la personne.
  final List<Demande> pourMoi;

  /// Toutes les autres, qui restent visibles.
  final List<Demande> autres;

  bool get vide => pourMoi.isEmpty && autres.isEmpty;
}

List<Demande> _lireDemandes(Map<String, dynamic> json, String champ) {
  return _lire<List<dynamic>>(json, champ).map((element) {
    if (element is Map<String, dynamic>) return Demande.depuisJson(element);
    throw FormeInattendue(champ);
  }).toList();
}
