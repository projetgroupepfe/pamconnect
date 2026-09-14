/// La forme des donnees que renvoie l'API du serveur.
///
/// AUCUNE REGLE ICI : ces classes ne font que LIRE ce que le serveur a
/// decide. Le prix arrive deja ecrit en toutes lettres, le tri par metier
/// est deja fait, les boutons a proposer sont deja choisis. Si une reponse
/// n'a pas la forme attendue, on le signale au lieu de deviner une valeur.
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

List<T> _lireListe<T>(
  Map<String, dynamic> json,
  String champ,
  T Function(Map<String, dynamic>) lecture,
) {
  return _lire<List<dynamic>>(json, champ).map((element) {
    if (element is Map<String, dynamic>) return lecture(element);
    throw FormeInattendue(champ);
  }).toList();
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

  /// Ces deux questions choisissent l'ecran d'arrivee, comme le menu du
  /// site. Ce ne sont PAS des droits accordes ici : le serveur refuse de
  /// lui-meme ce qu'un role ne peut pas faire.
  bool get repondAuxDemandes => role == 'prestataire';
  bool get publieDesDemandes => role == 'employeur';
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
        pourMoi: _lireListe(json, 'pourMoi', Demande.depuisJson),
        autres: _lireListe(json, 'autres', Demande.depuisJson),
      );

  /// Les demandes du metier de la personne.
  final List<Demande> pourMoi;

  /// Toutes les autres, qui restent visibles.
  final List<Demande> autres;

  bool get vide => pourMoi.isEmpty && autres.isEmpty;
}

/// La note d'une personne, deja formulee par le serveur (notePersonne) :
/// le telephone dit exactement ce que dit le site.
class NotePersonne {
  const NotePersonne({required this.etat, required this.badge, required this.detail});

  factory NotePersonne.depuisJson(Map<String, dynamic> json) => NotePersonne(
        etat: _lire<String>(json, 'etat'),
        badge: _lire<String>(json, 'badge'),
        detail: _lire<String>(json, 'detail'),
      );

  final String etat;
  final String badge;
  final String detail;

  bool get notee => etat == 'notee';
}

/// Une reponse recue par l'employeur, avec les decisions du serveur.
class ReponseRecue {
  const ReponseRecue({
    required this.id,
    required this.prestataireId,
    required this.nom,
    required this.phrase,
    required this.verification,
    required this.libelleVerification,
    required this.note,
    required this.peutChoisir,
    required this.peutRefuser,
    required this.attendVerification,
    required this.libelleDiscussion,
    this.experience,
    this.disponibilites,
  });

  factory ReponseRecue.depuisJson(Map<String, dynamic> json) => ReponseRecue(
        id: _lire<int>(json, 'id'),
        prestataireId: _lire<int>(json, 'prestataireId'),
        nom: _lire<String>(json, 'nom'),
        phrase: _lire<String>(json, 'phrase'),
        verification: _lire<String>(json, 'verification'),
        libelleVerification: _lire<String>(json, 'libelleVerification'),
        note: NotePersonne.depuisJson(_lire<Map<String, dynamic>>(json, 'note')),
        peutChoisir: _lire<bool>(json, 'peutChoisir'),
        peutRefuser: _lire<bool>(json, 'peutRefuser'),
        attendVerification: _lire<bool>(json, 'attendVerification'),
        libelleDiscussion: _lire<String>(json, 'libelleDiscussion'),
        experience: _lireFacultatif<String>(json, 'experience'),
        disponibilites: _lireFacultatif<String>(json, 'disponibilites'),
      );

  final int id;
  final int prestataireId;
  final String nom;

  /// "En attente de votre decision", "Vous avez choisi quelqu'un d'autre"...
  final String phrase;

  /// Le code ("verifie", "en attente"...) sert seulement a choisir la couleur
  /// de l'etiquette ; le texte affiche est libelleVerification.
  final String verification;
  final String libelleVerification;
  final NotePersonne note;
  final bool peutChoisir;
  final bool peutRefuser;
  final bool attendVerification;

