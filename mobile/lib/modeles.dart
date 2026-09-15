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
  const Moi({
    required this.id,
    required this.nom,
    required this.role,
    required this.jetons,
    this.aVoir = 0,
    this.aLire = 0,
  });

  factory Moi.depuisJson(Map<String, dynamic> json) => Moi(
        id: _lire<int>(json, 'id'),
        nom: _lire<String>(json, 'nom'),
        role: _lire<String>(json, 'role'),
        jetons: Jetons.depuisJson(_lire<Map<String, dynamic>>(json, 'jetons')),
        aVoir: _lireFacultatif<int>(json, 'aVoir') ?? 0,
        aLire: _lireFacultatif<int>(json, 'aLire') ?? 0,
      );

  /// La reponse de /api/moi : { "moi": { ... } }.
  factory Moi.depuisReponse(Map<String, dynamic> json) =>
      Moi.depuisJson(_lire<Map<String, dynamic>>(json, 'moi'));

  final int id;
  final String nom;
  final String role;
  final Jetons jetons;

  /// Les messages non lus et les decisions pas encore vues : la pastille
  /// de Messages.
  final int aVoir;

  /// Un message de l'equipe ou un avertissement pas encore lu : la pastille
  /// de Mon profil.
  final int aLire;

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
    this.metier,
    this.dureeEstimee,
    this.conditions,
  });

  factory Demande.depuisJson(Map<String, dynamic> json) => Demande(
        id: _lire<int>(json, 'id'),
        titre: _lire<String>(json, 'titre'),
        misEnAvant: _lire<bool>(json, 'misEnAvant'),
        quartier: _lireFacultatif<String>(json, 'quartier'),
        arrondissement: _lireFacultatif<String>(json, 'arrondissement'),
        horaire: _lireFacultatif<String>(json, 'horaire'),
        prixLisible: _lireFacultatif<String>(json, 'prixLisible'),
        metier: _lireFacultatif<String>(json, 'metier'),
        dureeEstimee: _lireFacultatif<String>(json, 'dureeEstimee'),
        conditions: _lireFacultatif<String>(json, 'conditions'),
      );

  final int id;
  final String titre;
  final bool misEnAvant;
  final String? quartier;
  final String? arrondissement;
  final String? horaire;
  final String? prixLisible;
  final String? metier;
  final String? dureeEstimee;

  /// Ce qu'il faut savoir avant de venir, comme sur la carte du site.
  final String? conditions;

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
  const ListeDemandes({required this.pourMoi, required this.autres, this.monMetier});

  factory ListeDemandes.depuisJson(Map<String, dynamic> json) => ListeDemandes(
        pourMoi: _lireListe(json, 'pourMoi', Demande.depuisJson),
        autres: _lireListe(json, 'autres', Demande.depuisJson),
        monMetier: _lireFacultatif<String>(json, 'monMetier'),
      );

  /// Le metier de la personne, pour le titre "Pour vous : ...".
  final String? monMetier;

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
    required this.prestataireId,
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
      prestataireId: _lire<int>(json, 'prestataireId'),
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

  /// Pour ouvrir sa fiche.
  final int prestataireId;
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
  const LignePrix({
    required this.libelle,
    required this.montant,
    required this.fort,
    this.retenue = false,
    this.total = false,
  });

  factory LignePrix.depuisJson(Map<String, dynamic> json) => LignePrix(
        libelle: _lire<String>(json, 'libelle'),
        montant: _lire<String>(json, 'montant'),
        fort: _lire<bool>(json, 'fort'),
        retenue: _lireFacultatif<bool>(json, 'retenue') ?? false,
        total: _lireFacultatif<bool>(json, 'total') ?? false,
      );

  final String libelle;
  final String montant;
  final bool fort;

  /// La commission : en orange, comme sur le site.
  final bool retenue;

  /// Le montant recu : en vert, sous un trait.
  final bool total;

  LigneTarif enLigneTarif() => LigneTarif(libelle: libelle, montant: montant, retenue: retenue, total: total);
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
    this.maDeclaration,
    this.avis,
  });

  factory Discussion.depuisJson(Map<String, dynamic> json) {
    final termine = _lireFacultatif<Map<String, dynamic>>(json, 'serviceTermine');
    final declaration = _lireFacultatif<Map<String, dynamic>>(json, 'declarationDeLaPersonne');
    final avis = _lireFacultatif<Map<String, dynamic>>(json, 'avis');
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
      maDeclaration: _lireObjet(json, 'maDeclaration', MaDeclaration.depuisJson),
      avis: avis == null ? null : AvisDuService.depuisJson(avis),
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

  /// Pour la personne choisie : dire qu'elle a effectue le service, ou
  /// relire qu'elle l'a deja dit.
  final MaDeclaration? maDeclaration;

  /// Present une fois le service termine : les avis donnes et recus.
  final AvisDuService? avis;
}

/// Une note de l'echelle : "5 sur 5, Excellent".
class NiveauNote {
  const NiveauNote({required this.note, required this.libelle});

  factory NiveauNote.depuisJson(Map<String, dynamic> json) => NiveauNote(
        note: _lire<int>(json, 'note'),
        libelle: _lire<String>(json, 'libelle'),
      );

  final int note;
  final String libelle;
}

/// Un critere facultatif, propre au role de la personne qui note.
class CritereAvis {
  const CritereAvis({required this.cle, required this.libelle});

  factory CritereAvis.depuisJson(Map<String, dynamic> json) => CritereAvis(
        cle: _lire<String>(json, 'cle'),
        libelle: _lire<String>(json, 'libelle'),
      );

  /// Ce qui part au serveur : "critere1"...
  final String cle;
  final String libelle;
}

/// Le formulaire Donner mon avis, tel que le serveur le decrit.
class FormulaireAvis {
  const FormulaireAvis({
    required this.nomVise,
    required this.titreDemande,
    required this.echelle,
    required this.criteres,
    required this.exempleCommentaire,
    required this.commentaireMax,
  });

  factory FormulaireAvis.depuisJson(Map<String, dynamic> json) => FormulaireAvis(
        nomVise: _lire<String>(json, 'nomVise'),
        titreDemande: _lire<String>(json, 'titreDemande'),
        echelle: _lireListe(json, 'echelle', NiveauNote.depuisJson),
        criteres: _lireListe(json, 'criteres', CritereAvis.depuisJson),
        exempleCommentaire: _lire<String>(json, 'exempleCommentaire'),
        commentaireMax: _lire<int>(json, 'commentaireMax'),
      );

  final String nomVise;
  final String titreDemande;
  final List<NiveauNote> echelle;
  final List<CritereAvis> criteres;
  final String exempleCommentaire;
  final int commentaireMax;
}

/// L'avis que la personne connectee a donne.
class MonAvis {
  const MonAvis({
    required this.note,
    required this.publieLe,
    required this.masque,
    this.commentaire,
    this.motifMasquage,
  });

