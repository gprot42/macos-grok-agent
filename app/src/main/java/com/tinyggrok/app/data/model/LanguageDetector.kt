package com.tinyggrok.app.data.model

/**
 * Spoken-language detector for the 6 Voice Translator languages.
 *
 * Priority:
 *  1. [fromBcp47]     — server-supplied BCP-47 code (most reliable, use when present)
 *  2. [detect]        — client heuristic:
 *       • CJK scripts  → unambiguous Unicode block match
 *       • Latin script → scored word-frequency against German / Tagalog vocabularies;
 *                        "English" is the correct fallback for any remaining Latin text
 */
object LanguageDetector {

    // ── BCP-47 → display name ─────────────────────────────────────────────────

    fun fromBcp47(code: String): String? {
        if (code.isBlank()) return null
        val prefix = code.lowercase().take(3).trimEnd('-')
        return when (prefix) {
            "en"       -> "English"
            "fil", "tl" -> "Tagalog"
            "de"       -> "German"
            "zh"       -> "Chinese"
            "ja"       -> "Japanese"
            "ko"       -> "Korean"
            "fr"       -> "French"
            "es"       -> "Spanish"
            "it"       -> "Italian"
            "pt"       -> "Portuguese"
            "ru"       -> "Russian"
            "ar"       -> "Arabic"
            "hi"       -> "Hindi"
            else       -> code   // show raw code for unlisted languages
        }
    }

    // ── Client heuristic ──────────────────────────────────────────────────────

    fun detect(text: String): String? {
        if (text.isBlank()) return null

        // 1. CJK / unique-script blocks — unambiguous
        if (text.any { it.code in 0xAC00..0xD7AF || it.code in 0x1100..0x11FF }) return "Korean"
        if (text.any { it.code in 0x3040..0x309F || it.code in 0x30A0..0x30FF }) return "Japanese"
        if (text.any { it.code in 0x4E00..0x9FFF }) return "Chinese"

        // 2. Latin diacritics — instant language signal
        if (text.any { it in GERMAN_DIACRITICS }) return "German"
        if (text.any { it in FRENCH_DIACRITICS }) return "French"

        // 3. Scored word-frequency for Latin scripts
        val words = text.lowercase()
            .split(Regex("[\\s,\\.!\\?;:\"'\\-]+"))
            .filter { it.length >= 2 }
            .toSet()

        val germanScore  = words.count { it in GERMAN_WORDS }
        val frenchScore  = words.count { it in FRENCH_UNIQUE } * 3 +
                           words.count { it in FRENCH_COMMON }
        // Unique Tagalog words (weight ×3) + common particles (weight ×1)
        val tagalogScore = words.count { it in TAGALOG_UNIQUE } * 3 +
                           words.count { it in TAGALOG_PARTICLES }

        // Pick highest-scoring language; English is the default for remaining Latin
        val scores = mapOf(
            "German"  to germanScore,
            "French"  to frenchScore,
            "Tagalog" to tagalogScore
        )
        val best = scores.maxByOrNull { it.value }
        return when {
            best != null && best.value >= 2 -> best.key
            best != null && best.value == 1 -> best.key   // single strong word is enough
            else                            -> "English"
        }
    }

    // ── Vocabularies ──────────────────────────────────────────────────────────

    private val GERMAN_DIACRITICS = setOf('ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü')

    /** French-exclusive diacritics not found in German (ê â î ô û ç œ æ and accented variants). */
    private val FRENCH_DIACRITICS = setOf(
        'é', 'è', 'ê', 'ë', 'à', 'â', 'î', 'ï', 'ô', 'û', 'ù', 'ç', 'œ', 'æ',
        'É', 'È', 'Ê', 'À', 'Â', 'Î', 'Ô', 'Û', 'Ç', 'Œ'
    )