  /// "Discuter", ou "Relire la discussion" une fois le service termine.
  final String libelleDiscussion;
  final String? experience;
  final String? disponibilites;
}

/// Une demande publiee par l'employeur, avec ses reponses.
class DemandePubliee {
  const DemandePubliee({
    required this.id,
    required this.titre,
    required this.horaire,
    required this.fermee,
    required this.enAvant,
    required this.peutModifier,
    required this.peutMettreEnAvant,
    required this.peutRetirer,
    required this.reponses,
    this.metier,
    this.prixLisible,
    this.dureeEstimee,
    this.lieu,
    this.phraseFermeture,
    this.enAvantJusquAu,
  });

  factory DemandePubliee.depuisJson(Map<String, dynamic> json) => DemandePubliee(
        id: _lire<int>(json, 'id'),
        titre: _lire<String>(json, 'titre'),
        horaire: _lire<String>(json, 'horaire'),
        fermee: _lire<bool>(json, 'fermee'),
        enAvant: _lire<bool>(json, 'enAvant'),
        peutModifier: _lire<bool>(json, 'peutModifier'),
        peutMettreEnAvant: _lire<bool>(json, 'peutMettreEnAvant'),
        peutRetirer: _lire<bool>(json, 'peutRetirer'),
        reponses: _lireListe(json, 'candidatures', ReponseRecue.depuisJson),
        metier: _lireFacultatif<String>(json, 'metier'),
        prixLisible: _lireFacultatif<String>(json, 'prixLisible'),
        dureeEstimee: _lireFacultatif<String>(json, 'dureeEstimee'),
        lieu: _lireFacultatif<String>(json, 'lieu'),
        phraseFermeture: _lireFacultatif<String>(json, 'phraseFermeture'),
        enAvantJusquAu: _lireFacultatif<String>(json, 'enAvantJusquAu'),
      );

  final int id;
  final String titre;
  final String horaire;
  final bool fermee;
  final bool enAvant;
  final bool peutModifier;
  final bool peutMettreEnAvant;
  final bool peutRetirer;
  final List<ReponseRecue> reponses;
  final String? metier;
  final String? prixLisible;
  final String? dureeEstimee;
  final String? lieu;

  /// "Vous avez choisi quelqu'un." ou "Vous avez retire cette demande."
  final String? phraseFermeture;
  final String? enAvantJusquAu;
}

/// La reponse de /api/mes-demandes, deja rangee par le serveur : les
/// demandes en cours d'abord, les demandes fermees ensuite.
class MesDemandes {
  const MesDemandes({required this.demandes});

  factory MesDemandes.depuisJson(Map<String, dynamic> json) =>
      MesDemandes(demandes: _lireListe(json, 'demandes', DemandePubliee.depuisJson));

  final List<DemandePubliee> demandes;

  List<DemandePubliee> get enCours => demandes.where((d) => !d.fermee).toList();
  List<DemandePubliee> get terminees => demandes.where((d) => d.fermee).toList();
}

List<String> _lireTextes(Map<String, dynamic> json, String champ) {
  return _lire<List<dynamic>>(json, champ).map((element) {
    if (element is String) return element;
    throw FormeInattendue(champ);
  }).toList();
}

/// Une facon de compter le prix, dans la liste fermee du serveur.
class UniteTarif {
  const UniteTarif({required this.valeur, required this.libelle});

  factory UniteTarif.depuisJson(Map<String, dynamic> json) => UniteTarif(
        valeur: _lire<String>(json, 'valeur'),
        libelle: _lire<String>(json, 'libelle'),
      );

  /// Ce qui part au serveur : "horaire", "journalier" ou "forfaitaire".
  final String valeur;

  /// Ce que lit la personne : "de l'heure", "par jour"...
  final String libelle;
}