  factory MonAvis.depuisJson(Map<String, dynamic> json) => MonAvis(
        note: _lire<int>(json, 'note'),
        publieLe: _lire<String>(json, 'publieLe'),
        masque: _lire<bool>(json, 'masque'),
        commentaire: _lireFacultatif<String>(json, 'commentaire'),
        motifMasquage: _lireFacultatif<String>(json, 'motifMasquage'),
      );

  final int note;
  final String publieLe;
  final bool masque;
  final String? commentaire;
  final String? motifMasquage;
}

/// L'avis que l'autre personne a ecrit sur la personne connectee.
class AvisRecu {
  const AvisRecu({
    required this.id,
    required this.note,
    required this.auteur,
    required this.masque,
    required this.signale,
    required this.peutSignaler,
    this.commentaire,
  });

  factory AvisRecu.depuisJson(Map<String, dynamic> json) => AvisRecu(
        id: _lire<int>(json, 'id'),
        note: _lire<int>(json, 'note'),
        auteur: _lire<String>(json, 'auteur'),
        masque: _lire<bool>(json, 'masque'),
        signale: _lire<bool>(json, 'signale'),
        peutSignaler: _lire<bool>(json, 'peutSignaler'),
        commentaire: _lireFacultatif<String>(json, 'commentaire'),
      );

  final int id;
  final int note;
  final String auteur;
  final bool masque;
  final bool signale;
  final bool peutSignaler;
  final String? commentaire;
}

/// Les deux avis d'un service termine, chacun absent tant qu'il n'est pas donne.
class AvisDuService {
  const AvisDuService({this.monAvis, this.avisRecu});

  factory AvisDuService.depuisJson(Map<String, dynamic> json) {
    final monAvis = _lireFacultatif<Map<String, dynamic>>(json, 'monAvis');
    final avisRecu = _lireFacultatif<Map<String, dynamic>>(json, 'avisRecu');
    return AvisDuService(
      monAvis: monAvis == null ? null : MonAvis.depuisJson(monAvis),
      avisRecu: avisRecu == null ? null : AvisRecu.depuisJson(avisRecu),
    );
  }

  final MonAvis? monAvis;
  final AvisRecu? avisRecu;
}

/// Une reponse du serveur qui porte seulement sa phrase.
class TexteDuServeur {
  const TexteDuServeur({required this.texte});

  factory TexteDuServeur.depuisJson(Map<String, dynamic> json) =>
      TexteDuServeur(texte: _lire<String>(json, 'texte'));

  final String texte;
}

/// Ce qui est ecrit aujourd'hui dans une demande, pour preremplir le
/// formulaire de modification.
class ValeursDemande {
  const ValeursDemande({
    required this.titre,
    required this.metier,
    required this.horaire,
    required this.quartier,
    required this.prix,
    required this.uniteTarif,
    required this.dureeEstimee,
    required this.conditions,
    this.arrondissement,
  });

  factory ValeursDemande.depuisJson(Map<String, dynamic> json) => ValeursDemande(
        titre: _lire<String>(json, 'titre'),
        metier: _lire<String>(json, 'metier'),
        horaire: _lire<String>(json, 'horaire'),
        quartier: _lire<String>(json, 'quartier'),
        prix: _lire<String>(json, 'prix'),
        uniteTarif: _lire<String>(json, 'unite_tarif'),
        dureeEstimee: _lire<String>(json, 'duree_estimee'),
        conditions: _lire<String>(json, 'conditions'),
        arrondissement: _lireFacultatif<String>(json, 'arrondissement'),
      );

  final String titre;
  final String metier;
  final String horaire;
  final String quartier;
  final String prix;
  final String uniteTarif;
  final String dureeEstimee;
  final String conditions;
  final String? arrondissement;
}

/// "1 personne a deja repondu..." : formule par le serveur.
class AvertissementModification {
  const AvertissementModification({required this.phrase, required this.conseil});

  factory AvertissementModification.depuisJson(Map<String, dynamic> json) => AvertissementModification(
        phrase: _lire<String>(json, 'phrase'),
        conseil: _lire<String>(json, 'conseil'),
      );

  final String phrase;
  final String conseil;
}

/// Le formulaire de modification : les listes de la publication, les
/// valeurs actuelles, et l'avertissement s'il y a lieu.
class ModificationDemande {
  const ModificationDemande({required this.formulaire, required this.valeurs, this.avertissement});

  factory ModificationDemande.depuisJson(Map<String, dynamic> json) {
    final avertissement = _lireFacultatif<Map<String, dynamic>>(json, 'avertissement');
    return ModificationDemande(
      formulaire: FormulaireDemande.depuisJson(json),
      valeurs: ValeursDemande.depuisJson(_lire<Map<String, dynamic>>(json, 'valeurs')),
      avertissement: avertissement == null ? null : AvertissementModification.depuisJson(avertissement),
    );
  }

  final FormulaireDemande formulaire;
  final ValeursDemande valeurs;
  final AvertissementModification? avertissement;
}

/// L'ecran Mettre en avant, deja calcule par le serveur.
class InfoMiseEnAvant {
  const InfoMiseEnAvant({
    required this.titre,
    required this.disponible,
    required this.solde,
    required this.soldeSuffit,
    this.metier,
    this.lieu,
    this.finActuelle,
    this.jours,
    this.cout,
    this.resteApres,
  });

  factory InfoMiseEnAvant.depuisJson(Map<String, dynamic> json) => InfoMiseEnAvant(
        titre: _lire<String>(json, 'titre'),
        disponible: _lire<bool>(json, 'disponible'),
        solde: _lire<String>(json, 'solde'),
        soldeSuffit: _lire<bool>(json, 'soldeSuffit'),
        metier: _lireFacultatif<String>(json, 'metier'),
        lieu: _lireFacultatif<String>(json, 'lieu'),
        finActuelle: _lireFacultatif<String>(json, 'finActuelle'),
        jours: _lireFacultatif<int>(json, 'jours'),
        cout: _lireFacultatif<String>(json, 'cout'),
        resteApres: _lireFacultatif<String>(json, 'resteApres'),
      );

  final String titre;
  final bool disponible;

  /// "12 jetons (1 200 FCFA)" : ecrit par le serveur.
  final String solde;
  final bool soldeSuffit;
  final String? metier;
  final String? lieu;

  /// Present si la demande est deja en avant : jusqu'a quand.
  final String? finActuelle;
  final int? jours;
  final String? cout;
  final String? resteApres;
}

/// Une ligne de la liste Mes messages, formulee par le serveur.
class ResumeDiscussion {
  const ResumeDiscussion({
    required this.id,
    required this.avec,
    required this.titreDemande,
    required this.phraseStatut,
    required this.nouveau,
    required this.phraseMessages,
    required this.avisAttendu,
    this.phraseNonLus,
    this.dernierMessage,
    this.termineeLe,
  });

