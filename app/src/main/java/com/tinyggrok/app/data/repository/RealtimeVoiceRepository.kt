package com.tinyggrok.app.data.repository

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Context
import android.net.Uri as AndroidUri
import androidx.core.content.FileProvider
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import com.tinyggrok.app.data.model.PersonalityMode
import com.tinyggrok.app.data.model.SourceLanguage
import com.tinyggrok.app.data.model.TranslationLanguage
import com.tinyggrok.app.data.model.VoiceOption
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import com.tinyggrok.app.data.model.VoiceEvent
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale as JavaLocale
import javax.inject.Inject
import javax.inject.Singleton



/**
 * Manages a realtime bidirectional voice session against:
 *   wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0
 *
 * Audio flow:
 *   Microphone (AudioRecord, 16 kHz PCM16) → base64 → WebSocket input_audio_buffer.append
 *   WebSocket response.audio.delta → base64 decode → AudioTrack (24 kHz PCM16)
 *
 * Pricing: $0.05 / min  ($3.00 / hr)
 */
@Singleton
class RealtimeVoiceRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val okHttpClient: OkHttpClient,
    private val debugLogRepository: DebugLogRepository
) {
    companion object {
        private const val TAG = "VoiceRepo"
        private const val WS_URL =
            "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0"

        // Audio configuration
        private const val SAMPLE_RATE_IN = 24_000   // Hz — matches pcm16 (24 kHz) spec
        private const val SAMPLE_RATE_OUT = 24_000  // Hz — TTS output
        private const val BYTES_PER_SAMPLE = 2      // PCM 16-bit
        private const val CHUNK_MS = 100            // ms per audio chunk sent to server

        // Cost: $0.05 per minute of audio duration
        const val COST_PER_SECOND = 0.05 / 60.0

        // Base language codes supported by xAI's input transcription (auto-detect set).
        // Low-resource languages (e.g. Cebuano "ceb", Tagalog "fil") are intentionally
        // excluded — for those we omit the transcription language hint and let the
        // multilingual translation model handle the audio directly.
        private val STT_SUPPORTED_CODES = setOf(
            "ar", "zh", "en", "fr", "de", "hi", "id",
            "ja", "ko", "ms", "mr", "pt", "es", "th"
        )
    }

    // ---------------------------------------------------------------------------
    // Public event stream
    // ---------------------------------------------------------------------------

    private val _events = MutableSharedFlow<VoiceEvent>(
        replay = 0,
        extraBufferCapacity = 128
    )
    val events: SharedFlow<VoiceEvent> = _events

    // ---------------------------------------------------------------------------
    // Internal state
    // ---------------------------------------------------------------------------

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null

    private var recordingJob: Job? = null
    private var playbackJob: Job? = null

    /** Per-session channel. Replaced on each connect() to avoid leftover audio from prior sessions. */
    private var audioPlaybackChannel = Channel<ByteArray>(capacity = Channel.UNLIMITED)

    /** Set when session.created arrives; recording starts after this. */
    @Volatile
    private var sessionCreatedFlag = false

    /** Set when any terminal event (error/close) has already been emitted, to avoid double-emit. */
    @Volatile
    private var sessionTerminated = false

    /**
     * Guards against emitting duplicate AssistantTextDone for one response turn.
     * Both response.text.done AND response.audio_transcript.done may fire — we only
     * want the first non-empty one to produce a transcript bubble.
     */
    @Volatile
    private var responseTextEmitted = false
    /** Sentence count of the last recognised user utterance — used to truncate output. */
    private var lastInputSentenceCount = 1
    /**
     * Full (untruncated) output transcript for the current turn.
     * Set by output_audio_transcript.done BEFORE truncation so we can compute
     * the audio byte ratio at output_audio.done time.
     */
    private var lastOutputTranscriptFull = ""
    /** Truncated transcript for the current turn — used to key audioCache after clipping. */
    private var lastTruncatedTranscript = ""
    /** API key stored at connect() time — used by save/share after the session ends. */
    private var storedApiKey = ""
    /** Voice stored at connect() time — used by TTS save/share calls. */
    private var storedVoice: VoiceOption = VoiceOption.EVE

    /** Accumulates raw PCM bytes for the response turn currently in progress. */
    private val currentTurnAudio = ByteArrayOutputStream()

    /**
     * Cache of up to 10 past turns: transcript text → PCM bytes.
     * Used by replayAudio() to replay the exact Grok voice audio.
     */
    private val audioCache = object : LinkedHashMap<String, ByteArray>(10, 0.75f, true) {
        override fun removeEldestEntry(eldest: Map.Entry<String, ByteArray>) = size > 10
    }

    /** Latest completed turn audio bytes (most recent response). */
    @Volatile
    private var lastAudioBytes: ByteArray? = null

    /**
     * Tracks the current silent-mode state live so the WebSocket listener (which
     * closes over the value at connect time) can always see the up-to-date value
     * even after a mid-session switchLanguage() call.
     */
    @Volatile
    private var activeSilentMode: Boolean = false

    /** Live VAD threshold so mid-session language switches also update it. */
    @Volatile
    private var activeVadThreshold: Float = 0.5f

    /**
     * When true, microphone audio is NOT forwarded to the WebSocket.
     * Set during replay / TTS playback so the speaker output is not picked up
     * by the mic and fed back into the translation pipeline.
     */
    @Volatile
    private var micMuted = false

    /** Mute or unmute the microphone feed to the WebSocket. */
    fun setMicMuted(muted: Boolean) {
        micMuted = muted
    }

    // Offline recording state
    private var offlineRecordActive = false
    private var offlineOutputStream: java.io.FileOutputStream? = null
    private var offlineRecordFile: java.io.File? = null
    private var offlineTtsMediaPlayer: MediaPlayer? = null

    /** Standalone AudioRecord + coroutine used when Save Offline is tapped outside a live session. */
    private var standaloneRecorder: AudioRecord? = null
    private var standaloneRecordJob: Job? = null

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    /**
     * Opens the WebSocket and begins an audio session.
     * Caller is responsible for ensuring RECORD_AUDIO permission is granted.
     */
    @SuppressLint("MissingPermission")
    fun connect(
        apiKey: String,
        targetLanguage: TranslationLanguage,
        sourceLanguage: SourceLanguage = SourceLanguage.AUTO,
        voiceOption: VoiceOption = VoiceOption.EVE,
        personalityMode: PersonalityMode = PersonalityMode.ASSISTANT,
        silentMode: Boolean = false,
        vadThreshold: Float = 0.5f
    ) {
        disconnect()
        storedApiKey = apiKey
        storedVoice = voiceOption
        sessionCreatedFlag = false
        sessionTerminated = false
        activeSilentMode = silentMode
        activeVadThreshold = vadThreshold

        audioPlaybackChannel = Channel(capacity = Channel.UNLIMITED)

        debugLog("→ VOICE", "Connecting to $WS_URL", "Target: ${targetLanguage.displayName} | Source: ${sourceLanguage.displayName} | Voice: ${voiceOption.displayName} | Mode: ${personalityMode.displayName} | Silent: $silentMode")

        val request = Request.Builder()
            .url(WS_URL)
            .header("Authorization", "Bearer $apiKey")
            .build()

        webSocket = okHttpClient.newWebSocket(request, buildListener(targetLanguage, sourceLanguage, voiceOption, personalityMode, silentMode, vadThreshold))
        startPlayback()

        scope.launch {
            var waited = 0
            while (!sessionCreatedFlag && waited < 15_000) {
                delay(100)
                waited += 100
            }
            if (!sessionCreatedFlag && !sessionTerminated) {
                val msg = "Timed out after 15s waiting for session.created — " +
                        "check API key and network connectivity"
                debugLog("✗ VOICE", "Timeout", msg)
                emitTerminalError(msg)
            } else if (sessionCreatedFlag) {
                startRecording(targetLanguage)
            }
        }
    }

    /** Send an updated system prompt to switch the translation target/source language mid-session. */
    fun switchLanguage(
        targetLanguage: TranslationLanguage,
        sourceLanguage: SourceLanguage = SourceLanguage.AUTO,
        voiceOption: VoiceOption = VoiceOption.EVE,
        personalityMode: PersonalityMode = PersonalityMode.ASSISTANT,
        silentMode: Boolean = false,
        vadThreshold: Float = 0.5f
    ) {
        activeSilentMode = silentMode
        activeVadThreshold = vadThreshold
        val sessionJson = buildSessionJson(targetLanguage, sourceLanguage, voiceOption, personalityMode, silentMode, vadThreshold)
        webSocket?.send("""{"type":"session.update","session":$sessionJson}""")
    }

    /** Close WebSocket and release all audio resources safely. */
    fun disconnect() {
        // Snapshot references before nulling them so the release coroutine has them.
        val recorder = audioRecord
        val track    = audioTrack
        val job1     = recordingJob
        val job2     = playbackJob

        audioRecord   = null
        audioTrack    = null
        recordingJob  = null
        playbackJob   = null
        sessionCreatedFlag  = false
        sessionTerminated   = false
        responseTextEmitted = false

        // ── Step 1: stop the recorder NOW (on whichever thread called disconnect).
        //   AudioRecord.stop() causes any blocked read() on the IO thread to return
        //   immediately with ERROR_INVALID_OPERATION, which lets the recording coroutine
        //   exit its while-loop. Calling release() BEFORE the coroutine exits is what
        //   causes the native crash, so we must join() first (see Step 3).
        try { recorder?.stop() } catch (_: Exception) {}

        // ── Step 2: signal coroutines to stop.
        job1?.cancel()
        job2?.cancel()

        // ── Step 3: release native audio objects only after the coroutines have fully
        //   exited. We launch on IO so we can suspend with join().
        scope.launch {
            try { job1?.join() } catch (_: Exception) {}
            try { recorder?.release() } catch (_: Exception) {}

            try { job2?.join() } catch (_: Exception) {}
            try { track?.stop()    } catch (_: Exception) {}
            try { track?.release() } catch (_: Exception) {}

            Log.d(TAG, "Audio resources released")
        }

        // Close the WebSocket (safe to do immediately; callbacks will arrive on another thread).
        webSocket?.close(1000, "Disconnected by client")
        webSocket = null
    }

    /**
     * Replays the Grok voice audio associated with [text] (exact match from the cache).
     * Returns true if audio was found and playback was started, false if no cached audio exists
     * and the caller should fall back to Android TTS.
     */
    fun replayAudio(text: String): Boolean {
        val audio = synchronized(audioCache) { audioCache[text]?.copyOf() } ?: return false
        replayRawAudio(audio)
        return true
    }

    /**
     * Replays the most recent Grok voice audio regardless of transcript text.
     * Returns true if audio was available, false otherwise.
     */
    fun replayLastAudio(): Boolean {
        val audio = lastAudioBytes?.copyOf() ?: return false
        replayRawAudio(audio)
        return true
    }

    /**
     * Use the xAI TTS REST API to speak [text] in the Grok voice.
     * Plays via MediaPlayer (handles MP3 natively).
     * Returns true if playback was started, false on error.
     */
    suspend fun playTtsAudio(text: String, apiKey: String = storedApiKey, voice: VoiceOption = storedVoice): Boolean = withContext(Dispatchers.IO) {
        val key = apiKey.ifBlank { storedApiKey }
        if (key.isEmpty() || text.isBlank()) return@withContext false
        val mp3 = fetchTtsMp3WithKey(text, voice, key) ?: return@withContext false
        val cacheFile = java.io.File(context.cacheDir, "tts_replay.mp3")
        try {
            cacheFile.writeBytes(mp3)
            withContext(Dispatchers.Main) {
                offlineTtsMediaPlayer?.runCatching { stop(); release() }
                val mp = MediaPlayer()
                offlineTtsMediaPlayer = mp
                micMuted = true
                mp.setDataSource(cacheFile.absolutePath)
                mp.setOnCompletionListener { it.release(); if (offlineTtsMediaPlayer === it) offlineTtsMediaPlayer = null; micMuted = false }
                mp.setOnErrorListener { p, _, _ -> p.release(); if (offlineTtsMediaPlayer === p) offlineTtsMediaPlayer = null; micMuted = false; false }
                mp.prepareAsync()
                mp.setOnPreparedListener { it.start() }
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "playTtsAudio failed: ${e.message}")
            false
        }
    }

    // ── Offline recording ─────────────────────────────────────────────────────

    private fun offlineDir() = java.io.File(context.filesDir, "offline_recordings").also { it.mkdirs() }

    /** Start recording audio to a local file.
     *  If a WebSocket session is already running, audio arrives via [writeOfflineChunk].
     *  Otherwise a standalone AudioRecord is started so recording works without internet. */
    @SuppressLint("MissingPermission")
    fun startOfflineRecording(): Boolean {
        if (offlineRecordActive) return true
        return try {
            val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", JavaLocale.US).format(Date())
            val file = java.io.File(offlineDir(), "offline_$stamp.pcm")
            offlineRecordFile = file
            offlineOutputStream = java.io.FileOutputStream(file)
            offlineRecordActive = true

            // If no live session is running, start a standalone AudioRecord
            if (recordingJob == null || recordingJob?.isActive != true) {
                startStandaloneRecorder()
            }

            Log.d(TAG, "Offline recording started → ${file.name}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "startOfflineRecording failed: ${e.message}")
            false
        }
    }

    @SuppressLint("MissingPermission")
    private fun startStandaloneRecorder() {
        standaloneRecordJob?.cancel()
        val chunkBytes = SAMPLE_RATE_IN * BYTES_PER_SAMPLE * CHUNK_MS / 1000
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE_IN, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(
            android.media.MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE_IN, AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            maxOf(minBuf, chunkBytes * 4)
        )
        standaloneRecorder = rec
        rec.startRecording()
        standaloneRecordJob = scope.launch(Dispatchers.IO) {
            val buf = ByteArray(chunkBytes)
            while (isActive && offlineRecordActive) {
                val read = rec.read(buf, 0, chunkBytes)
                if (read > 0) writeOfflineChunk(buf, read)
            }
            rec.stop()
            rec.release()
            standaloneRecorder = null
        }
        Log.d(TAG, "Standalone recorder started for offline capture")
    }

    /** Stop offline recording. Converts the raw PCM to a WAV file and returns it, or null on error. */
    fun stopOfflineRecording(): java.io.File? {
        offlineRecordActive = false
        standaloneRecordJob?.cancel()
        standaloneRecordJob = null
        offlineOutputStream?.runCatching { flush(); close() }
        offlineOutputStream = null
        val pcmFile = offlineRecordFile
        offlineRecordFile = null
        if (pcmFile?.exists() != true || pcmFile.length() == 0L) return null
        return try {
            val pcmBytes = pcmFile.readBytes()
            val wavBytes = pcmToWav(pcmBytes, SAMPLE_RATE_IN, 1, BYTES_PER_SAMPLE * 8)
            val wavFile = java.io.File(pcmFile.parent, pcmFile.nameWithoutExtension + ".wav")
            wavFile.writeBytes(wavBytes)
            pcmFile.delete()
            wavFile
        } catch (e: Exception) {
            Log.e(TAG, "stopOfflineRecording WAV conversion failed: ${e.message}")
            pcmFile // fall back to returning the raw PCM file
        }
    }

    /** Write a chunk to the offline file if recording is active. Called from startRecording loop. */
    fun writeOfflineChunk(buffer: ByteArray, bytesRead: Int) {
        if (offlineRecordActive) {
            offlineOutputStream?.runCatching { write(buffer, 0, bytesRead) }
        }
    }

    /** List all saved offline recordings, newest first. */
    fun getOfflineRecordings(): List<java.io.File> =
        offlineDir().listFiles { f -> f.extension == "wav" || f.extension == "pcm" }
            ?.sortedByDescending { it.lastModified() }
            ?: emptyList()

    /** Delete an offline recording file. */
    fun deleteOfflineRecording(file: java.io.File) {
        file.delete()
    }

    /**
     * Send a saved PCM offline recording over the WebSocket for translation.
     * The app must be connected (call connect() first).
     */
    fun processOfflineRecording(file: java.io.File) {
        if (!file.exists()) return
        scope.launch {
            Log.d(TAG, "Processing offline recording: ${file.name} (${file.length()} bytes)")
            val chunkSize = SAMPLE_RATE_IN * BYTES_PER_SAMPLE * CHUNK_MS / 1000
            val buffer = ByteArray(chunkSize)
            try {
                java.io.FileInputStream(file).use { fis ->
                    while (true) {
                        val bytesRead = fis.read(buffer)
                        if (bytesRead <= 0) break
                        val b64 = Base64.encodeToString(buffer.copyOf(bytesRead), Base64.NO_WRAP)
                        webSocket?.send("""{"type":"input_audio_buffer.append","audio":"$b64"}""")
                        delay(CHUNK_MS.toLong()) // pace to match real-time
                    }
                }
                // Commit the audio buffer so the server processes it
                webSocket?.send("""{"type":"input_audio_buffer.commit"}""")
            } catch (e: Exception) {
                Log.e(TAG, "processOfflineRecording failed: ${e.message}")
            }
        }
    }

    /** POST to xAI /v1/tts with explicit key and return raw MP3 bytes, or null on error. */
    private fun fetchTtsMp3WithKey(text: String, voice: VoiceOption, apiKey: String): ByteArray? = try {
        val body = org.json.JSONObject().apply {
            put("text", text)
            put("voice_id", voice.name.lowercase())
            put("language", "en")
            put("response_format", "mp3")
        }.toString().toRequestBody("application/json".toMediaType())

        val request = okhttp3.Request.Builder()
            .url("https://api.x.ai/v1/tts")
            .header("Authorization", "Bearer $apiKey")
            .post(body)
            .build()

        val response = okHttpClient.newCall(request).execute()
        if (!response.isSuccessful) {
            Log.e(TAG, "TTS REST error: HTTP ${response.code} — ${response.body?.string()?.take(200)}")
            null
        } else {
            response.body?.bytes()
        }
    } catch (e: Exception) {
        Log.e(TAG, "fetchTtsMp3WithKey failed: ${e.message}")
        null
    }

    /**
     * Save the translation for [text] (or the most recent translation if [text] is blank) as
     * an MP3 file in the public Downloads folder, using the xAI TTS REST endpoint.
     * Returns the display file name on success, null on failure.
     */
    suspend fun saveAudioToDownloads(text: String): String? = withContext(Dispatchers.IO) {
        val transcript = text.ifBlank { lastTruncatedTranscript }.ifBlank { return@withContext null }
        if (storedApiKey.isEmpty()) { Log.e(TAG, "saveAudioToDownloads: no API key"); return@withContext null }

        val mp3Bytes = fetchTtsMp3(transcript, storedVoice) ?: return@withContext null

        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", JavaLocale.US).format(Date())
        val fileName = "ggrok_$stamp.mp3"

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val cv = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, "audio/mpeg")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv) ?: return@withContext null
                resolver.openOutputStream(uri)?.use { it.write(mp3Bytes) }
                cv.clear(); cv.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, cv, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                dir.mkdirs()
                java.io.File(dir, fileName).writeBytes(mp3Bytes)
            }
            Log.d(TAG, "Saved MP3 → $fileName")
            fileName
        } catch (e: Exception) {
            Log.e(TAG, "saveAudioToDownloads failed: ${e.message}")
            null
        }
    }

    /**
     * Fetch MP3 for [text] from the xAI TTS REST endpoint, write it to the app's cache dir,
     * and return a FileProvider content:// URI suitable for an ACTION_SEND share intent.
     */
    suspend fun getAudioUri(text: String): android.net.Uri? = withContext(Dispatchers.IO) {
        val transcript = text.ifBlank { lastTruncatedTranscript }.ifBlank { return@withContext null }
        if (storedApiKey.isEmpty()) { Log.e(TAG, "getAudioUri: no API key"); return@withContext null }

        val mp3Bytes = fetchTtsMp3(transcript, storedVoice) ?: return@withContext null

        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", JavaLocale.US).format(Date())
        val fileName = "ggrok_$stamp.mp3"
        try {
            val cacheDir = java.io.File(context.cacheDir, "voice_audio").also { it.mkdirs() }
            val file = java.io.File(cacheDir, fileName)
            file.writeBytes(mp3Bytes)
            FileProvider.getUriForFile(context, "com.tinyggrok.app.fileprovider", file)
        } catch (e: Exception) {
            Log.e(TAG, "getAudioUri failed: ${e.message}")
            null
        }
    }

    /** POST to xAI /v1/tts and return raw MP3 bytes, or null on error. */
    private fun fetchTtsMp3(text: String, voice: VoiceOption): ByteArray? = try {
        val body = org.json.JSONObject().apply {
            put("text", text)
            put("voice_id", voice.name.lowercase())
            put("language", "en")
            put("response_format", "mp3")
        }.toString().toRequestBody("application/json".toMediaType())

        val request = okhttp3.Request.Builder()
            .url("https://api.x.ai/v1/tts")
            .header("Authorization", "Bearer $storedApiKey")
            .post(body)
            .build()

        val response = okHttpClient.newCall(request).execute()
        if (!response.isSuccessful) {
            Log.e(TAG, "TTS REST error: HTTP ${response.code} — ${response.body?.string()?.take(200)}")
            null
        } else {
            response.body?.bytes()
        }
    } catch (e: Exception) {
        Log.e(TAG, "fetchTtsMp3 failed: ${e.message}")
        null
    }

    // ── WAV serialisation (kept for replay; not used for save/share) ──────────

    private fun pcmToWav(pcm: ByteArray, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        val dataSize = pcm.size
        val out = ByteArrayOutputStream(44 + dataSize)

        fun le4(v: Int) { out.write(v and 0xFF); out.write((v shr 8) and 0xFF); out.write((v shr 16) and 0xFF); out.write((v shr 24) and 0xFF) }
        fun le2(v: Int) { out.write(v and 0xFF); out.write((v shr 8) and 0xFF) }
        fun ascii(s: String) { s.forEach { c -> out.write(c.code) } }

        ascii("RIFF");  le4(36 + dataSize)   // ChunkID + ChunkSize
        ascii("WAVE")                          // Format
        ascii("fmt ");  le4(16)               // Subchunk1ID + Subchunk1Size (PCM = 16)
        le2(1)                                 // AudioFormat: PCM
        le2(channels)
        le4(sampleRate)
        le4(byteRate)
        le2(blockAlign)
        le2(bitsPerSample)
        ascii("data"); le4(dataSize)           // Subchunk2ID + Subchunk2Size
        out.write(pcm)
        return out.toByteArray()
    }

    private fun replayRawAudio(audio: ByteArray) {
        scope.launch(Dispatchers.IO) {
            micMuted = true
            try {
                val minBuf = AudioTrack.getMinBufferSize(
                    SAMPLE_RATE_OUT,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                val bufSize = maxOf(minBuf, 4096)
                val track = AudioTrack(
                    AudioManager.STREAM_MUSIC,
                    SAMPLE_RATE_OUT,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufSize,
                    AudioTrack.MODE_STREAM
                )
                track.play()
                var offset = 0
                while (offset < audio.size) {
                    val end = minOf(offset + bufSize, audio.size)
                    val written = track.write(audio, offset, end - offset)
                    if (written <= 0) break
                    offset += written
                }
                // Wait for the last chunk to drain before releasing
                val durationMs = (audio.size.toLong() * 1000L) / (SAMPLE_RATE_OUT * BYTES_PER_SAMPLE)
                delay(durationMs + 300)
                track.stop()
                track.release()
            } catch (e: Exception) {
                Log.e(TAG, "replayRawAudio failed: ${e.message}")
            } finally {
                micMuted = false
            }
        }
    }

    // ---------------------------------------------------------------------------
    // WebSocket listener
    // ---------------------------------------------------------------------------

    private fun buildListener(
        targetLanguage: TranslationLanguage,
        sourceLanguage: SourceLanguage,
        voiceOption: VoiceOption = VoiceOption.EVE,
        personalityMode: PersonalityMode = PersonalityMode.ASSISTANT,
        silentMode: Boolean = false,
        vadThreshold: Float = 0.5f
    ) = object : WebSocketListener() {

        override fun onOpen(ws: WebSocket, response: Response) {
            Log.d(TAG, "WebSocket open — sending session.update")
            val sessionJson = buildSessionJson(targetLanguage, sourceLanguage, voiceOption, personalityMode, silentMode, vadThreshold)
            val msg = """{"type":"session.update","session":$sessionJson}"""
            debugLog("→ OUT", "session.update [${sourceLanguage.displayName} → ${targetLanguage.displayName}] voice=${voiceOption.id} mode=${personalityMode.id} silent=$silentMode", sessionJson)
            ws.send(msg)
        }

        override fun onMessage(ws: WebSocket, text: String) {
            handleServerEvent(text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            val httpCode = response?.code?.let { " (HTTP $it)" } ?: ""
            val httpBody = response?.body?.string()?.take(500) ?: ""
            val detail = buildString {
                append("Throwable: ${t.javaClass.simpleName}: ${t.message}")
                if (httpCode.isNotEmpty()) append("\nHTTP status$httpCode")
                if (httpBody.isNotEmpty()) append("\nResponse body: $httpBody")
            }
            Log.e(TAG, "WebSocket failure: $detail")
            debugLog("✗ VOICE", "WebSocket failure$httpCode", detail)
            emitTerminalError(t.message ?: "WebSocket connection failed")
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "WebSocket closed: $code $reason")
            debugLog("← VOICE", "WebSocket closed", "code=$code reason=$reason")
            emitEvent(VoiceEvent.SessionClosed)
        }
    }

    // ---------------------------------------------------------------------------
    // Server event handler
    // ---------------------------------------------------------------------------

    private fun handleServerEvent(json: String) {
        try {
            val obj = JSONObject(json)
            val type = obj.optString("type")

            when (type) {

                "session.created" -> {
                    Log.d(TAG, "session.created")
                    markSessionReady("session.created", json.take(300))
                }

                "session.updated" -> {
                    Log.d(TAG, "session.updated")
                    debugLog("← IN", "session.updated", "Session config accepted by server")
                }

                // xAI sends conversation.created instead of (or before) session.created.
                // Treat it as the "session ready" signal when session.created hasn't arrived yet.
                "conversation.created" -> {
                    Log.d(TAG, "conversation.created")
                    val convId = runCatching {
                        JSONObject(json).optJSONObject("conversation")?.optString("id") ?: ""
                    }.getOrDefault("")
                    debugLog("← IN", "conversation.created", "id=$convId — session ready")
                    markSessionReady("conversation.created", json.take(300))
                }

                "input_audio_buffer.speech_started" -> {
                    debugLog("← IN", "speech_started", "VAD detected speech begin")
                    emitEvent(VoiceEvent.SpeechStarted)
                }

                "input_audio_buffer.speech_stopped" -> {
                    debugLog("← IN", "speech_stopped", "VAD detected speech end")
                    emitEvent(VoiceEvent.SpeechStopped)
                }

                "conversation.item.input_audio_transcription.delta" -> {
                    val delta = obj.optString("delta", "")
                    if (delta.isNotEmpty()) emitEvent(VoiceEvent.TranscriptPartial(delta))
                }

                "conversation.item.input_audio_transcription.completed" -> {
                    val transcript = obj.optString("transcript", "")
                    val serverLang = obj.optString("language", "").ifBlank { null }
                    debugLog(
                        "← IN", "transcription.completed",
                        "language=${serverLang ?: "none"} transcript=\"$transcript\"\nfull: $json"
                    )
                    if (transcript.isNotEmpty()) {
                        // Record how many sentences the user spoke so the output can be truncated
                        lastInputSentenceCount = countSentences(transcript)
                        emitEvent(VoiceEvent.TranscriptFinal(transcript, serverLang))
                    }
                }

                // Reset per-response dedup flag when a new response starts
                "response.created" -> {
                    responseTextEmitted = false
                    lastOutputTranscriptFull = ""
                    lastTruncatedTranscript = ""
                    currentTurnAudio.reset()
                    debugLog("← IN", "response.created", "New response turn started")
                }

                // xAI sends response.output_audio.delta / response.output_audio.done
                "response.output_audio.delta", "response.audio.delta" -> {
                    val b64 = obj.optString("delta", "")
                    if (b64.isNotEmpty() && !activeSilentMode) {
                        val pcmBytes = Base64.decode(b64, Base64.NO_WRAP)
                        // Buffer only — we defer playback until output_audio.done so we can
                        // truncate the audio to match the transcript sentence count.
                        synchronized(currentTurnAudio) { currentTurnAudio.write(pcmBytes) }
                    }
                }

                "response.output_audio.done", "response.audio.done" -> {
                    if (activeSilentMode) {
                        // In text-only mode discard any audio the server sent (some xAI versions
                        // still emit audio events even with modalities=["text"]).
                        synchronized(currentTurnAudio) { currentTurnAudio.reset() }
                        debugLog("← SKIP", "output_audio.done", "Silent mode — audio discarded")
                    } else {
                        // Snapshot the full accumulated audio for this turn
                        val fullSnap = synchronized(currentTurnAudio) { currentTurnAudio.toByteArray() }
                        if (fullSnap.isEmpty()) {
                            debugLog("← IN", "output_audio.done", "No audio buffered — skipping")
                        } else {
                            // Trim the audio to match the sentence count of the input utterance.
                            // output_audio_transcript.done fires before this event, so
                            // lastOutputTranscriptFull is already set.
                            val audioToPlay = if (lastOutputTranscriptFull.isNotEmpty()) {
                                val truncated = truncateToSentences(lastOutputTranscriptFull, lastInputSentenceCount)
                                if (truncated.length < lastOutputTranscriptFull.length) {
                                    // Estimate PCM byte cut-point proportionally to character count,
                                    // then round down to nearest 16-bit (2-byte) boundary.
                                    val ratio = truncated.length.toFloat() / lastOutputTranscriptFull.length.toFloat()
                                    val keepBytes = ((fullSnap.size * ratio).toInt() / 2) * 2
                                    val clipped = fullSnap.copyOf(keepBytes.coerceIn(2, fullSnap.size))
                                    debugLog("← TRIM", "output_audio.done",
                                        "Audio clipped: ${fullSnap.size} → ${clipped.size} bytes " +
                                        "(${lastInputSentenceCount} of ${countSentences(lastOutputTranscriptFull)} sentences)")
                                    clipped
                                } else fullSnap
                            } else fullSnap

                            lastAudioBytes = audioToPlay
                            // Update audioCache with the correctly clipped audio so Save/Share work.
                            if (lastTruncatedTranscript.isNotEmpty()) {
                                synchronized(audioCache) { audioCache[lastTruncatedTranscript] = audioToPlay }
                            }
                            debugLog("← IN", "output_audio.done",
                                "Playing ${audioToPlay.size} bytes (buffered, then trimmed)")
                            emitEvent(VoiceEvent.AssistantAudioStarted)
                            scope.launch { audioPlaybackChannel.send(audioToPlay) }
                            emitEvent(VoiceEvent.AssistantAudioEnded)
                        }
                    }
                }

                // Text-only mode: xAI sends response.text.* when modalities=["text"]
                "response.text.delta" -> {
                    if (!responseTextEmitted) {
                        val delta = obj.optString("delta", "")
                        if (delta.isNotEmpty()) emitEvent(VoiceEvent.AssistantTextDelta(delta))
                    }
                }

                "response.text.done" -> {
                    val raw = obj.optString("text", "")
                    val text = truncateToSentences(raw, lastInputSentenceCount)
                    if (raw != text) debugLog("← TRIM", "response.text.done",
                        "Truncated ${countSentences(raw)} → $lastInputSentenceCount sentences")
                    debugLog("← IN", "response.text.done", "\"$text\"")
                    if (text.isNotEmpty() && !responseTextEmitted) {
                        responseTextEmitted = true
                        emitEvent(VoiceEvent.AssistantTextDone(text))
                    }
                }

                // xAI uses response.output_audio_transcript.* (not response.audio_transcript.*)
                "response.output_audio_transcript.delta" -> {
                    if (!responseTextEmitted) {
                        val delta = obj.optString("delta", "")
                        if (delta.isNotEmpty()) emitEvent(VoiceEvent.AssistantTextDelta(delta))
                    }
                }

                "response.output_audio_transcript.done" -> {
                    val raw = obj.optString("transcript", "")
                    // Save the full transcript BEFORE truncation so output_audio.done
                    // can compute the proportional audio clip point.
                    lastOutputTranscriptFull = raw
                    val transcript = truncateToSentences(raw, lastInputSentenceCount)
                    if (raw != transcript) debugLog("← TRIM", "output_audio_transcript.done",
                        "Truncated ${countSentences(raw)} → $lastInputSentenceCount sentences")
                    debugLog("← IN", "output_audio_transcript.done", "\"$transcript\"")
                    // Store the truncated transcript so output_audio.done can key the audioCache.
                    // Do NOT write to audioCache here — audio buffering is still in progress.
                    lastTruncatedTranscript = transcript
                    if (transcript.isNotEmpty() && !responseTextEmitted) {
                        responseTextEmitted = true
                        emitEvent(VoiceEvent.AssistantTextDone(transcript))
                    }
                }

                // xAI may deliver the final transcript via content_part.done
                "response.content_part.done" -> {
                    val part = obj.optJSONObject("part")
                    val raw = (part?.optString("transcript", "") ?: "").ifBlank {
                        part?.optString("text", "") ?: ""
                    }
                    val resolved = truncateToSentences(raw, lastInputSentenceCount)
                    if (raw != resolved) debugLog("← TRIM", "content_part.done",
                        "Truncated ${countSentences(raw)} → $lastInputSentenceCount sentences")
                    debugLog("← IN", "content_part.done", "\"$resolved\"")
                    if (resolved.isNotEmpty() && !responseTextEmitted) {
                        responseTextEmitted = true
                        emitEvent(VoiceEvent.AssistantTextDone(resolved))
                    }
                }

                // xAI may also deliver transcript inside output_item.done
                "response.output_item.done" -> {
                    val item = obj.optJSONObject("item")
                    val content = item?.optJSONArray("content")
                    if (content != null && !responseTextEmitted) {
                        for (i in 0 until content.length()) {
                            val part = content.optJSONObject(i) ?: continue
                            val raw = part.optString("transcript", "").ifBlank {
                                part.optString("text", "")
                            }
                            val t = truncateToSentences(raw, lastInputSentenceCount)
                            if (t.isNotEmpty()) {
                                responseTextEmitted = true
                                if (raw != t) debugLog("← TRIM", "output_item.done",
                                    "Truncated ${countSentences(raw)} → $lastInputSentenceCount sentences")
                                debugLog("← IN", "output_item.done transcript", "\"$t\"")
                                emitEvent(VoiceEvent.AssistantTextDone(t))
                                break
                            }
                        }
                    }
                }

                "response.done" -> {
                    val usage = obj.optJSONObject("response")?.optJSONObject("usage")
                    val usageSummary = usage?.let {
                        "input_tokens=${it.optInt("input_tokens")} " +
                        "output_tokens=${it.optInt("output_tokens")}"
                    } ?: "no usage info"
                    debugLog("← IN", "response.done", usageSummary)
                }

                "error" -> {
                    val errObj = obj.optJSONObject("error") ?: obj
                    val msg = errObj.optString("message", "Unknown server error")
                    val code = errObj.optString("code", "")
                    val detail = buildString {
                        append("message: $msg")
                        if (code.isNotEmpty()) append("\ncode: $code")
                        append("\nfull: $json")
                    }
                    Log.e(TAG, "Server error: $detail")
                    debugLog("✗ ERROR", "server error${if (code.isNotEmpty()) " ($code)" else ""}", detail)
                    emitTerminalError(msg)
                }

                else -> {
                    // Log unrecognised event types for debugging
                    if (type.isNotEmpty()) {
                        debugLog("← IN", type, json.take(200))
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse server event: ${e.message}")
            debugLog("✗ VOICE", "Parse error", "msg=${e.message}\nraw=${json.take(300)}")
        }
    }

    // ---------------------------------------------------------------------------
    // Sentence-count utilities (client-side output trimming)
    // ---------------------------------------------------------------------------

    /**
     * Count the number of sentences in [text] by looking for terminal punctuation
     * (. ! ?) followed by whitespace or end of string.
     * Returns at least 1.
     */
    private fun countSentences(text: String): Int =
        Regex("""[.!?]+(?:\s|$)""").findAll(text.trim()).count().coerceAtLeast(1)

    /**
     * Truncate [text] so that it contains at most [maxSentences] sentences.
     * If the text already has ≤ maxSentences, it is returned unchanged.
     * Uses terminal punctuation as sentence boundaries.
     */
    private fun truncateToSentences(text: String, maxSentences: Int): String {
        if (maxSentences <= 0) return text
        val trimmed = text.trim()
        val matches = Regex("""[.!?]+(?:\s|$)""").findAll(trimmed).toList()
        if (matches.size <= maxSentences) return trimmed
        // Cut at the end of the Nth terminal-punctuation match
        val cutAt = matches[maxSentences - 1].range.last + 1
        return trimmed.substring(0, cutAt).trim()
    }

    // ---------------------------------------------------------------------------
    // Session configuration JSON
    // ---------------------------------------------------------------------------

    private fun buildSessionJson(
        targetLanguage: TranslationLanguage,
        sourceLanguage: SourceLanguage = SourceLanguage.AUTO,
        voiceOption: VoiceOption = VoiceOption.EVE,
        personalityMode: PersonalityMode = PersonalityMode.ASSISTANT,
        silentMode: Boolean = false,
        vadThreshold: Float = 0.5f
    ): String {
        return JSONObject().apply {
            put("modalities", org.json.JSONArray().apply {
                put("text")
                if (!silentMode) put("audio")
            })
            // voice and audio format only apply when audio output is requested
            if (!silentMode) {
                put("voice", voiceOption.id)
                put("output_audio_format", "pcm16")
            }
            put("instructions", buildSystemPrompt(targetLanguage, sourceLanguage, personalityMode))
            put("input_audio_format", "pcm16")
            // Lower temperature = more deterministic, fewer hallucinated extra words/sentences.
            // Higher = more creative. 0.4 is a good balance for translation work.
            put("temperature", 0.4)
            // Cap output tokens to prevent runaway generation. 500 is ample for any
            // single-utterance translation; unlimited default allows the model to ramble.
            put("max_response_output_tokens", 500)
            put("turn_detection", JSONObject().apply {
                put("type", "server_vad")
                put("threshold", vadThreshold.toDouble())
                put("prefix_padding_ms", 300)
                put("silence_duration_ms", 700)
            })
            put("input_audio_transcription", JSONObject().apply {
                if (sourceLanguage != SourceLanguage.AUTO) {
                    // Normalise region variants (e.g. "pt-BR" → "pt") and only pass codes the
                    // STT model actually supports. Low-resource languages such as Cebuano are
                    // NOT in xAI's transcription set — passing an unsupported code can make the
                    // transcriber return nothing. For those we omit the language and let the
                    // multilingual translation model (driven by the system-prompt hint) handle it.
                    val baseCode = sourceLanguage.code.substringBefore('-').lowercase()
                    if (baseCode in STT_SUPPORTED_CODES) {
                        put("language", baseCode)
                    }
                }
            })
        }.toString()
    }

    private fun buildSystemPrompt(
        targetLanguage: TranslationLanguage,
        sourceLanguage: SourceLanguage = SourceLanguage.AUTO,
        personalityMode: PersonalityMode = PersonalityMode.ASSISTANT
    ): String {
        val targetName = targetLanguage.displayName

        val sourcePart = if (sourceLanguage == SourceLanguage.AUTO)
            "Detect the spoken language automatically. The input may be a regional or " +
                "low-resource language (for example Cebuano/Bisaya, Tagalog, or another " +
                "Philippine or Southeast-Asian language). Translate it into $targetName " +
                "regardless of how uncommon the source language is. Only treat the input as " +
                "already-translated if it is genuinely $targetName."
        else
            "The speaker is speaking ${sourceLanguage.displayName}. Treat ALL input audio as " +
                "${sourceLanguage.displayName} and translate it into $targetName."


        val personalityInstruction = when (personalityMode) {
            PersonalityMode.ASSISTANT      -> ""
            PersonalityMode.THERAPIST      -> "Deliver the translation in a warm, empathetic, calm tone as if you are a caring therapist."
            PersonalityMode.STORYTELLER    -> "Deliver the translation with a dramatic, immersive storytelling flair."
            PersonalityMode.KIDS_STORY     -> "Deliver the translation in a fun, child-friendly, playful way."
            PersonalityMode.KIDS_TRIVIA    -> "Deliver the translation enthusiastically as if it's part of a fun kids' trivia game."
            PersonalityMode.MEDITATION     -> "Deliver the translation slowly, softly, and serenely as if guiding a meditation."
            PersonalityMode.GROK_DOC       -> "Deliver the translation with a professional, clinical tone as if you are a doctor explaining something."
            PersonalityMode.MOTIVATION     -> "Deliver the translation with high energy and motivational enthusiasm."
            PersonalityMode.PROFESSOR      -> "Deliver the translation in a measured, academic, scholarly manner."
            PersonalityMode.ROMANTIC       -> "Deliver the translation in a gentle, flirtatious, affectionate tone."
            PersonalityMode.SEXY           -> "Deliver the translation in a bold, confident, sensual tone."
            PersonalityMode.UNHINGED       -> "Deliver the translation in a chaotic, wild, intensely expressive manner."
            PersonalityMode.CONSPIRACY     -> "Deliver the translation as if sharing a secret conspiracy theory — hushed, excited, dramatic."
            PersonalityMode.ARGUMENTATIVE  -> "Deliver the translation in a challenging, slightly confrontational, debate-style tone."
            PersonalityMode.LANGUAGE_TUTOR -> "Deliver the translation clearly and pedagogically, as a language teacher would to a student."
        }

        val personalitySection = if (personalityInstruction.isNotEmpty())
            "\n\nTONE / STYLE: $personalityInstruction\nIMPORTANT: The TONE instruction only affects HOW you speak the translation. The CONTENT rule above still applies — output ONLY the translated words.\n"
        else ""

        return """
You are a MUTE translation pipe. Input: spoken audio. Output: the translation in $targetName. That is ALL you do.

═══════════════════════════════════════════════════════
NON-NEGOTIABLE RULES — violating any one is a critical error:
═══════════════════════════════════════════════════════
R1.  Output ONLY the translated text. Stop the moment the translation ends.
R2.  NEVER repeat the input words. NEVER echo back what the speaker said.
R3.  NEVER add ANY word, phrase, or sentence that was not in the original input.
R4.  NEVER add: commentary, explanations, notes, labels, coaching, greetings, sign-offs, follow-up questions, clarifications, or filler of any kind.
R5.  Sentence-count rule — if the input contains N sentences, the output contains EXACTLY N sentences. One sentence in → one sentence out. Two sentences in → two sentences out.
R6.  Word-count discipline — if the input has N meaningful words, the output has N translated words. No extra words of any kind.
R7.  Same-language rule — if the input is already in $targetName, output it exactly as-is, unchanged, no additions.
R8.  NEVER identify or name the language. NEVER say "This is [language]" or anything similar.
R9.  NEVER continue the speaker's sentence, complete it, or add words they might have said next.
R10. Each utterance is completely isolated. No memory, no continuation, no context across turns.
R11. NEVER add a follow-up question, offer of help, or polite expansion to any greeting or short phrase.

═══════════════════════════════════════════════════════
ABSOLUTELY FORBIDDEN OUTPUT EXAMPLES (never produce these):
═══════════════════════════════════════════════════════
✗ Input: "Bonjour, monsieur."  →  BAD: "Maayong buntag, sir. Unsa'y akong mahimo para kanimo?"  ← added follow-up question not in input
✗ Input: "Hello."  →  BAD: "Kumusta. Ano ang mayroon ka?"  ← added a question not in input
✗ "Un, deux, trois. Test réussi."  ← added commentary
✗ "Isa, dalawa, tatlo. Bilangin mo ulit para masanay."  ← added coaching
✗ "Usa, duha, tulo. Kini ang Tagalog nga mga numero."  ← added label
✗ "Translation: ..."  ← label forbidden
✗ "In $targetName: ..."  ← preamble forbidden

═══════════════════════════════════════════════════════
CORRECT OUTPUT EXAMPLES:
═══════════════════════════════════════════════════════
✓ Input: "Bonjour, monsieur."  →  Output: [the $targetName equivalent of "Hello, sir."] — then STOP immediately.
✓ Input: "one, two, three"  →  Output: [the three $targetName number words] — then STOP.
✓ Input: "where is the bathroom?"  →  Output: [the $targetName question] — then STOP.
✓ Input already in $targetName  →  Output: exactly that input — then STOP.

$sourcePart$personalitySection

Target language: $targetName.
        """.trimIndent()
    }

    // ---------------------------------------------------------------------------
    // Audio: Microphone → WebSocket
    // ---------------------------------------------------------------------------

    @SuppressLint("MissingPermission")
    private fun startRecording(targetLanguage: TranslationLanguage) {
        val chunkBytes = SAMPLE_RATE_IN * BYTES_PER_SAMPLE * CHUNK_MS / 1000  // 3200 bytes @100ms
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE_IN,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuf, chunkBytes * 4)

        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE_IN,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )

        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            emitEvent(VoiceEvent.SessionError("Failed to initialize microphone"))
            recorder.release()
            return
        }

        audioRecord = recorder
        recorder.startRecording()
        Log.d(TAG, "Microphone recording started")

        recordingJob = scope.launch {
            val buffer = ByteArray(chunkBytes)
            while (isActive) {
                val bytesRead = recorder.read(buffer, 0, chunkBytes)
                if (bytesRead > 0) {
                    // Drop audio while replaying to prevent feedback into the pipeline
                    if (!micMuted) {
                        val b64 = Base64.encodeToString(buffer.copyOf(bytesRead), Base64.NO_WRAP)
                        webSocket?.send("""{"type":"input_audio_buffer.append","audio":"$b64"}""")
                        writeOfflineChunk(buffer, bytesRead)
                    }
                }
                // bytesRead <= 0 means recorder was stopped externally; exit cleanly
                if (bytesRead == AudioRecord.ERROR_INVALID_OPERATION ||
                    bytesRead == AudioRecord.ERROR_DEAD_OBJECT) {
                    Log.d(TAG, "AudioRecord signalled stop ($bytesRead) — exiting loop")
                    break
                }
            }
            Log.d(TAG, "Recording coroutine exiting — stop/release handled by disconnect()")
            // DO NOT call recorder.stop() here — disconnect() already called it and will
            // call release() after this coroutine finishes (via job.join()).
        }
    }

    // ---------------------------------------------------------------------------
    // Audio: WebSocket → Speaker
    // ---------------------------------------------------------------------------

    private fun startPlayback() {
        val minBuf = AudioTrack.getMinBufferSize(
            SAMPLE_RATE_OUT,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuf, SAMPLE_RATE_OUT * BYTES_PER_SAMPLE) // ≥1 second

        @Suppress("DEPRECATION")
        val track = AudioTrack(
            AudioManager.STREAM_MUSIC,
            SAMPLE_RATE_OUT,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
            AudioTrack.MODE_STREAM
        )

        if (track.state != AudioTrack.STATE_INITIALIZED) {
            Log.e(TAG, "AudioTrack failed to initialize")
            track.release()
            return
        }

        audioTrack = track
        track.play()
        Log.d(TAG, "AudioTrack playback started")

        playbackJob = scope.launch {
            for (pcmBytes in audioPlaybackChannel) {
                track.write(pcmBytes, 0, pcmBytes.size)
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    /**
     * Mark the session as ready. Called on either session.created or conversation.created,
     * whichever arrives first. Idempotent — only the first call takes effect.
     */
    private fun markSessionReady(trigger: String, logBody: String) {
        if (!sessionCreatedFlag) {
            sessionCreatedFlag = true
            debugLog("← IN", trigger, logBody)
            emitEvent(VoiceEvent.SessionCreated)
        }
    }

    /** Emit a [VoiceEvent.SessionError] only once per session (prevent double-emit on timeout). */
    private fun emitTerminalError(message: String) {
        if (!sessionTerminated) {
            sessionTerminated = true
            emitEvent(VoiceEvent.SessionError(message))
        }
    }

    private fun emitEvent(event: VoiceEvent) {
        scope.launch { _events.emit(event) }
    }

    /** Always writes to DebugLogRepository — visibility in the UI is gated by debugMode. */
    private fun debugLog(direction: String, summary: String, body: String) {
        scope.launch {
            debugLogRepository.logVoice(direction, "[Voice] $summary", body)
        }
    }
}