/// Les listes du formulaire de publication, telles que le serveur les
/// connait : ajouter un metier ou un quartier ne demande pas de
/// refabriquer l'application.
class FormulaireDemande {
  const FormulaireDemande({
    required this.metiers,
    required this.quartiers,
    required this.arrondissements,
    required this.unitesTarif,
    required this.uniteParDefaut,
  });

  factory FormulaireDemande.depuisJson(Map<String, dynamic> json) {
    final formulaire = FormulaireDemande(
      metiers: _lireTextes(json, 'metiers'),
      quartiers: _lireTextes(json, 'quartiers'),
      arrondissements: _lireTextes(json, 'arrondissements'),
      unitesTarif: _lireListe(json, 'unitesTarif', UniteTarif.depuisJson),
      uniteParDefaut: _lire<String>(json, 'uniteParDefaut'),
    );
    // La liste deroulante doit pouvoir montrer le choix par defaut : un
    // choix absent de la liste la ferait planter.
    if (!formulaire.unitesTarif.any((unite) => unite.valeur == formulaire.uniteParDefaut)) {
      throw const FormeInattendue('uniteParDefaut');
    }
    return formulaire;
  }

  final List<String> metiers;
  final List<String> quartiers;
  final List<String> arrondissements;
  final List<UniteTarif> unitesTarif;
  final String uniteParDefaut;
}

/// La reponse de /api/quartier : l'arrondissement que le serveur retiendra.
class LieuTrouve {
  const LieuTrouve({required this.connu, this.quartier, this.arrondissement});

  factory LieuTrouve.depuisJson(Map<String, dynamic> json) {
    if (!_lire<bool>(json, 'connu')) return const LieuTrouve(connu: false);
    return LieuTrouve(
      connu: true,
      quartier: _lire<String>(json, 'quartier'),
      arrondissement: _lire<String>(json, 'arrondissement'),
    );
  }

  final bool connu;
  final String? quartier;
  final String? arrondissement;
}

/// La confirmation d'une demande publiee, formulee par le serveur.
class Publication {
  const Publication({required this.id, required this.titre, required this.texte});

  factory Publication.depuisJson(Map<String, dynamic> json) => Publication(
        id: _lire<int>(json, 'id'),
        titre: _lire<String>(json, 'titre'),
        texte: _lire<String>(json, 'texte'),
      );

  final int id;
  final String titre;
  final String texte;
}

/// Ce que paie l'employeur, calcule par le serveur : la commission n'est
/// jamais recalculee dans l'application.
class Paiement {
  const Paiement({
    required this.vousPayez,
    required this.commission,
    required this.pourcentageCommission,
    required this.recoit,
  });

  factory Paiement.depuisJson(Map<String, dynamic> json) => Paiement(
        vousPayez: _lire<String>(json, 'vousPayez'),
        commission: _lire<String>(json, 'commission'),
        pourcentageCommission: _lire<int>(json, 'pourcentageCommission'),
        recoit: _lire<String>(json, 'recoit'),
      );

  final String vousPayez;
  final String commission;
  final int pourcentageCommission;
  final String recoit;
}

/// "2 autres personnes qui attendaient recevront un refus." : le nombre a
/// part, pour l'ecrire en gras comme sur le site.
class RefusAnnonces {
  const RefusAnnonces({required this.nombre, required this.suite});

  factory RefusAnnonces.depuisJson(Map<String, dynamic> json) => RefusAnnonces(
        nombre: _lire<int>(json, 'nombre'),
        suite: _lire<String>(json, 'suite'),
      );

  final int nombre;
  final String suite;
}

/// L'ecran de relecture avant de choisir quelqu'un.
class ConfirmationChoix {
  const ConfirmationChoix({
    required this.candidatureId,
    required this.nom,
    required this.note,
    required this.horaire,
    this.metier,
    this.experience,
    this.service,
    this.duree,
    this.lieu,
    this.conditions,
    this.paiement,
    this.refusAnnonces,
  });