  factory ResumeDiscussion.depuisJson(Map<String, dynamic> json) => ResumeDiscussion(
        id: _lire<int>(json, 'id'),
        avec: _lire<String>(json, 'avec'),
        titreDemande: _lire<String>(json, 'titreDemande'),
        phraseStatut: _lire<String>(json, 'phraseStatut'),
        nouveau: _lire<bool>(json, 'nouveau'),
        phraseMessages: _lire<String>(json, 'phraseMessages'),
        avisAttendu: _lire<bool>(json, 'avisAttendu'),
        phraseNonLus: _lireFacultatif<String>(json, 'phraseNonLus'),
        dernierMessage: _lireFacultatif<String>(json, 'dernierMessage'),
        termineeLe: _lireFacultatif<String>(json, 'termineeLe'),
      );

  final int id;
  final String avec;
  final String titreDemande;
  final String phraseStatut;
  final bool nouveau;
  final String phraseMessages;
  final bool avisAttendu;
  final String? phraseNonLus;
  final String? dernierMessage;

  /// Present une fois le service termine : la discussion est une archive.
  final String? termineeLe;
}

/// "2 services attendent votre avis." puis la suite de la phrase.
class ChapeauTerminees {
  const ChapeauTerminees({required this.suite, this.fort});

  factory ChapeauTerminees.depuisJson(Map<String, dynamic> json) => ChapeauTerminees(
        suite: _lire<String>(json, 'suite'),
        fort: _lireFacultatif<String>(json, 'fort'),
      );

  final String suite;
  final String? fort;
}

/// Pourquoi la liste est vide, dit selon le role.
class ListeVide {
  const ListeVide({required this.phrase, this.aide});

  factory ListeVide.depuisJson(Map<String, dynamic> json) => ListeVide(
        phrase: _lire<String>(json, 'phrase'),
        aide: _lireFacultatif<String>(json, 'aide'),
      );

  final String phrase;
  final String? aide;
}

/// La reponse de /api/discussions.
class MesDiscussions {
  const MesDiscussions({
    required this.enCours,
    required this.terminees,
    required this.chapeauTerminees,
    required this.aVoir,
    this.vide,
  });

  factory MesDiscussions.depuisJson(Map<String, dynamic> json) {
    final vide = _lireFacultatif<Map<String, dynamic>>(json, 'vide');
    return MesDiscussions(
      enCours: _lireListe(json, 'enCours', ResumeDiscussion.depuisJson),
      terminees: _lireListe(json, 'terminees', ResumeDiscussion.depuisJson),
      chapeauTerminees: ChapeauTerminees.depuisJson(_lire<Map<String, dynamic>>(json, 'chapeauTerminees')),
      aVoir: _lire<int>(json, 'aVoir'),
      vide: vide == null ? null : ListeVide.depuisJson(vide),
    );
  }

  final List<ResumeDiscussion> enCours;
  final List<ResumeDiscussion> terminees;
  final ChapeauTerminees chapeauTerminees;
  final int aVoir;
  final ListeVide? vide;
}

/// Un jour ou la personne est disponible, et ses moments.
class Creneau {
  const Creneau({required this.jour, required this.moments});

  factory Creneau.depuisJson(Map<String, dynamic> json) => Creneau(
        jour: _lire<String>(json, 'jour'),
        moments: _lire<String>(json, 'moments'),
      );

  final String jour;
  final String moments;
}

/// Un avis tel qu'il s'affiche sur une fiche, deja formule.
class AvisPublic {
  const AvisPublic({
    required this.note,
    required this.auteur,
    required this.criteres,
    required this.date,
    this.titreDemande,
    this.commentaire,
    this.id,
    this.signale = false,
  });

  factory AvisPublic.depuisJson(Map<String, dynamic> json) => AvisPublic(
        note: _lire<String>(json, 'note'),
        auteur: _lire<String>(json, 'auteur'),
        criteres: _lireTextes(json, 'criteres'),
        date: _lire<String>(json, 'date'),
        titreDemande: _lireFacultatif<String>(json, 'titreDemande'),
        commentaire: _lireFacultatif<String>(json, 'commentaire'),
        id: _lireFacultatif<int>(json, 'id'),
        signale: _lireFacultatif<bool>(json, 'signale') ?? false,
      );

  final String note;
  final String auteur;
  final List<String> criteres;
  final String date;
  final String? titreDemande;
  final String? commentaire;

  /// Seulement sur son propre profil : on ne signale que les avis qui nous
  /// visent.
  final int? id;
  final bool signale;
}

/// Les avis d'une fiche, ou ceux de Mon profil.
class AvisDeLaFiche {
  const AvisDeLaFiche({required this.nombre, required this.liste, this.moyenne, this.vide});

  factory AvisDeLaFiche.depuisJson(Map<String, dynamic> json) => AvisDeLaFiche(
        nombre: _lire<int>(json, 'nombre'),
        liste: _lireListe(json, 'liste', AvisPublic.depuisJson),
        moyenne: _lireFacultatif<String>(json, 'moyenne'),
        vide: _lireFacultatif<String>(json, 'vide'),
      );

  final int nombre;
  final List<AvisPublic> liste;

  /// Absente tant que personne n'a note : on n'affiche pas "0 sur 5".
  final String? moyenne;

  /// La phrase quand personne n'a encore note, sur Mon profil.
  final String? vide;
}

/// La fiche d'une personne (/api/personnes/:id).
class FichePersonne {
  const FichePersonne({
    required this.id,
    required this.nom,
    required this.verifiee,
    required this.libelleVerification,
    required this.note,
    required this.badges,
    required this.disponibilites,
    required this.tarif,
    required this.avis,
    required this.peutPublier,
    this.metier,
    this.trancheAge,
    this.lieu,
  });

  factory FichePersonne.depuisJson(Map<String, dynamic> json) => FichePersonne(
        id: _lire<int>(json, 'id'),
        nom: _lire<String>(json, 'nom'),
        verifiee: _lire<bool>(json, 'verifiee'),
        libelleVerification: _lire<String>(json, 'libelleVerification'),
        note: NotePersonne.depuisJson(_lire<Map<String, dynamic>>(json, 'note')),
        badges: _lireTextes(json, 'badges'),
        disponibilites: _lireListe(json, 'disponibilites', Creneau.depuisJson),
        tarif: _lire<String>(json, 'tarif'),
        avis: AvisDeLaFiche.depuisJson(_lire<Map<String, dynamic>>(json, 'avis')),
        peutPublier: _lire<bool>(json, 'peutPublier'),
        metier: _lireFacultatif<String>(json, 'metier'),
        trancheAge: _lireFacultatif<String>(json, 'trancheAge'),
        lieu: _lireFacultatif<String>(json, 'lieu'),
      );

  final int id;
  final String nom;
  final bool verifiee;
  final String libelleVerification;
  final NotePersonne note;
  final List<String> badges;
  final List<Creneau> disponibilites;
  final String tarif;
  final AvisDeLaFiche avis;
  final bool peutPublier;
  final String? metier;

