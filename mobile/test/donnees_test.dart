// Ce que l'application lit du serveur, et comment elle le presente.
//
// Ces tests tournent sur l'ordinateur, sans telephone ni serveur : ils
// verifient que les reponses de l'API, sous leur forme reelle, sont lues
// sans rien deviner.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pamconnect/api.dart';
import 'package:pamconnect/elements.dart';
import 'package:pamconnect/modeles.dart';

Map<String, dynamic> _moi(String role) => {
      'id': 7,
      'nom': 'Test pre',
      'role': role,
      'quartier': 'Bastos',
      'metier': 'menagere',
      'verification': 'verifie',
      'jetons': {'offerts': 3, 'achetes': 0, 'total': 3},
    };

Map<String, dynamic> _reponse({
  required int id,
  required String nom,
  required String phrase,
  String verification = 'verifie',
  bool peutChoisir = true,
  bool attendVerification = false,
}) =>
    {
      'id': id,
      'prestataireId': id + 100,
      'nom': nom,
      'phrase': phrase,
      'verification': verification,
      'libelleVerification': verification == 'verifie' ? 'Identité vérifiée' : 'Identité non vérifiée',
      'note': {'etat': 'nouveau', 'badge': 'Nouveau prestataire', 'detail': "personne ne l'a encore notée"},
      'experience': null,
      'disponibilites': 'lundi, mercredi',
      'peutChoisir': peutChoisir,
      'peutRefuser': true,
      'attendVerification': attendVerification,
      'libelleDiscussion': 'Discuter',
    };

