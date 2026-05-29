package com.tinyggrok.app.data.model

/**
 * Source (spoken) language selection. AUTO lets the server detect automatically.
 * The code is used as a hint in the system prompt and in input_audio_transcription.
 */
enum class SourceLanguage(val code: String, val displayName: String, val nativeName: String) {
    AUTO("auto", "Auto-detect", "Auto"),
    ARABIC("ar", "Arabic", "العربية"),
    CEBUANO("ceb", "Cebuano", "Bisaya"),
    CHINESE("zh", "Chinese", "中文"),
    ENGLISH("en", "English", "English"),
    FRENCH("fr", "French", "Français"),
    GERMAN("de", "German", "Deutsch"),
    HINDI("hi", "Hindi", "हिन्दी"),
    INDONESIAN("id", "Indonesian", "Bahasa Indonesia"),
    JAPANESE("ja", "Japanese", "日本語"),
    KOREAN("ko", "Korean", "한국어"),
    MALAY("ms", "Malay", "Bahasa Melayu"),
    MARATHI("mr", "Marathi", "मराठी"),
    PORTUGUESE_BR("pt-BR", "Portuguese (Brazil)", "Português BR"),
    PORTUGUESE_PT("pt-PT", "Portuguese (Portugal)", "Português PT"),
    SPANISH_ES("es-ES", "Spanish (Spain)", "Español ES"),
    SPANISH_MX("es-MX", "Spanish (Mexico)", "Español MX"),
    TAGALOG("fil", "Tagalog", "Filipino"),
    THAI("th", "Thai", "ภาษาไทย");

    companion object {
        fun fromName(name: String): SourceLanguage =
            values().find { it.name == name.uppercase() } ?: AUTO
    }
}