  /// Seulement pour l'employeur qui l'a deja embauchee.
  final String? trancheAge;
  final String? lieu;
}

/// Le formulaire Signaler un probleme, avec ses phrases.
class FormulaireProbleme {
  const FormulaireProbleme({
    required this.titreDemande,
    required this.autre,
    required this.dejaSignale,
    required this.consequences,
    required this.apresSignalement,
    required this.texteMax,
  });

  factory FormulaireProbleme.depuisJson(Map<String, dynamic> json) => FormulaireProbleme(
        titreDemande: _lire<String>(json, 'titreDemande'),
        autre: _lire<String>(json, 'autre'),
        dejaSignale: _lire<bool>(json, 'dejaSignale'),
        consequences: _lire<String>(json, 'consequences'),
        apresSignalement: _lire<String>(json, 'apresSignalement'),
        texteMax: _lire<int>(json, 'texteMax'),
      );

  final String titreDemande;

  /// La personne concernee par le signalement.
  final String autre;
  final bool dejaSignale;
  final String consequences;
  final String apresSignalement;
  final int texteMax;
}

T? _lireObjet<T>(Map<String, dynamic> json, String champ, T Function(Map<String, dynamic>) lecture) {
  final objet = _lireFacultatif<Map<String, dynamic>>(json, champ);
  return objet == null ? null : lecture(objet);
}

class MessageDeLEquipe {
  const MessageDeLEquipe({required this.texte, required this.le});

  factory MessageDeLEquipe.depuisJson(Map<String, dynamic> json) => MessageDeLEquipe(
        texte: _lire<String>(json, 'texte'),
        le: _lire<String>(json, 'le'),
      );

  final String texte;
  final String le;
}

class AvertissementDeLEquipe {
  const AvertissementDeLEquipe({required this.motif, required this.le});

  factory AvertissementDeLEquipe.depuisJson(Map<String, dynamic> json) => AvertissementDeLEquipe(
        motif: _lire<String>(json, 'motif'),
        le: _lire<String>(json, 'le'),
      );

  final String motif;
  final String le;
}

class VerificationDuProfil {
  const VerificationDuProfil({required this.statut, required this.libelle, this.attente});

  factory VerificationDuProfil.depuisJson(Map<String, dynamic> json) => VerificationDuProfil(
        statut: _lire<String>(json, 'statut'),
        libelle: _lire<String>(json, 'libelle'),
        attente: _lireFacultatif<String>(json, 'attente'),
      );

  final String statut;
  final String libelle;

  /// Pendant l'examen du dossier : depuis quand, et jusqu'a quand.
  final String? attente;
}

class BadgeDuProfil {
  const BadgeDuProfil({required this.texte, required this.verifie});

  factory BadgeDuProfil.depuisJson(Map<String, dynamic> json) => BadgeDuProfil(
        texte: _lire<String>(json, 'texte'),
        verifie: _lire<bool>(json, 'verifie'),
      );

  final String texte;

  /// Ce que l'equipe a controle, en vert.
  final bool verifie;
}

/// Une ligne du detail d'un tarif : "Vous demandez 15 000 FCFA".
class LigneTarif {
  const LigneTarif({required this.libelle, required this.montant, required this.retenue, required this.total});

  factory LigneTarif.depuisJson(Map<String, dynamic> json) => LigneTarif(
        libelle: _lire<String>(json, 'libelle'),
        montant: _lire<String>(json, 'montant'),
        retenue: _lire<bool>(json, 'retenue'),
        total: _lire<bool>(json, 'total'),
      );

  final String libelle;
  final String montant;

  /// La commission, retiree du montant.
  final bool retenue;
  final bool total;
}

class TarifDuProfil {
  const TarifDuProfil({required this.lignes, this.phrase, this.aide});

  factory TarifDuProfil.depuisJson(Map<String, dynamic> json) => TarifDuProfil(
        lignes: _lireListe(json, 'lignes', LigneTarif.depuisJson),
        phrase: _lireFacultatif<String>(json, 'phrase'),
        aide: _lireFacultatif<String>(json, 'aide'),
      );

  final List<LigneTarif> lignes;

  /// Quand aucun tarif n'est indique.
  final String? phrase;
  final String? aide;
}

class ServicesANoter {
  const ServicesANoter({required this.phrase, required this.suite});

  factory ServicesANoter.depuisJson(Map<String, dynamic> json) => ServicesANoter(
        phrase: _lire<String>(json, 'phrase'),
        suite: _lire<String>(json, 'suite'),
      );

  final String phrase;
  final String suite;
}

/// Mon profil (/api/mon-profil), formule par le serveur.
class MonProfil {
  const MonProfil({
    required this.nom,
    required this.fonction,
    required this.email,
    required this.badges,
    required this.disponibilites,
    required this.avis,
    required this.aLire,
    this.messageEquipe,
    this.avertissement,
    this.verification,
    this.lieu,
    this.trancheAge,
    this.tarif,
    this.servicesANoter,
    this.motifRefus,
    this.boutonVerification,
  });

  factory MonProfil.depuisJson(Map<String, dynamic> json) => MonProfil(
        nom: _lire<String>(json, 'nom'),
        fonction: _lire<String>(json, 'fonction'),
        email: _lire<String>(json, 'email'),
        badges: _lireListe(json, 'badges', BadgeDuProfil.depuisJson),
        disponibilites: _lireListe(json, 'disponibilites', Creneau.depuisJson),
        avis: AvisDeLaFiche.depuisJson(_lire<Map<String, dynamic>>(json, 'avis')),
        aLire: _lire<int>(json, 'aLire'),
        messageEquipe: _lireObjet(json, 'messageEquipe', MessageDeLEquipe.depuisJson),
        avertissement: _lireObjet(json, 'avertissement', AvertissementDeLEquipe.depuisJson),
        verification: _lireObjet(json, 'verification', VerificationDuProfil.depuisJson),
        lieu: _lireFacultatif<String>(json, 'lieu'),
        trancheAge: _lireFacultatif<String>(json, 'trancheAge'),
        tarif: _lireObjet(json, 'tarif', TarifDuProfil.depuisJson),
        servicesANoter: _lireObjet(json, 'servicesANoter', ServicesANoter.depuisJson),
        motifRefus: _lireFacultatif<String>(json, 'motifRefus'),
        boutonVerification: _lireFacultatif<String>(json, 'boutonVerification'),
      );

  final String nom;

  /// "Employeur", ou le metier de la personne qui repond.
  final String fonction;
  final String email;
  final List<BadgeDuProfil> badges;
  final List<Creneau> disponibilites;
  final AvisDeLaFiche avis;
  final int aLire;
  final MessageDeLEquipe? messageEquipe;
  final AvertissementDeLEquipe? avertissement;
  final VerificationDuProfil? verification;
  final String? lieu;
  final String? trancheAge;