  factory ConfirmationChoix.depuisJson(Map<String, dynamic> json) {
    final paiement = _lireFacultatif<Map<String, dynamic>>(json, 'paiement');
    final refus = _lireFacultatif<Map<String, dynamic>>(json, 'refusAnnonces');
    return ConfirmationChoix(
      candidatureId: _lire<int>(json, 'candidatureId'),
      nom: _lire<String>(json, 'nom'),
      note: NotePersonne.depuisJson(_lire<Map<String, dynamic>>(json, 'note')),
      horaire: _lire<String>(json, 'horaire'),
      metier: _lireFacultatif<String>(json, 'metier'),
      experience: _lireFacultatif<String>(json, 'experience'),
      service: _lireFacultatif<String>(json, 'service'),
      duree: _lireFacultatif<String>(json, 'duree'),
      lieu: _lireFacultatif<String>(json, 'lieu'),
      conditions: _lireFacultatif<String>(json, 'conditions'),
      paiement: paiement == null ? null : Paiement.depuisJson(paiement),
      refusAnnonces: refus == null ? null : RefusAnnonces.depuisJson(refus),
    );
  }

  final int candidatureId;
  final String nom;
  final NotePersonne note;
  final String horaire;
  final String? metier;
  final String? experience;
  final String? service;
  final String? duree;
  final String? lieu;
  final String? conditions;

  /// Absent si la demande n'a pas de prix : l'ecran le dit, sans inventer.
  final Paiement? paiement;

  /// Absent si personne d'autre n'attendait.
  final RefusAnnonces? refusAnnonces;
}

/// La reponse d'une decision. Le serveur dit seulement que c'est fait :
/// Mes demandes se recharge ensuite et montre l'etat qu'il a decide.
class DecisionPrise {
  const DecisionPrise();

  factory DecisionPrise.depuisJson(Map<String, dynamic> json) {
    if (_lire<bool>(json, 'ok') != true) throw const FormeInattendue('ok');
    return const DecisionPrise();
  }
}

/// Une reponse du serveur qui dit seulement que c'est fait.
class ActionFaite {
  const ActionFaite();

  factory ActionFaite.depuisJson(Map<String, dynamic> json) {
    if (_lire<bool>(json, 'ok') != true) throw const FormeInattendue('ok');
    return const ActionFaite();
  }
}

/// Une ligne du prix, formulee par le serveur pour la personne qui lit.
class LignePrix {
  const LignePrix({required this.libelle, required this.montant, required this.fort});

  factory LignePrix.depuisJson(Map<String, dynamic> json) => LignePrix(
        libelle: _lire<String>(json, 'libelle'),
        montant: _lire<String>(json, 'montant'),
        fort: _lire<bool>(json, 'fort'),
      );

  final String libelle;
  final String montant;
  final bool fort;
}

/// Le prix de la demande vu depuis la discussion.
class PrixDiscussion {
  const PrixDiscussion({required this.lignes, required this.phrase});

  factory PrixDiscussion.depuisJson(Map<String, dynamic> json) => PrixDiscussion(
        lignes: _lireListe(json, 'lignes', LignePrix.depuisJson),
        phrase: _lire<String>(json, 'phrase'),
      );

  /// Vide pour une demande publiee avant que le prix soit obligatoire.
  final List<LignePrix> lignes;
  final String phrase;
}

class MessageDiscussion {
  const MessageDiscussion({
    required this.id,
    required this.deMoi,
    required this.auteur,
    required this.quand,
    required this.texte,
    required this.risquePaiement,
    required this.signale,
    required this.peutSignaler,
  });