/** Supported translation (target) languages — sorted alphabetically. */
enum class TranslationLanguage(
    val code: String,
    val displayName: String,
    val nativeName: String
) {
    ARABIC("ar", "Arabic", "العربية"),
    CEBUANO("ceb", "Cebuano", "Bisaya"),
    CHINESE("zh", "Chinese", "中文"),
    ENGLISH("en", "English", "English"),
    FRENCH("fr", "French", "Français"),
    GERMAN("de", "German", "Deutsch"),
    HINDI("hi", "Hindi", "हिन्दी"),
    INDONESIAN("id", "Indonesian", "Bahasa Indonesia"),
    JAPANESE("ja", "Japanese", "日本語"),
    KOREAN("ko", "Korean", "한국어"),
    MALAY("ms", "Malay", "Bahasa Melayu"),
    MARATHI("mr", "Marathi", "मराठी"),
    PORTUGUESE_BR("pt-BR", "Portuguese (Brazil)", "Português BR"),
    PORTUGUESE_PT("pt-PT", "Portuguese (Portugal)", "Português PT"),
    SPANISH_ES("es-ES", "Spanish (Spain)", "Español ES"),
    SPANISH_MX("es-MX", "Spanish (Mexico)", "Español MX"),
    TAGALOG("fil", "Tagalog", "Filipino"),
    THAI("th", "Thai", "ภาษาไทย");

    companion object {
        fun fromName(name: String): TranslationLanguage =
            values().find { it.name == name.uppercase() } ?: ENGLISH
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS Voice options
// ─────────────────────────────────────────────────────────────────────────────

enum class VoiceOption(
    val id: String,
    val displayName: String,
    val gender: String,
    val description: String
) {
    EVE("eve", "Eve", "Female", "Energetic, upbeat, enthusiastic"),
    ARA("ara", "Ara", "Female", "Warm, friendly, balanced"),
    REX("rex", "Rex", "Male", "Confident, clear, professional"),
    SAL("sal", "Sal", "Neutral", "Smooth, balanced, versatile"),
    LEO("leo", "Leo", "Male", "Authoritative, strong, commanding");

    companion object {
        fun fromName(name: String): VoiceOption =
            values().find { it.name == name.uppercase() } ?: EVE
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Personality / mode presets
// ─────────────────────────────────────────────────────────────────────────────

enum class PersonalityMode(
    val id: String,
    val displayName: String,
    val description: String,
    val ageRestricted: Boolean,
    val emoji: String
) {
    ASSISTANT(     "assistant",      "Assistant",       "Default helpful, practical, informative",          false, "🤖"),
    THERAPIST(     "therapist",      "Therapist",       "Empathetic listener, supportive advice",           false, "🧠"),
    STORYTELLER(   "storyteller",    "Storyteller",     "Dramatic, immersive narrative style",              false, "📖"),
    KIDS_STORY(    "kids_story",     "Kids Story Time", "Fun, child-friendly storytelling",                 false, "🧸"),
    KIDS_TRIVIA(   "kids_trivia",    "Kids Trivia",     "Playful trivia and games for kids",                false, "🎲"),
    MEDITATION(    "meditation",     "Meditation / Zen","Calm, guiding, relaxing mindfulness voice",        false, "🧘"),
    GROK_DOC(      "grok_doc",       "Grok Doc",        "Medical-style advice (not a real doctor)",         false, "🩺"),
    MOTIVATION(    "motivation",     "Motivation",      "Energetic coach, hype & encouragement",            false, "💪"),
    PROFESSOR(     "professor",      "Professor",       "Academic, explanatory, scientific",                false, "🎓"),
    ROMANTIC(      "romantic",       "Romantic",        "Flirty, shy, affectionate  ·  18+",                true,  "💕"),
    SEXY(          "sexy",           "Sexy",            "Bold, flirtatious, NSFW-capable  ·  18+",          true,  "🔥"),
    UNHINGED(      "unhinged",       "Unhinged",        "Chaotic, curses, wild, insults  ·  18+",           true,  "🤪"),
    CONSPIRACY(    "conspiracy",     "Conspiracy",      "Wild theories, UFOs, Bigfoot & more",              false, "👽"),
    ARGUMENTATIVE( "argumentative",  "Argumentative",   "Debates and challenges your every idea",           false, "⚡"),
    LANGUAGE_TUTOR("language_tutor", "Language Tutor",  "Teaches languages, practices conversation",        false, "🌍");

    companion object {
        fun fromName(name: String): PersonalityMode =
            values().find { it.name == name.uppercase() } ?: ASSISTANT
    }
}

/** Lifecycle states for the realtime voice WebSocket session. */
enum class VoiceSessionState {
    IDLE,
    CONNECTING,
    ACTIVE,
    ERROR
}

/** A single line in the live transcript panel. */
data class TranscriptLine(
    val role: String,                              // "user" or "assistant"
    val text: String,
    val detectedLanguage: String? = null,          // user lines: detected input language
    val spokenLanguage: TranslationLanguage? = null // assistant lines: target language for TTS
)

/**
 * Cost summary for a voice session.
 * Voice Agent API pricing: $0.05 per minute ($3.00/hr).
 */
data class VoiceSessionCost(
    val durationSeconds: Long,
    val costUsd: Double
) {
    fun formatted(): String {
        val minutes = durationSeconds / 60.0
        return "Voice: %.1f min · \$%.4f".format(minutes, costUsd)
    }
}

/** Events emitted by [com.tinyggrok.app.data.repository.RealtimeVoiceRepository]. */
sealed class VoiceEvent {
    /** WebSocket open + session.created received — ready to speak. */
    object SessionCreated : VoiceEvent()

    /** Unrecoverable error; session is closed. */
    data class SessionError(val message: String) : VoiceEvent()

    /** WebSocket closed cleanly. */
    object SessionClosed : VoiceEvent()

    /** Server VAD detected speech start. */
    object SpeechStarted : VoiceEvent()

    /** Server VAD detected speech end. */
    object SpeechStopped : VoiceEvent()

    /** Partial user speech transcript (interim result). */
    data class TranscriptPartial(val text: String) : VoiceEvent()

    /** Final user speech transcript for a completed utterance.
     *  [serverLanguage] is the BCP-47 code returned by xAI STT if present (e.g. "fil", "de", "ko"). */
    data class TranscriptFinal(val text: String, val serverLanguage: String? = null) : VoiceEvent()

    /** Incremental assistant translation text chunk. */
    data class AssistantTextDelta(val text: String) : VoiceEvent()

    /** Assistant audio output started (first audio.delta received). */
    object AssistantAudioStarted : VoiceEvent()

    /** Assistant audio output finished. */
    object AssistantAudioEnded : VoiceEvent()

    /** Complete assistant translation text for one turn. */
    data class AssistantTextDone(val fullText: String) : VoiceEvent()
}