  /// Seulement pour la personne qui repond aux demandes.
  final TarifDuProfil? tarif;
  final ServicesANoter? servicesANoter;
  final String? motifRefus;

  /// "Faire vérifier mon identité" ou "Voir mon dossier" ; absent une fois
  /// l'identite validee.
  final String? boutonVerification;
}

/// Un morceau de phrase ecrit par le serveur, en gras ou non.
class Morceau {
  const Morceau({required this.texte, this.gras = false});

  factory Morceau.depuisJson(Map<String, dynamic> json) => Morceau(
        texte: _lire<String>(json, 'texte'),
        gras: _lireFacultatif<bool>(json, 'gras') ?? false,
      );

  final String texte;
  final bool gras;
}

/// Depuis quand un dossier attend, et combien de temps il reste.
class AttenteDuDossier {
  const AttenteDuDossier({required this.morceaux, required this.aide});

  factory AttenteDuDossier.depuisJson(Map<String, dynamic> json) => AttenteDuDossier(
        morceaux: _lireListe(json, 'morceaux', Morceau.depuisJson),
        aide: _lire<String>(json, 'aide'),
      );

  final List<Morceau> morceaux;
  final String aide;
}

/// Un lien du site : l'application en garde le texte, et fait l'action
/// equivalente.
class LienDuSite {
  const LienDuSite({required this.url, required this.texte});

  factory LienDuSite.depuisJson(Map<String, dynamic> json) => LienDuSite(
        url: _lire<String>(json, 'url'),
        texte: _lire<String>(json, 'texte'),
      );

  final String url;
  final String texte;
}

/// La verification d'identite (/api/verification), ecrite par le serveur.
class DossierDeVerification {
  const DossierDeVerification({
    required this.statut,
    required this.libelle,
    required this.verifiee,
    required this.suite,
    required this.chapeau,
    required this.delaiHeures,
    required this.extensions,
    required this.tailleMaxMo,
    required this.remplaceUnDossier,
    this.attente,
    this.motifRefus,
  });

  factory DossierDeVerification.depuisJson(Map<String, dynamic> json) {
    final suite = _lireObjet(json, 'suite', LienDuSite.depuisJson);
    if (suite == null) throw const FormeInattendue('suite');
    return DossierDeVerification(
      statut: _lire<String>(json, 'statut'),
      libelle: _lire<String>(json, 'libelle'),
      verifiee: _lire<bool>(json, 'verifiee'),
      suite: suite,
      chapeau: _lire<String>(json, 'chapeau'),
      delaiHeures: _lire<int>(json, 'delaiHeures'),
      extensions: _lireTextes(json, 'extensions'),
      tailleMaxMo: _lire<num>(json, 'tailleMaxMo'),
      remplaceUnDossier: _lire<bool>(json, 'remplaceUnDossier'),
      attente: _lireObjet(json, 'attente', AttenteDuDossier.depuisJson),
      motifRefus: _lireFacultatif<String>(json, 'motifRefus'),
    );
  }

  final String statut;
  final String libelle;
  final bool verifiee;

  /// Ou aller une fois l'identite validee.
  final LienDuSite suite;

  /// Pourquoi deux documents : la raison n'est pas la meme des deux cotes.
  final String chapeau;
  final int delaiHeures;

  /// ".jpg", ".pdf"... tels que le serveur les accepte.
  final List<String> extensions;
  final num tailleMaxMo;

  /// Un dossier est deja en examen : un nouvel envoi le remplace.
  final bool remplaceUnDossier;
  final AttenteDuDossier? attente;
  final String? motifRefus;
}

/// Une case de la grille des disponibilites.
class CreneauChoix {
  const CreneauChoix({required this.valeur, required this.libelle, required this.coche});

  factory CreneauChoix.depuisJson(Map<String, dynamic> json) => CreneauChoix(
        valeur: _lire<String>(json, 'valeur'),
        libelle: _lire<String>(json, 'libelle'),
        coche: _lire<bool>(json, 'coche'),
      );

  /// "lundi-matin", ce que le serveur enregistre.
  final String valeur;
  final String libelle;
  final bool coche;
}

class JourDisponible {
  const JourDisponible({required this.libelle, required this.creneaux});

  factory JourDisponible.depuisJson(Map<String, dynamic> json) => JourDisponible(
        libelle: _lire<String>(json, 'libelle'),
        creneaux: _lireListe(json, 'creneaux', CreneauChoix.depuisJson),
      );

  final String libelle;
  final List<CreneauChoix> creneaux;
}

class AnneesNaissance {
  const AnneesNaissance({required this.de, required this.a});

  factory AnneesNaissance.depuisJson(Map<String, dynamic> json) => AnneesNaissance(
        de: _lire<int>(json, 'de'),
        a: _lire<int>(json, 'a'),
      );

  final int de;
  final int a;
}

/// Le formulaire Modifier mon profil (/api/mon-profil/modification).
class FormulaireProfil {
  const FormulaireProfil({
    required this.nom,
    required this.quartier,
    required this.quartiers,
    required this.arrondissements,
    required this.pourPersonne,
    required this.metiers,
    required this.experienceAnnees,
    required this.experienceMax,
    required this.moments,
    required this.jours,
    required this.tarif,
    required this.email,
    required this.motDePasseMin,
    this.arrondissement,
    this.metier,
    this.dateNaissance,
    this.anneesNaissance,
  });

  factory FormulaireProfil.depuisJson(Map<String, dynamic> json) {
    final formulaire = FormulaireProfil(
      nom: _lire<String>(json, 'nom'),
      quartier: _lire<String>(json, 'quartier'),
      quartiers: _lireTextes(json, 'quartiers'),
      arrondissements: _lireTextes(json, 'arrondissements'),
      pourPersonne: _lire<bool>(json, 'pourPersonne'),
      metiers: _lireTextes(json, 'metiers'),
      experienceAnnees: _lire<String>(json, 'experienceAnnees'),
      experienceMax: _lire<int>(json, 'experienceMax'),
      moments: _lireTextes(json, 'moments'),
      jours: _lireListe(json, 'jours', JourDisponible.depuisJson),
      tarif: _lire<String>(json, 'tarif'),
      email: _lire<String>(json, 'email'),
      motDePasseMin: _lire<int>(json, 'motDePasseMin'),
      arrondissement: _lireFacultatif<String>(json, 'arrondissement'),
      metier: _lireFacultatif<String>(json, 'metier'),
      dateNaissance: _lireFacultatif<String>(json, 'dateNaissance'),
      anneesNaissance: _lireObjet(json, 'anneesNaissance', AnneesNaissance.depuisJson),
    );
    // La grille a une colonne par moment : un jour qui n'en aurait pas
    // autant ne pourrait pas s'y afficher.
    if (formulaire.jours.any((jour) => jour.creneaux.length != formulaire.moments.length)) {
      throw const FormeInattendue('jours');
    }
    return formulaire;
  }