void main() {
  group('la connexion', () {
    test('lit le jeton et la personne, comme les renvoie /api/connexion', () {
      final connexion = Connexion.depuisJson({'jeton': 'a' * 64, 'moi': _moi('prestataire')});
      expect(connexion.jeton, 'a' * 64);
      expect(connexion.moi.nom, 'Test pre');
      expect(connexion.moi.jetons.total, 3);
    });

    test('un serveur qui ne rend pas de jeton est signale, pas devine', () {
      expect(
        () => Connexion.depuisJson({'moi': _moi('prestataire')}),
        throwsA(isA<FormeInattendue>()),
      );
    });

    test('un solde de jetons absent est signale, pas remplace par zero', () {
      final sansJetons = _moi('prestataire')..remove('jetons');
      expect(() => Moi.depuisJson(sansJetons), throwsA(isA<FormeInattendue>()));
    });
  });

  group("l'ecran d'arrivee suit le role, comme le menu du site", () {
    test('la personne qui repond arrive sur les demandes ouvertes', () {
      final moi = Moi.depuisJson(_moi('prestataire'));
      expect(moi.repondAuxDemandes, isTrue);
      expect(moi.publieDesDemandes, isFalse);
    });

    test("l'employeur arrive sur ses demandes", () {
      final moi = Moi.depuisJson(_moi('employeur'));
      expect(moi.publieDesDemandes, isTrue);
      expect(moi.repondAuxDemandes, isFalse);
    });

    test("l'equipe n'a pas d'ecran dans l'application", () {
      final moi = Moi.depuisJson(_moi('equipe'));
      expect(moi.repondAuxDemandes, isFalse);
      expect(moi.publieDesDemandes, isFalse);
    });
  });

  group('une demande ouverte', () {
    Map<String, dynamic> demande({String? quartier, String? arrondissement}) => {
          'id': 12,
          'titre': 'Menage deux fois par semaine',
          'metier': 'menagere',
          'quartier': quartier,
          'arrondissement': arrondissement,
          'horaire': 'Lundi et jeudi, 8h',
          'prix': 12000,
          'uniteTarif': 'prestation',
          'dureeEstimee': null,
          'prixLisible': '12 000 FCFA pour la prestation',
          'misEnAvant': false,
        };

    test('le lieu reunit le quartier et l arrondissement', () {
      final d = Demande.depuisJson(demande(quartier: 'Manguier', arrondissement: 'Yaoundé 1'));
      expect(d.lieu, 'Manguier, Yaoundé 1');
    });

    test("sans quartier, rien n'est invente", () {
      expect(Demande.depuisJson(demande()).lieu, isNull);
      expect(Demande.depuisJson(demande(quartier: '  ')).lieu, isNull);
    });

    test('le prix arrive deja ecrit par le serveur', () {
      expect(Demande.depuisJson(demande()).prixLisible, '12 000 FCFA pour la prestation');
    });
  });

  test("la liste garde l'ordre et la separation decides par le serveur", () {
    final liste = ListeDemandes.depuisJson({
      'pourMoi': [
        {'id': 1, 'titre': 'A', 'misEnAvant': true},
      ],
      'autres': [
        {'id': 2, 'titre': 'B', 'misEnAvant': false},
        {'id': 3, 'titre': 'C', 'misEnAvant': false},
      ],
      'monMetier': 'menagere',
    });
    expect(liste.pourMoi.map((d) => d.titre), ['A']);
    expect(liste.autres.map((d) => d.titre), ['B', 'C']);
    expect(liste.vide, isFalse);
    expect(ListeDemandes.depuisJson({'pourMoi': [], 'autres': []}).vide, isTrue);
  });

  group("les demandes de l'employeur", () {
    Map<String, dynamic> reponseServeur() => {
          'demandes': [
            {
              'id': 20,
              'titre': 'Menage deux fois par semaine',
              'metier': null,
              'horaire': 'Mardi 8h',
              'prixLisible': '12 000 FCFA pour la prestation',
              'dureeEstimee': null,
              'lieu': 'Manguier, Yaoundé 1',
              'fermee': false,
              'phraseFermeture': null,
              'enAvant': false,
              'enAvantJusquAu': null,
              'peutModifier': true,
              'peutMettreEnAvant': true,
              'peutRetirer': true,
              'candidatures': [
                _reponse(id: 1, nom: 'Djenabou', phrase: 'En attente de votre décision'),
                _reponse(
                  id: 2,
                  nom: 'Junior',
                  phrase: 'En attente de votre décision',
                  verification: 'non soumis',
                  peutChoisir: false,
                  attendVerification: true,
                ),
              ],
            },
            {
              'id': 19,
              'titre': 'Cuisine tous les jours',
              'metier': null,
              'horaire': 'Horaire non précisé',
              'prixLisible': null,
              'dureeEstimee': null,
              'lieu': null,
              'fermee': true,
              'phraseFermeture': 'Vous avez retiré cette demande.',
              'enAvant': false,
              'enAvantJusquAu': null,
              'peutModifier': false,
              'peutMettreEnAvant': false,
              'peutRetirer': false,
              'candidatures': [],
            },
          ],
        };

    test("l'ordre du serveur est garde : en cours, puis terminees", () {
      final mes = MesDemandes.depuisJson(reponseServeur());
      expect(mes.enCours.map((d) => d.titre), ['Menage deux fois par semaine']);
      expect(mes.terminees.map((d) => d.titre), ['Cuisine tous les jours']);
      expect(mes.terminees.single.phraseFermeture, 'Vous avez retiré cette demande.');
    });

    test('les decisions du serveur sont lues telles quelles', () {
      final reponses = MesDemandes.depuisJson(reponseServeur()).enCours.single.reponses;
      expect(reponses[0].peutChoisir, isTrue);
      expect(reponses[0].attendVerification, isFalse);
      expect(reponses[1].peutChoisir, isFalse);
      expect(reponses[1].attendVerification, isTrue);
      expect(reponses[1].libelleVerification, 'Identité non vérifiée');
      expect(reponses[0].note.badge, 'Nouveau prestataire');
      expect(reponses[0].note.notee, isFalse);
    });

    test("une decision absente est signalee, jamais devinee", () {
      final json = reponseServeur();
      final premiere = (json['demandes'] as List).first as Map<String, dynamic>;
      ((premiere['candidatures'] as List).first as Map<String, dynamic>).remove('peutChoisir');
      expect(() => MesDemandes.depuisJson(json), throwsA(isA<FormeInattendue>()));
    });
  });

  group('la phrase des jetons', () {
    Jetons jetons(int offerts, int achetes) =>
        Jetons(offerts: offerts, achetes: achetes, total: offerts + achetes);

    test('aucun jeton', () => expect(phraseJetons(jetons(0, 0)), "Vous n'avez aucun jeton."));
    test('les offerts sont nommes, parce qu ils perissent', () {
      expect(phraseJetons(jetons(3, 0)), 'Vous avez 3 jetons, dont 3 offerts.');
      expect(phraseJetons(jetons(1, 4)), 'Vous avez 5 jetons, dont 1 offert.');
    });
    test('sans jeton offert, la phrase ne parle pas d offerts', () {
      expect(phraseJetons(jetons(0, 1)), 'Vous avez 1 jeton.');
    });
  });

  group("l'adresse du serveur", () {
    test('le http:// oublie est ajoute, et la barre finale retiree', () {
      expect(ApiPamConnect.normaliserAdresse(' 192.168.1.200:3000/ '), 'http://192.168.1.200:3000');
    });

    test('une adresse complete est gardee telle quelle', () {
      expect(ApiPamConnect.normaliserAdresse('http://192.168.1.200:3000'), 'http://192.168.1.200:3000');
      expect(ApiPamConnect.normaliserAdresse('https://exemple.cm'), 'https://exemple.cm');
    });

    test("le port n'est jamais devine", () {
      expect(ApiPamConnect.normaliserAdresse('192.168.1.200'), 'http://192.168.1.200');
    });
  });

  group('le formulaire de publication', () {
    Map<String, dynamic> formulaire() => {
          'metiers': ['metier 1', 'metier 2'],
          'quartiers': ['quartier 1'],
          'arrondissements': ['arrondissement 1'],
          'unitesTarif': [
            {'valeur': 'horaire', 'libelle': "de l'heure"},
            {'valeur': 'forfaitaire', 'libelle': 'pour la prestation'},
          ],
          'uniteParDefaut': 'forfaitaire',
        };

    test('les listes du serveur sont lues telles quelles', () {
      final lu = FormulaireDemande.depuisJson(formulaire());
      expect(lu.metiers, ['metier 1', 'metier 2']);
      expect(lu.unitesTarif.map((u) => u.libelle), ["de l'heure", 'pour la prestation']);
      expect(lu.uniteParDefaut, 'forfaitaire');
    });

    test('un choix par defaut absent de la liste est signale', () {
      final json = formulaire()..['uniteParDefaut'] = 'journalier';
      expect(() => FormulaireDemande.depuisJson(json), throwsA(isA<FormeInattendue>()));
    });

    test('une liste qui contient autre chose que du texte est signalee', () {
      final json = formulaire()..['quartiers'] = [1, 2];
      expect(() => FormulaireDemande.depuisJson(json), throwsA(isA<FormeInattendue>()));
    });
  });

  group("l'arrondissement d'un quartier", () {
    test('un quartier connu donne son arrondissement', () {
      final lieu = LieuTrouve.depuisJson(
          {'connu': true, 'quartier': 'quartier 1', 'arrondissement': 'arrondissement 1'});
      expect(lieu.connu, isTrue);
      expect(lieu.arrondissement, 'arrondissement 1');
    });

    test("un quartier inconnu ne recoit pas d'arrondissement invente", () {
      final lieu = LieuTrouve.depuisJson({'connu': false});
      expect(lieu.connu, isFalse);
      expect(lieu.arrondissement, isNull);
    });

    test('connu mais sans arrondissement : signale', () {
      expect(() => LieuTrouve.depuisJson({'connu': true, 'quartier': 'quartier 1'}),
          throwsA(isA<FormeInattendue>()));
    });
  });

  test('la confirmation de publication est celle du serveur', () {
    final publication =
        Publication.depuisJson({'id': 3, 'titre': 'Demande publiée', 'texte': 'texte du serveur'});
    expect(publication.id, 3);
    expect(publication.texte, 'texte du serveur');
    expect(() => Publication.depuisJson({'id': 3, 'titre': 'Demande publiée'}),
        throwsA(isA<FormeInattendue>()));
  });

  group("l'ecran de confirmation d'un choix", () {
    Map<String, dynamic> ecran() => {
          'candidatureId': 5,
          'prestataireId': 6,
          'nom': 'nom 1',
          'metier': null,
          'note': {'etat': 'nouveau', 'badge': 'Nouveau prestataire', 'detail': "personne ne l'a encore notée"},
          'experience': null,
          'service': 'service 1',
          'horaire': 'non précisé',
          'duree': null,
          'lieu': null,
          'conditions': null,
          'paiement': {
            'vousPayez': '8 000 FCFA',
            'commission': '800 FCFA',
            'pourcentageCommission': 10,
            'recoit': '7 200 FCFA',
          },
          'refusAnnonces': {'nombre': 2, 'suite': 'autres personnes qui attendaient recevront un refus.'},
        };

    test('les montants arrivent tels que le serveur les a calcules', () {
      final lu = ConfirmationChoix.depuisJson(ecran());
      expect(lu.paiement!.vousPayez, '8 000 FCFA');
      expect(lu.paiement!.recoit, '7 200 FCFA');
      expect(lu.refusAnnonces!.nombre, 2);
    });

    test('sans prix ni autre personne en attente, rien n est invente', () {
      final json = ecran()
        ..['paiement'] = null
        ..['refusAnnonces'] = null;
      final lu = ConfirmationChoix.depuisJson(json);
      expect(lu.paiement, isNull);
      expect(lu.refusAnnonces, isNull);
    });

    test('un nom absent est signale', () {
      final json = ecran()..remove('nom');
      expect(() => ConfirmationChoix.depuisJson(json), throwsA(isA<FormeInattendue>()));
    });
  });

  test("une decision n'est prise que si le serveur le dit", () {
    expect(DecisionPrise.depuisJson({'ok': true}), isA<DecisionPrise>());
    expect(() => DecisionPrise.depuisJson({'ok': false}), throwsA(isA<FormeInattendue>()));
    expect(() => DecisionPrise.depuisJson({}), throwsA(isA<FormeInattendue>()));
  });

  group('la question avant de refuser', () {
    Future<void> ouvrir(WidgetTester tester, void Function(bool) garder) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async => garder(await confirmerRefus(context, 'nom 1')),
              child: const Text('ouvrir'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('ouvrir'));
      await tester.pumpAndSettle();
    }

    testWidgets('elle nomme la personne, et Annuler ne refuse pas', (tester) async {
      bool? resultat;
      await ouvrir(tester, (valeur) => resultat = valeur);
      expect(find.text('Voulez-vous vraiment refuser la candidature de nom 1 ?'), findsOneWidget);
      await tester.tap(find.text('Annuler'));
      await tester.pumpAndSettle();
      expect(resultat, isFalse);
    });

    testWidgets('Refuser confirme', (tester) async {
      bool? resultat;
      await ouvrir(tester, (valeur) => resultat = valeur);
      await tester.tap(find.text('Refuser'));
      await tester.pumpAndSettle();
      expect(resultat, isTrue);
    });
  });

  group('une discussion', () {
    Map<String, dynamic> discussion() => {
          'id': 9,
          'titreDemande': 'titre 1',
          'avec': 'nom 1',
          'metierAutre': null,
          'horaire': 'Horaire non précisé',
          'lieu': null,
          'conditions': null,
          'phraseStatut': 'En attente de votre décision',
          'prix': {
            'lignes': [
              {'libelle': 'Vous payez', 'montant': '8 000 FCFA', 'fort': true},
            ],
            'phrase': 'phrase 1',
          },
          'messages': [
            {
              'id': 1,
              'deMoi': true,
              'auteur': 'Vous',
              'quand': 'quand 1',
              'texte': 'texte 1',
              'risquePaiement': false,
              'signale': false,
              'peutSignaler': false,
            },
          ],
          'serviceTermine': null,
          'peutEcrire': true,
          'exempleMessage': 'exemple 1',
          'conseilEcriture': 'conseil 1',
          'peutDeclarerService': false,
          'declarationDeLaPersonne': null,
        };

    test('elle se lit telle que le serveur la decrit', () {
      final lu = Discussion.depuisJson(discussion());
      expect(lu.avec, 'nom 1');
      expect(lu.messages.single.auteur, 'Vous');
      expect(lu.messages.single.peutSignaler, isFalse);
      expect(lu.prix.lignes.single.montant, '8 000 FCFA');
      expect(lu.serviceTermine, isNull);
    });

    test('un service termine dit qui l a declare, et quand', () {
      final json = discussion()
        ..['serviceTermine'] = {'par': 'nom 2', 'le': 'date 1'}
        ..['peutEcrire'] = false;
      final lu = Discussion.depuisJson(json);
      expect(lu.serviceTermine!.nom, 'nom 2');
      expect(lu.serviceTermine!.le, 'date 1');
      expect(lu.peutEcrire, isFalse);
    });

    test('un message sans sa decision de signalement est signale, pas devine', () {
      final json = discussion();
      ((json['messages'] as List).first as Map<String, dynamic>).remove('peutSignaler');
      expect(() => Discussion.depuisJson(json), throwsA(isA<FormeInattendue>()));
    });
  });

  test('le mot du bouton de discussion vient du serveur', () {
    final json = _reponse(id: 1, nom: 'nom 1', phrase: 'phrase 1')..['libelleDiscussion'] = 'Relire la discussion';
    expect(ReponseRecue.depuisJson(json).libelleDiscussion, 'Relire la discussion');
    expect(() => ReponseRecue.depuisJson(_reponse(id: 1, nom: 'nom 1', phrase: 'phrase 1')..remove('libelleDiscussion')),
        throwsA(isA<FormeInattendue>()));
  });

  testWidgets('declarer le service demande confirmation, avec le nom', (tester) async {
    bool? resultat;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              resultat = await confirmerDeclarationService(context, 'nom 1');
            },
            child: const Text('ouvrir'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('ouvrir'));
    await tester.pumpAndSettle();
    expect(find.text("La somme bloquée sera versée à nom 1. Cette déclaration ne s'annule pas."), findsOneWidget);
    await tester.tap(find.text('Déclarer'));
    await tester.pumpAndSettle();
    expect(resultat, isTrue);
  });

  group("les avis", () {
    test("le formulaire d'avis vient du serveur", () {
      final lu = FormulaireAvis.depuisJson({
        'nomVise': 'nom 1',
        'titreDemande': 'titre 1',
        'echelle': [
          {'note': 5, 'libelle': 'Excellent'},
          {'note': 1, 'libelle': 'Mauvais'},
        ],
        'criteres': [
          {'cle': 'critere1', 'libelle': 'critere 1'},
        ],
        'exempleCommentaire': 'exemple 1',
        'commentaireMax': 1000,
      });
      expect(lu.echelle.first.libelle, 'Excellent');
      expect(lu.criteres.single.cle, 'critere1');
      expect(lu.commentaireMax, 1000);
    });

    test('les avis d un service termine, chacun absent tant qu il n est pas donne', () {
      final lu = AvisDuService.depuisJson({
        'monAvis': null,
        'avisRecu': {
          'id': 3,
          'note': 2,
          'commentaire': null,
          'auteur': 'nom 1',
          'masque': false,
          'signale': false,
          'peutSignaler': true,
        },
      });
      expect(lu.monAvis, isNull);
      expect(lu.avisRecu!.peutSignaler, isTrue);
      expect(lu.avisRecu!.commentaire, isNull);
    });

    test('un avis recu sans sa decision de signalement est signale, pas devine', () {
      expect(
        () => AvisRecu.depuisJson({'id': 3, 'note': 2, 'auteur': 'nom 1', 'masque': false, 'signale': false}),
        throwsA(isA<FormeInattendue>()),
      );
    });
  });

  group("la modification d'une demande", () {
    Map<String, dynamic> modification() => {
          'metiers': ['metier 1'],
          'quartiers': ['quartier 1'],
          'arrondissements': ['arrondissement 1'],
          'unitesTarif': [
            {'valeur': 'forfaitaire', 'libelle': 'pour la prestation'},
          ],
          'uniteParDefaut': 'forfaitaire',
          'valeurs': {
            'titre': 'titre 1',
            'metier': 'metier 1',
            'horaire': 'horaire 1',
            'quartier': 'quartier 1',
            'arrondissement': 'arrondissement 1',
            'prix': '8000',
            'unite_tarif': 'forfaitaire',
            'duree_estimee': '',
            'conditions': '',
          },
          'avertissement': {'phrase': 'phrase 1', 'conseil': 'conseil 1'},
        };

    test('les valeurs actuelles et les listes arrivent ensemble', () {
      final lu = ModificationDemande.depuisJson(modification());
      expect(lu.valeurs.prix, '8000');
      expect(lu.formulaire.metiers, ['metier 1']);
      expect(lu.avertissement!.phrase, 'phrase 1');
    });

    test("sans reponse, pas d'avertissement", () {
      final json = modification()..['avertissement'] = null;
      expect(ModificationDemande.depuisJson(json).avertissement, isNull);
    });
  });

  test("l'ecran de mise en avant se lit tel que le serveur l'a calcule", () {
    final disponible = InfoMiseEnAvant.depuisJson({
      'titre': 'titre 1',
      'metier': null,
      'lieu': null,
      'finActuelle': null,
      'disponible': true,
      'jours': 7,
      'cout': 'cout 1',
      'resteApres': 'reste 1',
      'solde': 'solde 1',
      'soldeSuffit': false,
    });
    expect(disponible.jours, 7);
    expect(disponible.soldeSuffit, isFalse);

    final indisponible = InfoMiseEnAvant.depuisJson({
      'titre': 'titre 1',
      'disponible': false,
      'solde': 'solde 1',
      'soldeSuffit': false,
    });
    expect(indisponible.cout, isNull);
    expect(() => InfoMiseEnAvant.depuisJson({'titre': 'titre 1'}), throwsA(isA<FormeInattendue>()));
  });

  group('la liste Mes messages', () {
    Map<String, dynamic> ligne({String? termineeLe}) => {
          'id': 4,
          'avec': 'nom 1',
          'titreDemande': 'titre 1',
          'phraseStatut': 'phrase 1',
          'nouveau': false,
          'phraseNonLus': null,
          'phraseMessages': 'messages 1',
          'dernierMessage': null,
          'termineeLe': termineeLe,
          'avisAttendu': termineeLe != null,
        };

    test('en cours et termines arrivent ranges, avec le compteur', () {
      final lu = MesDiscussions.depuisJson({
        'enCours': [ligne()],
        'terminees': [ligne(termineeLe: 'date 1')],
        'chapeauTerminees': {'fort': 'fort 1', 'suite': 'suite 1'},
        'vide': null,
        'aVoir': 2,
      });
      expect(lu.enCours.single.termineeLe, isNull);
      expect(lu.terminees.single.avisAttendu, isTrue);
      expect(lu.aVoir, 2);
      expect(lu.vide, isNull);
    });

    test('une liste vide dit pourquoi', () {
      final lu = MesDiscussions.depuisJson({
        'enCours': [],
        'terminees': [],
        'chapeauTerminees': {'fort': null, 'suite': 'suite 1'},
        'vide': {'phrase': 'phrase 1', 'aide': null},
        'aVoir': 0,
      });
      expect(lu.vide!.phrase, 'phrase 1');
      expect(lu.chapeauTerminees.fort, isNull);
    });
  });

  test("sans compteur, la personne n'a rien de nouveau", () {
    expect(Moi.depuisJson(_moi('employeur')).aVoir, 0);
    expect(Moi.depuisJson(_moi('employeur')..['aVoir'] = 3).aVoir, 3);
  });

  test("la fiche d'une personne se lit telle que le serveur l'ecrit", () {
    final lu = FichePersonne.depuisJson({
      'id': 6,
      'nom': 'nom 1',
      'metier': null,
      'verifiee': true,
      'libelleVerification': 'libelle 1',
      'note': {'etat': 'nouveau', 'badge': 'badge 1', 'detail': 'detail 1'},
      'badges': ['badge 2'],
      'trancheAge': null,
      'lieu': null,
      'disponibilites': [
        {'jour': 'Lundi', 'moments': 'Matin'},
      ],
      'tarif': 'tarif 1',
      'avis': {'moyenne': null, 'nombre': 0, 'liste': []},
      'peutPublier': true,
    });
    expect(lu.disponibilites.single.jour, 'Lundi');
    expect(lu.avis.moyenne, isNull);
    expect(lu.trancheAge, isNull);
  });

  test('le formulaire de signalement porte les phrases du serveur', () {
    final lu = FormulaireProbleme.depuisJson({
      'titreDemande': 'titre 1',
      'autre': 'nom 1',
      'dejaSignale': false,
      'consequences': 'phrase 1',
      'apresSignalement': 'phrase 2',
      'texteMax': 2000,
    });
    expect(lu.autre, 'nom 1');
    expect(lu.texteMax, 2000);
    expect(() => FormulaireProbleme.depuisJson({'autre': 'nom 1'}), throwsA(isA<FormeInattendue>()));
  });

  test('Mon profil se lit tel que le serveur l ecrit', () {
    final lu = MonProfil.depuisJson({
      'nom': 'nom 1',
      'fonction': 'fonction 1',
      'messageEquipe': {'texte': 'texte 1', 'le': 'date 1'},
      'avertissement': null,
      'verification': {'statut': 'verifie', 'libelle': 'libelle 1', 'attente': null},
      'lieu': null,
      'email': 'email 1',
      'badges': [],
      'trancheAge': null,
      'disponibilites': [],
      'tarif': null,
      'avis': {'moyenne': null, 'nombre': 0, 'liste': [], 'vide': 'phrase 1'},
      'servicesANoter': null,
      'motifRefus': null,
      'aLire': 1,
    });
    expect(lu.messageEquipe?.texte, 'texte 1');
    expect(lu.avertissement, isNull);
    expect(lu.tarif, isNull);
    expect(lu.avis.vide, 'phrase 1');
    expect(lu.aLire, 1);
    expect(() => MonProfil.depuisJson({'nom': 'nom 1'}), throwsA(isA<FormeInattendue>()));
  });

  test('un avis de son profil dit s il est deja signale', () {
    final avis = AvisPublic.depuisJson({
      'id': 3,
      'signale': true,
      'note': 'note 1',
      'auteur': 'nom 1',
      'criteres': [],
      'date': 'date 1',
      'titreDemande': null,
      'commentaire': null,
    });
    expect(avis.id, 3);
    expect(avis.signale, isTrue);
  });

  test('sans pastille de profil, rien n attend', () {
    expect(Moi.depuisJson(_moi('employeur')).aLire, 0);
  });

  test('le formulaire de mon profil garde les cases cochees par le serveur', () {
    Map<String, dynamic> formulaire(List<dynamic> creneaux) => {
          'nom': 'nom 1',
          'quartier': 'quartier 1',
          'arrondissement': null,
          'quartiers': ['quartier 1'],
          'arrondissements': ['arrondissement 1'],
          'pourPersonne': true,
          'metier': 'metier 1',
          'metiers': ['metier 1'],
          'dateNaissance': null,
          'anneesNaissance': {'de': 1, 'a': 2},
          'experienceAnnees': '',
          'experienceMax': 3,
          'moments': ['moment 1'],
          'jours': [
            {'libelle': 'jour 1', 'creneaux': creneaux},
          ],
          'tarif': '',
          'email': 'email 1',
          'motDePasseMin': 4,
        };
    final lu = FormulaireProfil.depuisJson(formulaire([
      {'valeur': 'valeur 1', 'libelle': 'moment 1', 'coche': true},
    ]));
    expect(lu.jours.single.creneaux.single.coche, isTrue);
    expect(lu.anneesNaissance?.a, 2);
    expect(lu.arrondissement, isNull);
    // Un jour sans case pour chaque moment ne tiendrait pas dans la grille.
    expect(() => FormulaireProfil.depuisJson(formulaire([])), throwsA(isA<FormeInattendue>()));
  });

  test("un changement d'adresse rend la phrase et la nouvelle adresse", () {
    final lu = AdresseChangee.depuisJson({'texte': 'phrase 1', 'email': 'email 2'});
    expect(lu.email, 'email 2');
    expect(() => AdresseChangee.depuisJson({'texte': 'phrase 1'}), throwsA(isA<FormeInattendue>()));
  });
}