    private val GERMAN_WORDS = setOf(
        // Common pronouns, articles, verbs
        "ich", "bin", "bist", "ist", "sind", "war", "waren", "wäre", "wird",
        "das", "die", "der", "den", "dem", "des", "ein", "eine", "einen",
        "einem", "einer", "eines", "kein", "keine",
        "und", "oder", "aber", "auch", "noch", "nicht", "schon", "sehr",
        "wir", "ihr", "sie", "er", "du", "mein", "dein", "sein",
        "wie", "was", "wer", "wann", "wo", "warum", "woher", "wohin",
        "von", "mit", "auf", "für", "über", "nach", "bei", "aus", "an", "zu",
        "immer", "wenn", "weil", "dass", "dann", "also", "hier", "dort",
        "gut", "hallo", "danke", "bitte", "nein", "ja", "guten", "morgen",
        "heute", "haben", "hat", "hatte", "kann", "könnte", "mehr", "viel",
        "alles", "nichts", "jeden", "jetzt", "schon",
        // Numbers (unambiguously German — will NOT appear in English sentences)
        "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "neun",
        "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn",
        "sechzehn", "siebzehn", "achtzehn", "neunzehn", "zwanzig",
        "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig",
        "neunzig", "hundert", "tausend",
        // Days (unique German forms)
        "montag", "dienstag", "mittwoch", "donnerstag", "freitag",
        "samstag", "sonntag",
        // Greetings & common phrases
        "tschüss", "wiedersehen", "entschuldigung", "willkommen",
        "nacht", "abend", "tag", "deutsch", "deutschland", "herr", "frau",
        "kinder", "kind", "hause", "zuhause", "arbeit", "schule",
        "machen", "macht", "gemacht", "gehen", "geht", "kommen", "kommt",
        "sagen", "sagt", "fragen", "fragt", "finden", "findet",
        "groß", "klein", "neu", "alt", "schön", "schlecht",
        "jetzt", "heute", "gestern", "morgen"
    )

    /** Distinctively French words unlikely to appear in English, German, or Tagalog. */
    private val FRENCH_UNIQUE = setOf(
        "bonjour", "bonsoir", "salut", "merci", "oui", "voila", "voilà",
        "pourquoi", "parce", "aussi", "avec", "dans", "sur", "sous",
        "très", "beaucoup", "peu", "bien", "mal", "vrai", "faux",
        "monsieur", "madame", "mademoiselle",
        "avoir", "être", "faire", "aller", "venir", "voir", "vouloir",
        "pouvoir", "savoir", "devoir", "falloir", "prendre",
        "français", "france", "paris",
        // Numbers (unique French forms)
        "zéro", "deux", "trois", "quatre", "cinq", "sept", "huit", "neuf",
        "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
        "vingt", "trente", "cinquante", "soixante", "cent", "mille",
        // Days (unique French)
        "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche",
        // Common greetings
        "bienvenue", "enchanté", "enchantée", "aurevoir", "excusez", "pardon"
    )

    /** Common French function words — short but reinforce the score. */
    private val FRENCH_COMMON = setOf(
        "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
        "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
        "un", "une", "les", "des", "du", "au", "aux",
        "est", "sont", "mais", "donc", "car", "que", "qui", "quoi",
        "comment", "quand", "où", "quel", "quelle"
    )

    /** Uniquely Tagalog words — rare/impossible in English or German. */
    private val TAGALOG_UNIQUE = setOf(
        "kumusta", "salamat", "maganda", "magandang", "mahal", "mabuti",
        "hindi", "opo", "huwag", "pwede", "gusto", "ayaw", "alam", "siguro",
        "meron", "wala", "lahat", "kahit", "palagi", "minsan", "lagi",
        "paano", "bakit", "saan", "sino", "pala", "diba",
        "tayo", "kami", "kayo", "nila", "namin", "natin",
        "kanila", "kaniya", "niya",
        "ngayon", "bukas", "kahapon",
        "ganun", "ganito", "ganoon", "yung", "yun",
        "dito", "diyan", "doon",
        "talaga", "kasi", "naman"
    )

    /** Common Tagalog particles/function words — may overlap with abbreviations in other languages. */
    private val TAGALOG_PARTICLES = setOf(
        "ang", "mga", "sa", "ko", "mo", "ka", "si", "siya",
        "ba", "po", "lang", "din", "rin", "daw", "raw",
        "man", "pa", "nga", "ito", "iyan", "iyon", "na", "ng"
    )
}