  final String nom;
  final String quartier;
  final List<String> quartiers;
  final List<String> arrondissements;

  /// La personne qui repond aux demandes : metier, date de naissance,
  /// experience, disponibilites et tarif. Un employeur n'en a pas.
  final bool pourPersonne;
  final List<String> metiers;
  final String experienceAnnees;
  final int experienceMax;
  final List<String> moments;
  final List<JourDisponible> jours;
  final String tarif;
  final String? arrondissement;
  final String? metier;

  /// "1995-06-15", ou absente.
  final String? dateNaissance;
  final AnneesNaissance? anneesNaissance;

  /// L'adresse actuelle, pour la section Changer mon adresse email.
  final String email;
  final int motDePasseMin;
}

/// Une raison de creer un compte, dans la liste fermee du serveur.
class RoleInscription {
  const RoleInscription({required this.valeur, required this.libelle, required this.pourPersonne});

  factory RoleInscription.depuisJson(Map<String, dynamic> json) => RoleInscription(
        valeur: _lire<String>(json, 'valeur'),
        libelle: _lire<String>(json, 'libelle'),
        pourPersonne: _lire<bool>(json, 'pourPersonne'),
      );

  final String valeur;
  final String libelle;

  /// Ce choix declare un metier, un tarif et des disponibilites : leurs
  /// champs s'affichent, comme sur le site.
  final bool pourPersonne;
}

/// Les montants de l'exemple sous le tarif, calcules par le serveur avec
/// la commission.
class ExempleTarif {
  const ExempleTarif({required this.prix, required this.commission, required this.recu});

  factory ExempleTarif.depuisJson(Map<String, dynamic> json) => ExempleTarif(
        prix: _lire<String>(json, 'prix'),
        commission: _lire<String>(json, 'commission'),
        recu: _lire<String>(json, 'recu'),
      );

  final String prix;
  final String commission;
  final String recu;
}

/// Creer un compte : le formulaire de Modifier mon profil, vide, avec le
/// choix du role et l'exemple sous le tarif.
class FormulaireInscription {
  const FormulaireInscription({required this.profil, required this.roles, required this.exempleTarif});

  factory FormulaireInscription.depuisJson(Map<String, dynamic> json) {
    final roles = _lireListe(json, 'roles', RoleInscription.depuisJson);
    // Sans choix, le formulaire n'aurait rien a proposer.
    if (roles.isEmpty) throw const FormeInattendue('roles');
    final exemple = _lireObjet(json, 'exempleTarif', ExempleTarif.depuisJson);
    if (exemple == null) throw const FormeInattendue('exempleTarif');
    return FormulaireInscription(
      profil: FormulaireProfil.depuisJson(json),
      roles: roles,
      exempleTarif: exemple,
    );
  }

  final FormulaireProfil profil;
  final List<RoleInscription> roles;
  final ExempleTarif exempleTarif;
}

/// Le compte est cree : la phrase du site, et l'adresse a saisir pour se
/// connecter.
class InscriptionFaite {
  const InscriptionFaite({required this.titre, required this.texte, required this.email});

  factory InscriptionFaite.depuisJson(Map<String, dynamic> json) => InscriptionFaite(
        titre: _lire<String>(json, 'titre'),
        texte: _lire<String>(json, 'texte'),
        email: _lire<String>(json, 'email'),
      );

  final String titre;
  final String texte;
  final String email;
}

/// Les chiffres des pages de presentation, calcules par le serveur : la
/// commission et l'exemple de calcul.
class Presentation {
  const Presentation({required this.pourcentageCommission, required this.exempleTarif});

  factory Presentation.depuisJson(Map<String, dynamic> json) {
    final exemple = _lireObjet(json, 'exempleTarif', ExempleTarif.depuisJson);
    if (exemple == null) throw const FormeInattendue('exempleTarif');
    return Presentation(
      pourcentageCommission: _lire<int>(json, 'pourcentageCommission'),
      exempleTarif: exemple,
    );
  }

  final int pourcentageCommission;
  final ExempleTarif exempleTarif;
}

/// La reponse a un changement d'adresse : la phrase et la nouvelle adresse.
class AdresseChangee {
  const AdresseChangee({required this.texte, required this.email});

  factory AdresseChangee.depuisJson(Map<String, dynamic> json) => AdresseChangee(
        texte: _lire<String>(json, 'texte'),
        email: _lire<String>(json, 'email'),
      );

  final String texte;
  final String email;
}

/// Une somme posee par l'employeur, et ce qu'elle est devenue.
class VersementEnvoye {
  const VersementEnvoye({
    required this.titreDemande,
    required this.etat,
    required this.libelleEtat,
    required this.montant,
    required this.bloqueLe,
    required this.rappelDeclaration,
    this.denoue,
  });

  factory VersementEnvoye.depuisJson(Map<String, dynamic> json) => VersementEnvoye(
        titreDemande: _lire<String>(json, 'titreDemande'),
        etat: _lire<String>(json, 'etat'),
        libelleEtat: _lire<String>(json, 'libelleEtat'),
        montant: _lire<String>(json, 'montant'),
        bloqueLe: _lire<String>(json, 'bloqueLe'),
        rappelDeclaration: _lire<bool>(json, 'rappelDeclaration'),
        denoue: _lireFacultatif<String>(json, 'denoue'),
      );

  final String titreDemande;

  /// "bloque", "rembourse" ou "verse" : seulement pour la couleur.
  final String etat;
  final String libelleEtat;
  final String montant;
  final String bloqueLe;
  final bool rappelDeclaration;

  /// "Verse le ..." ou "Rendu le ...", absent tant que la somme est bloquee.
  final String? denoue;
}

/// Ce que la personne a recu pour un service.
class VersementRecu {
  const VersementRecu({required this.titreDemande, required this.chez, required this.lignes, required this.verseLe});

  factory VersementRecu.depuisJson(Map<String, dynamic> json) => VersementRecu(
        titreDemande: _lire<String>(json, 'titreDemande'),
        chez: _lire<String>(json, 'chez'),
        lignes: _lireListe(json, 'lignes', LigneTarif.depuisJson),
        verseLe: _lire<String>(json, 'verseLe'),
      );

  final String titreDemande;
  final String chez;
  final List<LigneTarif> lignes;
  final String verseLe;
}

/// Mon compte (/api/mon-compte).
class MonCompte {
  const MonCompte({required this.jeSuisEmployeur, required this.recus, required this.envoyes, this.totalRecu});

  factory MonCompte.depuisJson(Map<String, dynamic> json) => MonCompte(
        jeSuisEmployeur: _lire<bool>(json, 'jeSuisEmployeur'),
        recus: _lireListe(json, 'recus', VersementRecu.depuisJson),
        envoyes: _lireListe(json, 'envoyes', VersementEnvoye.depuisJson),
        totalRecu: _lireFacultatif<String>(json, 'totalRecu'),
      );

  final bool jeSuisEmployeur;
  final List<VersementRecu> recus;
  final List<VersementEnvoye> envoyes;

