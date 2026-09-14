import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'ecran_connexion.dart';
import 'elements.dart';
import 'modeles.dart';
import 'theme.dart';

const _aideArrondissementDepart = "Rempli automatiquement d'après votre quartier.";

/// Publier une demande : le formulaire du site, champ pour champ.
///
/// L'ecran ne verifie rien lui-meme. Il envoie ce que la personne a saisi,
/// et c'est le serveur qui refuse, avec la phrase que le site affiche aussi.
/// En cas de succes, il rend la confirmation a l'ecran Mes demandes.
class EcranPublier extends StatefulWidget {
  const EcranPublier({super.key, required this.api, this.demandeId});

  final ApiPamConnect api;

  /// Present pour modifier une demande existante : le meme formulaire,
  /// prerempli. Absent pour en publier une nouvelle.
  final int? demandeId;

  @override
  State<EcranPublier> createState() => _EcranPublierState();
}

class _EcranPublierState extends State<EcranPublier> {
  FormulaireDemande? _formulaire;

  /// En modification : "1 personne a deja repondu...", formule par le serveur.
  AvertissementModification? _avertissement;

  // En modification : les valeurs de depart des deux champs a suggestions.
  String _metierDepart = '';
  String _quartierDepart = '';

  /// Le serveur refuse d'ouvrir le formulaire, par exemple a un employeur
  /// dont l'identite n'est pas encore verifiee.
  String? _refus;
  String? _erreurChargement;

  final _titre = TextEditingController();
  final _horaire = TextEditingController();
  final _prix = TextEditingController();
  final _duree = TextEditingController();
  final _conditions = TextEditingController();

  // Le metier et le quartier ont une liste de suggestions, qui cree son
  // propre controleur : on le garde pour lire la saisie a l'envoi.
  TextEditingController? _metier;
  TextEditingController? _quartier;

  String? _arrondissement;
  String? _unite;
  String _aideArrondissement = _aideArrondissementDepart;
  Timer? _attenteQuartier;
  int _rechercheQuartier = 0;

  String? _erreurEnvoi;
  bool _envoi = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  @override
  void dispose() {
    _attenteQuartier?.cancel();
    for (final controleur in [_titre, _horaire, _prix, _duree, _conditions]) {
      controleur.dispose();
    }
    super.dispose();
  }

  Future<void> _reessayer() async {
    setState(() => _erreurChargement = null);
    await _charger();
  }