  factory MessageDiscussion.depuisJson(Map<String, dynamic> json) => MessageDiscussion(
        id: _lire<int>(json, 'id'),
        deMoi: _lire<bool>(json, 'deMoi'),
        auteur: _lire<String>(json, 'auteur'),
        quand: _lire<String>(json, 'quand'),
        texte: _lire<String>(json, 'texte'),
        risquePaiement: _lire<bool>(json, 'risquePaiement'),
        signale: _lire<bool>(json, 'signale'),
        peutSignaler: _lire<bool>(json, 'peutSignaler'),
      );

  final int id;
  final bool deMoi;

  /// "Vous", ou le nom de l'autre personne.
  final String auteur;
  final String quand;
  final String texte;
  final bool risquePaiement;
  final bool signale;
  final bool peutSignaler;
}

/// Qui a declare le service effectue, et quand.
class DateDeclaree {
  const DateDeclaree({required this.nom, required this.le});

  factory DateDeclaree.depuisJson(Map<String, dynamic> json, String champNom) => DateDeclaree(
        nom: _lire<String>(json, champNom),
        le: _lire<String>(json, 'le'),
      );

  final String nom;
  final String le;
}

/// La reponse de /api/discussions/:id.
class Discussion {
  const Discussion({
    required this.id,
    required this.titreDemande,
    required this.avec,
    required this.horaire,
    required this.phraseStatut,
    required this.prix,
    required this.messages,
    required this.peutEcrire,
    required this.exempleMessage,
    required this.conseilEcriture,
    required this.peutDeclarerService,
    this.metierAutre,
    this.lieu,
    this.conditions,
    this.serviceTermine,
    this.declarationDeLaPersonne,
  });

  factory Discussion.depuisJson(Map<String, dynamic> json) {
    final termine = _lireFacultatif<Map<String, dynamic>>(json, 'serviceTermine');
    final declaration = _lireFacultatif<Map<String, dynamic>>(json, 'declarationDeLaPersonne');
    return Discussion(
      id: _lire<int>(json, 'id'),
      titreDemande: _lire<String>(json, 'titreDemande'),
      avec: _lire<String>(json, 'avec'),
      horaire: _lire<String>(json, 'horaire'),
      phraseStatut: _lire<String>(json, 'phraseStatut'),
      prix: PrixDiscussion.depuisJson(_lire<Map<String, dynamic>>(json, 'prix')),
      messages: _lireListe(json, 'messages', MessageDiscussion.depuisJson),
      peutEcrire: _lire<bool>(json, 'peutEcrire'),
      exempleMessage: _lire<String>(json, 'exempleMessage'),
      conseilEcriture: _lire<String>(json, 'conseilEcriture'),
      peutDeclarerService: _lire<bool>(json, 'peutDeclarerService'),
      metierAutre: _lireFacultatif<String>(json, 'metierAutre'),
      lieu: _lireFacultatif<String>(json, 'lieu'),
      conditions: _lireFacultatif<String>(json, 'conditions'),
      serviceTermine: termine == null ? null : DateDeclaree.depuisJson(termine, 'par'),
      declarationDeLaPersonne: declaration == null ? null : DateDeclaree.depuisJson(declaration, 'nom'),
    );
  }

  final int id;
  final String titreDemande;

  /// L'autre personne de la discussion.
  final String avec;
  final String horaire;
  final String phraseStatut;
  final PrixDiscussion prix;
  final List<MessageDiscussion> messages;
  final bool peutEcrire;
  final String exempleMessage;

  /// Ce que l'on conseille d'ecrire, formule par le serveur.
  final String conseilEcriture;

  /// L'employeur, une fois quelqu'un choisi, et une seule fois.
  final bool peutDeclarerService;
  final String? metierAutre;
  final String? lieu;
  final String? conditions;

  /// Present une fois le service declare effectue : on relit, on n'ecrit plus.
  final DateDeclaree? serviceTermine;

  /// Present pour l'employeur quand la personne dit avoir travaille.
  final DateDeclaree? declarationDeLaPersonne;
}