  /// Seulement pour la personne qui repond aux demandes.
  final String? totalRecu;
}

/// Un pack en vente, avec ce qu'il donnera a cette personne.
class PackJetons {
  const PackJetons({required this.quantite, required this.prix, this.apres, this.dequoi, this.manqueEncore});

  factory PackJetons.depuisJson(Map<String, dynamic> json) => PackJetons(
        quantite: _lire<int>(json, 'quantite'),
        prix: _lire<String>(json, 'prix'),
        apres: _lireFacultatif<int>(json, 'apres'),
        dequoi: _lireFacultatif<String>(json, 'dequoi'),
        manqueEncore: _lireFacultatif<int>(json, 'manqueEncore'),
      );

  final int quantite;
  final String prix;

  /// Le solde apres cet achat, absent si le cout d'une action n'est pas regle.
  final int? apres;

  /// "repondre a 8 demandes", ou absent s'il manquera encore des jetons.
  final String? dequoi;
  final int? manqueEncore;
}

class AchatJetons {
  const AchatJetons({
    required this.quantite,
    required this.etat,
    required this.libelleEtat,
    required this.montant,
    required this.demandeLe,
    this.motifRefus,
  });

  factory AchatJetons.depuisJson(Map<String, dynamic> json) => AchatJetons(
        quantite: _lire<int>(json, 'quantite'),
        etat: _lire<String>(json, 'etat'),
        libelleEtat: _lire<String>(json, 'libelleEtat'),
        montant: _lire<String>(json, 'montant'),
        demandeLe: _lire<String>(json, 'demandeLe'),
        motifRefus: _lireFacultatif<String>(json, 'motifRefus'),
      );

  final int quantite;

  /// "en attente", "confirme" ou "refuse" : seulement pour la couleur.
  final String etat;
  final String libelleEtat;
  final String montant;
  final String demandeLe;
  final String? motifRefus;
}

class MouvementJetons {
  const MouvementJetons({required this.libelle, required this.date, required this.quantite, required this.retrait});

  factory MouvementJetons.depuisJson(Map<String, dynamic> json) => MouvementJetons(
        libelle: _lire<String>(json, 'libelle'),
        date: _lire<String>(json, 'date'),
        quantite: _lire<String>(json, 'quantite'),
        retrait: _lire<bool>(json, 'retrait'),
      );

  final String libelle;
  final String date;

  /// "+ 10" ou "− 2", deja ecrit.
  final String quantite;
  final bool retrait;
}

/// Mes jetons (/api/mes-jetons), formule par le serveur.
class MesJetons {
  const MesJetons({
    required this.jeSuisEmployeur,
    required this.soldeTotal,
    required this.offerts,
    required this.achetes,
    required this.soldeVide,
    required this.verificationAFaire,
    required this.demandeEnCours,
    required this.uneAction,
    required this.packs,
    required this.achats,
    required this.mouvements,
    this.perdusMaintenant,
    this.cout,
    this.permet,
    this.manque,
    this.expireLe,
    this.valeurJeton,
  });

  factory MesJetons.depuisJson(Map<String, dynamic> json) => MesJetons(
        jeSuisEmployeur: _lire<bool>(json, 'jeSuisEmployeur'),
        soldeTotal: _lire<String>(json, 'soldeTotal'),
        offerts: _lire<int>(json, 'offerts'),
        achetes: _lire<int>(json, 'achetes'),
        soldeVide: _lire<bool>(json, 'soldeVide'),
        verificationAFaire: _lire<bool>(json, 'verificationAFaire'),
        demandeEnCours: _lire<bool>(json, 'demandeEnCours'),
        uneAction: _lire<String>(json, 'uneAction'),
        packs: _lireListe(json, 'packs', PackJetons.depuisJson),
        achats: _lireListe(json, 'achats', AchatJetons.depuisJson),
        mouvements: _lireListe(json, 'mouvements', MouvementJetons.depuisJson),
        perdusMaintenant: _lireFacultatif<int>(json, 'perdusMaintenant'),
        cout: _lireFacultatif<String>(json, 'cout'),
        permet: _lireFacultatif<String>(json, 'permet'),
        manque: _lireFacultatif<String>(json, 'manque'),
        expireLe: _lireFacultatif<String>(json, 'expireLe'),
        valeurJeton: _lireFacultatif<String>(json, 'valeurJeton'),
      );

  final bool jeSuisEmployeur;

  /// "3 jetons (300 FCFA)".
  final String soldeTotal;
  final int offerts;
  final int achetes;
  final bool soldeVide;
  final bool verificationAFaire;
  final bool demandeEnCours;

  /// "repondre a une demande" ou "mettre une demande en avant".
  final String uneAction;
  final List<PackJetons> packs;
  final List<AchatJetons> achats;
  final List<MouvementJetons> mouvements;

  /// Les jetons offerts qui viennent d'expirer : dit une seule fois.
  final int? perdusMaintenant;
  final String? cout;
  final String? permet;
  final String? manque;
  final String? expireLe;

  /// Absente tant que l'equipe n'a pas regle les prix : aucun prix invente.
  final String? valeurJeton;
}

/// Une personne trouvee par la recherche, deja formulee par le serveur.
class PersonneTrouvee {
  const PersonneTrouvee({
    required this.id,
    required this.nom,
    required this.verifiee,
    required this.libelleVerification,
    required this.note,
    required this.tarif,
    this.metier,
    this.joursDisponibles,
    this.experience,
    this.lieu,
    this.distance,
  });

  factory PersonneTrouvee.depuisJson(Map<String, dynamic> json) => PersonneTrouvee(
        id: _lire<int>(json, 'id'),
        nom: _lire<String>(json, 'nom'),
        verifiee: _lire<bool>(json, 'verifiee'),
        libelleVerification: _lire<String>(json, 'libelleVerification'),
        note: NotePersonne.depuisJson(_lire<Map<String, dynamic>>(json, 'note')),
        tarif: _lire<String>(json, 'tarif'),
        metier: _lireFacultatif<String>(json, 'metier'),
        joursDisponibles: _lireFacultatif<String>(json, 'joursDisponibles'),
        experience: _lireFacultatif<String>(json, 'experience'),
        lieu: _lireFacultatif<String>(json, 'lieu'),
        distance: _lireFacultatif<String>(json, 'distance'),
      );

  final int id;
  final String nom;
  final bool verifiee;
  final String libelleVerification;
  final NotePersonne note;
  final String tarif;
  final String? metier;
  final String? joursDisponibles;
  final String? experience;
  final String? lieu;

  /// Absente : l'application n'envoie pas de position.
  final String? distance;
}

/// La reponse de /api/recherche, dans l'ordre du classement du serveur.
class ResultatRecherche {
  const ResultatRecherche({
    required this.titre,
    required this.classementExplique,
    required this.personnes,
    required this.peutPublier,
    this.phraseLieu,
  });