  Future<void> _charger() async {
    try {
      final demandeId = widget.demandeId;
      final FormulaireDemande formulaire;
      ModificationDemande? modification;
      if (demandeId == null) {
        formulaire = await widget.api.formulaireDemande();
      } else {
        modification = await widget.api.modificationDemande(demandeId);
        formulaire = modification.formulaire;
      }
      if (!mounted) return;
      setState(() {
        _formulaire = formulaire;
        _unite = formulaire.uniteParDefaut;
        if (modification != null) _preremplir(formulaire, modification);
      });
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        if (erreur.refus) {
          _refus = erreur.message;
        } else {
          _erreurChargement = erreur.message;
        }
      });
    }
  }

  /// Ce qui est ecrit aujourd'hui dans la demande. Une valeur absente des
  /// listes (un ancien arrondissement mal ecrit, par exemple) n'est pas
  /// selectionnee : la liste deroulante ne pourrait pas l'afficher.
  void _preremplir(FormulaireDemande formulaire, ModificationDemande modification) {
    final valeurs = modification.valeurs;
    _titre.text = valeurs.titre;
    _horaire.text = valeurs.horaire;
    _prix.text = valeurs.prix;
    _duree.text = valeurs.dureeEstimee;
    _conditions.text = valeurs.conditions;
    _metierDepart = valeurs.metier;
    _quartierDepart = valeurs.quartier;
    if (formulaire.arrondissements.contains(valeurs.arrondissement)) {
      _arrondissement = valeurs.arrondissement;
    }
    if (formulaire.unitesTarif.any((unite) => unite.valeur == valeurs.uniteTarif)) {
      _unite = valeurs.uniteTarif;
    }
    _avertissement = modification.avertissement;
  }

  /// Ce que la liste propose pendant la saisie. Un simple filtre
  /// d'affichage : on peut toujours ecrire un nom absent de la liste,
  /// comme sur le site.
  Iterable<String> _suggestions(List<String> liste, String saisie) {
    final cherche = saisie.trim().toLowerCase();
    if (cherche.isEmpty) return const Iterable<String>.empty();
    return liste.where((nom) => nom.toLowerCase().contains(cherche));
  }

  /// L'arrondissement s'affiche avant l'envoi, comme sur le site. C'est le
  /// serveur qui le trouve, synonymes compris : l'application ne recopie
  /// pas sa regle. A l'envoi, il refait de toute facon le calcul.
  void _quartierChange(String texte) {
    _attenteQuartier?.cancel();
    if (texte.trim().isEmpty) {
      setState(() => _aideArrondissement = _aideArrondissementDepart);
      return;
    }
    // Une courte attente : on ne questionne pas le serveur a chaque lettre.
    _attenteQuartier = Timer(const Duration(milliseconds: 400), () => _chercherQuartier(texte));
  }

  Future<void> _chercherQuartier(String texte) async {
    final numero = ++_rechercheQuartier;
    try {
      final lieu = await widget.api.quartier(texte);
      // Une reponse plus ancienne que la derniere saisie est ignoree.
      if (!mounted || numero != _rechercheQuartier) return;
      final arrondissements = _formulaire?.arrondissements ?? const <String>[];
      setState(() {
        if (lieu.connu && arrondissements.contains(lieu.arrondissement)) {
          _arrondissement = lieu.arrondissement;
          _aideArrondissement = "Trouvé d'après votre quartier.";
        } else {
          _aideArrondissement = "Ce quartier n'est pas encore dans notre liste : "
              "choisissez vous-même l'arrondissement.";
        }
      });
    } on ErreurApi {
      // Rien a montrer : l'aide reste telle quelle, et le serveur trouvera
      // l'arrondissement a l'envoi.
    }
  }

  Future<void> _publier() async {
    if (_envoi) return;
    setState(() {
      _envoi = true;
      _erreurEnvoi = null;
    });

    try {
      final champs = {
        'titre': _titre.text,
        'metier': _metier?.text ?? '',
        'horaire': _horaire.text,
        'quartier': _quartier?.text ?? '',
        'arrondissement': _arrondissement ?? '',
        'prix': _prix.text,
        'unite_tarif': _unite ?? '',
        'duree_estimee': _duree.text,
        'conditions': _conditions.text,
      };
      final demandeId = widget.demandeId;
      // Dans les deux cas, l'ecran rend la phrase du serveur a Mes demandes.
      final texte = demandeId == null
          ? (await widget.api.publierDemande(champs)).texte
          : (await widget.api.modifierDemande(demandeId, champs)).texte;
      if (!mounted) return;
      Navigator.of(context).pop(texte);
    } on ErreurApi catch (erreur) {
      if (!mounted) return;
      if (erreur.sessionPerdue) {
        revenirALaConnexion(context, widget.api, messageSessionPerdue);
        return;
      }
      setState(() {
        _envoi = false;
        _erreurEnvoi = erreur.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.demandeId == null ? 'Publier une demande' : 'Modifier ma demande')),
      body: SafeArea(child: _corps(context)),
    );
  }

  Widget _corps(BuildContext context) {
    final refus = _refus;
    final erreurChargement = _erreurChargement;
    final formulaire = _formulaire;

    if (refus != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [Avertissement(texte: refus)],
      );
    }
    if (erreurChargement != null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Avertissement(texte: erreurChargement),
          const SizedBox(height: 16),
          FilledButton(onPressed: _reessayer, child: const Text('Réessayer')),
        ],
      );
    }
    if (formulaire == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final gris = Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encreDouce);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (widget.demandeId == null) ...[
          Text(
            "Dites ce dont vous avez besoin et quand. Les personnes que l'horaire "
            'arrange vous répondront.',
            style: gris,
          ),
          const SizedBox(height: 16),
          // Ce qui arrive a l'argent, annonce AVANT le formulaire, comme sur
          // le site.
          const _CarteSomme(),
        ] else ...[
          Text(
            "Corrigez ce qui doit l'être. Les personnes qui consultent vos demandes "
            'verront la nouvelle version.',
            style: gris,
          ),
          if (_avertissement != null) ...[
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_avertissement!.phrase, style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Couleurs.encre)),
                    const SizedBox(height: 8),
                    Text(_avertissement!.conseil, style: gris),
                  ],
                ),
              ),
            ),
          ],
        ],
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: _champs(context, formulaire),
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _champs(BuildContext context, FormulaireDemande formulaire) {
    const espace = SizedBox(height: 16);
    final aide = Theme.of(context).textTheme.bodyMedium?.copyWith(color: Couleurs.encrePale);
    final erreurEnvoi = _erreurEnvoi;

    return [
      TextField(
        controller: _titre,
        textCapitalization: TextCapitalization.sentences,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: "Description de l'offre",
          hintText: 'ex : Ménage deux fois par semaine',
        ),
      ),
      espace,
      _champAvecSuggestions(
        liste: formulaire.metiers,
        libelle: 'Qui cherchez-vous ?',
        exemple: 'ex : Ménage à domicile',
        valeurDepart: _metierDepart,
        garder: (controleur) => _metier = controleur,
      ),
      espace,
      TextField(
        controller: _horaire,
        textCapitalization: TextCapitalization.sentences,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: "Quand avez-vous besoin de quelqu'un ?",
          hintText: 'ex : Lundi et jeudi, 8h à 12h',
        ),
      ),
      espace,
      // Le nom du quartier suffit : jamais l'adresse exacte.
      _champAvecSuggestions(
        liste: formulaire.quartiers,
        libelle: 'Votre quartier',
        exemple: 'ex : Bastos, Mvan, Biyem-Assi...',
        aide: "Indiquez le quartier, nous trouvons l'arrondissement.",
        valeurDepart: _quartierDepart,
        garder: (controleur) => _quartier = controleur,
        auChangement: _quartierChange,
      ),
      espace,
      InputDecorator(
        decoration: InputDecoration(
          labelText: 'Arrondissement',
          helperText: _aideArrondissement,
          helperMaxLines: 3,
        ),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String?>(
            value: _arrondissement,
            isExpanded: true,
            isDense: true,
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('Non précisé')),
              for (final arrondissement in formulaire.arrondissements)
                DropdownMenuItem<String?>(value: arrondissement, child: Text(arrondissement)),
            ],
            onChanged: (choix) => setState(() => _arrondissement = choix),
          ),
        ),
      ),
      const SizedBox(height: 24),
      const TitreSection('Le prix que vous payez'),
      Text(
        "C'est vous qui fixez le prix de ce service. Les candidates répondront "
        'si ce montant leur convient.',
        style: aide,
      ),
      espace,
      TextField(
        controller: _prix,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: 'Le prix (FCFA)',
          hintText: 'ex : 10000',
        ),
      ),
      espace,
      InputDecorator(
        decoration: const InputDecoration(labelText: "Ce montant, c'est…"),
        child: DropdownButtonHideUnderline(
          child: DropdownButton<String>(
            value: _unite,
            isExpanded: true,
            isDense: true,
            items: [
              for (final unite in formulaire.unitesTarif)
                DropdownMenuItem<String>(value: unite.valeur, child: Text(unite.libelle)),
            ],
            onChanged: (choix) {
              if (choix != null) setState(() => _unite = choix);
            },
          ),
        ),
      ),
      espace,
      TextField(
        controller: _duree,
        textCapitalization: TextCapitalization.sentences,
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(
          labelText: 'Combien de temps, à votre avis ? (facultatif)',
          hintText: 'ex : Environ 3 heures',
        ),
      ),
      espace,
      TextField(
        controller: _conditions,
        textCapitalization: TextCapitalization.sentences,
        maxLines: null,
        decoration: const InputDecoration(
          labelText: 'Quelque chose à savoir avant de venir ? (facultatif)',
          hintText: 'ex : Il y a un chien. Deuxième étage sans ascenseur.',
        ),
      ),
      const SizedBox(height: 24),
      // Le refus du serveur s'affiche juste au-dessus du bouton, la ou la
      // personne regarde apres avoir appuye.
      if (erreurEnvoi != null) ...[
        Avertissement(texte: erreurEnvoi),
        espace,
      ],
      FilledButton(
        onPressed: _envoi ? null : _publier,
        child: _envoi
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: Couleurs.bleuFonce),
              )
            : Text(widget.demandeId == null ? 'Publier ma demande' : 'Enregistrer les modifications'),
      ),
      const SizedBox(height: 8),
      OutlinedButton(
        onPressed: _envoi ? null : () => Navigator.of(context).pop(),
        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
        child: const Text('Annuler'),
      ),
    ];
  }

  Widget _champAvecSuggestions({
    required List<String> liste,
    required String libelle,
    required String exemple,
    required void Function(TextEditingController) garder,
    String valeurDepart = '',
    String? aide,
    void Function(String)? auChangement,
  }) {
    return Autocomplete<String>(
      initialValue: TextEditingValue(text: valeurDepart),
      optionsBuilder: (saisie) => _suggestions(liste, saisie.text),
      onSelected: (choix) => auChangement?.call(choix),
      fieldViewBuilder: (context, controleur, focus, valider) {
        garder(controleur);
        return TextField(
          controller: controleur,
          focusNode: focus,
          autocorrect: false,
          textInputAction: TextInputAction.next,
          onChanged: auChangement,
          onSubmitted: (_) => valider(),
          decoration: InputDecoration(
            labelText: libelle,
            hintText: exemple,
            helperText: aide,
            helperMaxLines: 2,
          ),
        );
      },
    );
  }
}

