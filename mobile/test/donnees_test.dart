// Ce que l'application lit du serveur, et comment elle le presente.
//
// Ces tests tournent sur l'ordinateur, sans telephone ni serveur : ils
// verifient que les reponses de l'API, sous leur forme reelle, sont lues
// sans rien deviner.
import 'package:flutter_test/flutter_test.dart';
import 'package:pamconnect/api.dart';
import 'package:pamconnect/ecran_demandes.dart';
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

  group('la separation des roles', () {
    test('la personne qui repond aux demandes entre', () {
      expect(Moi.depuisJson(_moi('prestataire')).repondAuxDemandes, isTrue);
    });

    test("l'employeur et l'equipe n'entrent pas dans cette premiere version", () {
      expect(Moi.depuisJson(_moi('employeur')).repondAuxDemandes, isFalse);
      expect(Moi.depuisJson(_moi('equipe')).repondAuxDemandes, isFalse);
    });
  });

  group('une demande', () {
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
    test("le http:// oublie est ajoute, et la barre finale retiree", () {
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
}