  factory ResultatRecherche.depuisJson(Map<String, dynamic> json) => ResultatRecherche(
        titre: _lire<String>(json, 'titre'),
        classementExplique: _lire<bool>(json, 'classementExplique'),
        personnes: _lireListe(json, 'personnes', PersonneTrouvee.depuisJson),
        peutPublier: _lire<bool>(json, 'peutPublier'),
        phraseLieu: _lireFacultatif<String>(json, 'phraseLieu'),
      );

  final String titre;
  final bool classementExplique;
  final List<PersonneTrouvee> personnes;
  final bool peutPublier;

  /// "Sans votre position, la proximite se mesure a partir de votre quartier..."
  final String? phraseLieu;
}

/// La demande telle que l'ecran de reponse la montre.
class DemandeARepondre {
  const DemandeARepondre({
    required this.id,
    required this.titre,
    required this.horaire,
    this.metier,
    this.quartier,
    this.arrondissement,
    this.conditions,
  });

  factory DemandeARepondre.depuisJson(Map<String, dynamic> json) => DemandeARepondre(
        id: _lire<int>(json, 'id'),
        titre: _lire<String>(json, 'titre'),
        horaire: _lire<String>(json, 'horaire'),
        metier: _lireFacultatif<String>(json, 'metier'),
        quartier: _lireFacultatif<String>(json, 'quartier'),
        arrondissement: _lireFacultatif<String>(json, 'arrondissement'),
        conditions: _lireFacultatif<String>(json, 'conditions'),
      );

  final int id;
  final String titre;
  final String horaire;
  final String? metier;
  final String? quartier;
  final String? arrondissement;
  final String? conditions;
}

/// Chez qui la personne va : son nom, sa verification, sa reputation.
class EmployeurDeLaDemande {
  const EmployeurDeLaDemande({required this.nom, required this.verifie, required this.nombreAvis, this.note});

  factory EmployeurDeLaDemande.depuisJson(Map<String, dynamic> json) => EmployeurDeLaDemande(
        nom: _lire<String>(json, 'nom'),
        verifie: _lire<bool>(json, 'verifie'),
        nombreAvis: _lire<int>(json, 'nombreAvis'),
        note: _lireFacultatif<String>(json, 'note'),
      );

  final String nom;
  final bool verifie;
  final int nombreAvis;

  /// Absente tant que personne n'a note cet employeur.
  final String? note;
}

class PrixARepondre {
  const PrixARepondre({required this.lignes, this.annonce, this.dureeEstimee});

  factory PrixARepondre.depuisJson(Map<String, dynamic> json) => PrixARepondre(
        lignes: _lireListe(json, 'lignes', LigneTarif.depuisJson),
        annonce: _lireFacultatif<String>(json, 'annonce'),
        dureeEstimee: _lireFacultatif<String>(json, 'dureeEstimee'),
      );

  /// Ce que l'employeur paie, la commission, ce qu'elle recevra.
  final List<LigneTarif> lignes;
  final String? annonce;
  final String? dureeEstimee;
}

class CoutDeLaReponse {
  const CoutDeLaReponse({
    required this.envoyer,
    required this.reste,
    required this.soldeInsuffisant,
    required this.solde,
  });

  factory CoutDeLaReponse.depuisJson(Map<String, dynamic> json) => CoutDeLaReponse(
        envoyer: _lire<String>(json, 'envoyer'),
        reste: _lire<String>(json, 'reste'),
        soldeInsuffisant: _lire<bool>(json, 'soldeInsuffisant'),
        solde: _lire<String>(json, 'solde'),
      );

  final String envoyer;
  final String reste;
  final bool soldeInsuffisant;
  final String solde;
}

class LimiteDuJour {
  const LimiteDuJour({required this.parJour, required this.restant});

  factory LimiteDuJour.depuisJson(Map<String, dynamic> json) => LimiteDuJour(
        parJour: _lire<int>(json, 'parJour'),
        restant: _lire<int>(json, 'restant'),
      );

  final int parJour;
  final int restant;
}

/// L'ecran Repondre a cette demande (/api/demandes/:id/reponse).
class EcranReponse {
  const EcranReponse({required this.demande, required this.employeur, required this.prix, this.cout, this.limite});

  factory EcranReponse.depuisJson(Map<String, dynamic> json) => EcranReponse(
        demande: DemandeARepondre.depuisJson(_lire<Map<String, dynamic>>(json, 'demande')),
        employeur: EmployeurDeLaDemande.depuisJson(_lire<Map<String, dynamic>>(json, 'employeur')),
        prix: PrixARepondre.depuisJson(_lire<Map<String, dynamic>>(json, 'prix')),
        cout: _lireObjet(json, 'cout', CoutDeLaReponse.depuisJson),
        limite: _lireObjet(json, 'limite', LimiteDuJour.depuisJson),
      );

  final DemandeARepondre demande;
  final EmployeurDeLaDemande employeur;
  final PrixARepondre prix;

  /// Absent si l'equipe n'a pas regle le cout d'une reponse.
  final CoutDeLaReponse? cout;
  final LimiteDuJour? limite;
}

class ReponseEnvoyee {
  const ReponseEnvoyee({required this.texte, required this.candidatureId});

  factory ReponseEnvoyee.depuisJson(Map<String, dynamic> json) => ReponseEnvoyee(
        texte: _lire<String>(json, 'texte'),
        candidatureId: _lire<int>(json, 'candidatureId'),
      );

  final String texte;
  final int candidatureId;
}

/// "J'ai effectue ce service", du cote de la personne choisie.
class MaDeclaration {
  const MaDeclaration({required this.dejaFaite, required this.employeur, this.le});

  factory MaDeclaration.depuisJson(Map<String, dynamic> json) => MaDeclaration(
        dejaFaite: _lire<bool>(json, 'dejaFaite'),
        employeur: _lire<String>(json, 'employeur'),
        le: _lireFacultatif<String>(json, 'le'),
      );

  final bool dejaFaite;
  final String employeur;

  /// La date de sa declaration, une fois faite.
  final String? le;
}

/// Une reponse envoyee, et ou elle en est.
class MaReponse {
  const MaReponse({required this.id, required this.titreDemande, required this.phrase});

  factory MaReponse.depuisJson(Map<String, dynamic> json) => MaReponse(
        id: _lire<int>(json, 'id'),
        titreDemande: _lire<String>(json, 'titreDemande'),
        phrase: _lire<String>(json, 'phrase'),
      );

  /// L'identifiant de la candidature, qui ouvre aussi la discussion.
  final int id;
  final String titreDemande;
  final String phrase;
}

/// Mes reponses (/api/mes-reponses).
class MesReponses {
  const MesReponses({required this.reponses});

  factory MesReponses.depuisJson(Map<String, dynamic> json) =>
      MesReponses(reponses: _lireListe(json, 'reponses', MaReponse.depuisJson));

  final List<MaReponse> reponses;
}