/// "Ce qui arrive a la somme que vous annoncez", le texte du site.
class _CarteSomme extends StatelessWidget {
  const _CarteSomme();

  @override
  Widget build(BuildContext context) {
    final texte = Theme.of(context).textTheme;
    final paragraphe = texte.bodyMedium?.copyWith(color: Couleurs.encreDouce);
    const gras = TextStyle(fontWeight: FontWeight.w600);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Couleurs.bleuClair,
        borderRadius: BorderRadius.circular(rayon),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(
              'Ce qui arrive à la somme que vous annoncez',
              style: texte.titleMedium?.copyWith(
                color: Couleurs.bleuFonce,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(text: 'Dès la publication, elle est '),
                TextSpan(text: 'bloquée par PamConnect', style: gras),
                TextSpan(
                  text: ". Les personnes qui vous répondent savent ainsi que l'argent "
                      'existe avant de se déplacer chez vous.',
                ),
              ],
            ),
            style: paragraphe,
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(
                  text: 'Après chaque service effectué, déclarez-le obligatoirement.',
                  style: gras,
                ),
                TextSpan(
                  text: " C'est cette déclaration qui verse la somme à la personne qui a "
                      "travaillé. Sans elle, elle n'est pas payée, et un désaccord s'ouvre "
                      'pour rien.',
                ),
              ],
            ),
            style: paragraphe,
          ),
          const SizedBox(height: 8),
          Text.rich(
            const TextSpan(
              children: [
                TextSpan(
                  text: 'Si vous retirez votre demande sans avoir choisi personne, la somme '
                      'vous est rendue. Les montants sont ',
                ),
                TextSpan(text: 'simulés', style: gras),
                TextSpan(text: ' : aucun argent réel ne circule encore.'),
              ],
            ),
            style: texte.bodySmall?.copyWith(color: Couleurs.encrePale),
          ),
        ],
      ),
    );
  }
}
