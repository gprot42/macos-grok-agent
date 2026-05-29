package com.tinyggrok.app.ui.screens

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AllInclusive
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.tinyggrok.app.data.model.SourceLanguage
import com.tinyggrok.app.data.model.TranslationLanguage
import com.tinyggrok.app.data.model.VoiceSessionState
import com.tinyggrok.app.ui.viewmodel.VoiceTranslatorViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceTranslatorScreen(
    onNavigateBack: () -> Unit,
    onNavigateToSettings: () -> Unit = {},
    onNavigateToDebugLogs: () -> Unit = {},
    viewModel: VoiceTranslatorViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var showAbout by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val coroutineScope = rememberCoroutineScope()

    // Disconnect cleanly whenever the screen leaves composition (back navigation, etc.)
    // so the OS never kills a stale WebSocket and causes "Software caused connection abort".
    DisposableEffect(Unit) {
        onDispose { viewModel.stopSession() }
    }

    // Runtime permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            viewModel.startSession()
        }
    }

    val listState = rememberLazyListState()
    LaunchedEffect(uiState.transcriptLines.size) {
        if (uiState.transcriptLines.isNotEmpty()) {
            listState.animateScrollToItem(uiState.transcriptLines.size - 1)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Voice Translator") },
                navigationIcon = {},
                actions = {
                    if (uiState.debugMode) {
                        TextButton(onClick = onNavigateToDebugLogs) {
                            Text("Logs")
                        }
                    }
                    TextButton(onClick = onNavigateToSettings) {
                        Text("Settings")
                    }
                }
            )
        }
    ) { innerPadding ->

        // ── About dialog ─────────────────────────────────────────────────────
        if (showAbout) {
            AlertDialog(
                onDismissRequest = { showAbout = false },
                icon = {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(28.dp)
                    )
                },
                title = {
                    Text(
                        text = "About Voice Translator",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold
                    )
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "Tiny Ggrok Voice Translator turns your spoken words into translated speech in real time.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        HorizontalDivider()
                        AboutRow(label = "How it works",
                            value = "Your microphone audio is streamed live over a secure WebSocket to xAI's Grok Voice API. " +
                                    "Grok detects the spoken language, translates it into the target language you chose, " +
                                    "and streams the translated voice back — all in one round trip with no extra STT or TTS calls.")
                        HorizontalDivider()
                        AboutRow(label = "AI model", value = "grok-voice-think-fast-1.0 (xAI Realtime API)")
                        AboutRow(label = "Transport", value = "WebSocket — wss://api.x.ai/v1/realtime")
                        AboutRow(label = "Audio format", value = "PCM 16-bit, 24 kHz, mono")
                        AboutRow(label = "Languages", value = "Cebuano, Chinese, English, French, German, Hindi, Japanese, Korean, Malay, Tagalog, Thai")
                        HorizontalDivider()
                        AboutRow(label = "Source detection",
                            value = "Automatic by default — Grok identifies the language from audio. " +
                                    "You can override it by selecting a source language in the dropdown.")
                        AboutRow(label = "Replay",
                            value = "The speaker button under each translation replays the exact Grok voice audio — not a TTS re-synthesis.")
                        HorizontalDivider()
                        AboutRow(label = "Privacy",
                            value = "Audio is sent directly to xAI servers using your API key. " +
                                    "No audio is stored locally beyond the current session.")
                    }
                },
                confirmButton = {
                    TextButton(onClick = { showAbout = false }) { Text("Close") }
                }
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {

            // ── Language selectors (source + target) with flip button ─────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.weight(1f)) {
                    SourceLanguageSelector(
                        selected = uiState.sourceLanguage,
                        onSelect = viewModel::setSourceLanguage
                    )
                }

                // ── Flip / swap button ────────────────────────────────────────
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.secondaryContainer)
                        .clickable(
                            enabled = uiState.sourceLanguage != SourceLanguage.AUTO
                        ) { viewModel.flipLanguages() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.SwapHoriz,
                        contentDescription = "Swap languages",
                        modifier = Modifier.size(20.dp),
                        tint = if (uiState.sourceLanguage != SourceLanguage.AUTO)
                            MaterialTheme.colorScheme.onSecondaryContainer
                        else
                            MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.35f)
                    )
                }

                Box(modifier = Modifier.weight(1f)) {
                    TargetLanguageSelector(
                        selected = uiState.targetLanguage,
                        onSelect = viewModel::setTargetLanguage
                    )
                }
            }

            // ── Transcript view ──────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) {
                if (uiState.transcriptLines.isEmpty() &&
                    uiState.partialTranscript.isEmpty() &&
                    uiState.partialAssistantText.isEmpty()
                ) {
                    Text(
                        text = when {
                            uiState.sessionState == VoiceSessionState.IDLE ->
                                "Tap the mic button to start translating."
                            uiState.sessionState == VoiceSessionState.CONNECTING ->
                                "Connecting to Grok Voice…"
                            uiState.sessionState == VoiceSessionState.ERROR ->
                                uiState.errorMessage ?: "An error occurred."
                            uiState.isUserSpeaking ->
                                "Hearing you…"
                            uiState.isAssistantSpeaking || uiState.partialAssistantText.isNotEmpty() ->
                                "Translating…"
                            else ->
                                "Ready — speak to translate"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.outline,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(Alignment.Center)
                    )
                } else {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(uiState.transcriptLines) { line ->
                            TranscriptBubble(
                                role = line.role,
                                text = line.text,
                                targetLanguage = uiState.targetLanguage,
                                detectedLanguage = line.detectedLanguage,
                                onSpeak = line.spokenLanguage?.let { lang ->
                                    { viewModel.speakTranslation(line.text, lang) }
                                },
                                onSave = if (line.role == "assistant") {
                                    {
                                        coroutineScope.launch {
                                            val name = viewModel.saveAudio(line.text)
                                            snackbarHostState.showSnackbar(
                                                if (name != null) "Saved: $name" else "No audio cached for this entry"
                                            )
                                        }
                                    }
                                } else null,
                                onShare = if (line.role == "assistant") {
                                    {
                                        coroutineScope.launch {
                                            val uri = viewModel.getAudioUri(line.text)
                                            if (uri != null) {
                                                val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                                    type = "audio/mpeg"
                                                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                                                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                                }
                                                context.startActivity(android.content.Intent.createChooser(intent, "Share audio via…"))
                                            } else {
                                                snackbarHostState.showSnackbar("No audio cached for this entry")
                                            }
                                        }
                                    }
                                } else null
                            )
                        }

                        // Partial user transcript (in-progress)
                        if (uiState.partialTranscript.isNotEmpty()) {
                            item {
                                TranscriptBubble(
                                    role = "user",
                                    text = uiState.partialTranscript,
                                    isPartial = true,
                                    targetLanguage = uiState.targetLanguage
                                )
                            }
                        }

                        // Partial assistant translation (streaming)
                        if (uiState.partialAssistantText.isNotEmpty()) {
                            item {
                                TranscriptBubble(
                                    role = "assistant",
                                    text = uiState.partialAssistantText,
                                    isPartial = true,
                                    targetLanguage = uiState.targetLanguage
                                )
                            }
                        }

                        // Waiting-for-translation hint: shown when the latest line is a user
                        // bubble (no assistant response yet) and nothing is streaming.
                        val lastLine = uiState.transcriptLines.lastOrNull()
                        val waitingForTranslation =
                            lastLine?.role == "user" &&
                            uiState.partialAssistantText.isEmpty() &&
                            uiState.sessionState == VoiceSessionState.ACTIVE
                        if (waitingForTranslation) {
                            item {
                                WaitingForTranslationBubble(
                                    targetLanguage = uiState.targetLanguage
                                )
                            }
                        }
                    }
                }
            }

            // ── Error card ───────────────────────────────────────────────────
            uiState.errorMessage?.let { error ->
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    ),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            text = error,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f)
                        )
                        if (uiState.debugMode) {
                            TextButton(onClick = onNavigateToDebugLogs) {
                                Text(
                                    "Logs",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer
                                )
                            }
                        }
                    }
                }
            }

            // ── Detected language badge ──────────────────────────────────────
            if (uiState.sessionState == VoiceSessionState.ACTIVE &&
                uiState.detectedLanguage != null
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Detected: ${uiState.detectedLanguage}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .clip(MaterialTheme.shapes.small)
                            .background(MaterialTheme.colorScheme.primaryContainer)
                            .padding(horizontal = 10.dp, vertical = 3.dp)
                    )
                }
            }

            // ── Status indicators ────────────────────────────────────────────
            StatusRow(
                sessionState = uiState.sessionState,
                isUserSpeaking = uiState.isUserSpeaking,
                isAssistantSpeaking = uiState.isAssistantSpeaking
            )

            // ── Silence auto-stop countdown ──────────────────────────────────
            uiState.silenceCountdownSeconds?.let { remaining ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Auto-stopping in ${remaining}s — speak to continue",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        modifier = Modifier
                            .clip(MaterialTheme.shapes.small)
                            .background(MaterialTheme.colorScheme.tertiaryContainer)
                            .padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }

            // ── Mic / Stop control + replay button ───────────────────────────
            val hasTranslation = uiState.transcriptLines.any { it.role == "assistant" }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left slot: replay button (only visible when there is a translation)
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.CenterEnd
                ) {
                    if (hasTranslation) {
                        ReplayButton(
                            onClick = viewModel::replayLastTranslation,
                            targetLanguage = uiState.targetLanguage
                        )
                    }
                }

                Spacer(modifier = Modifier.width(16.dp))

                // Centre: mic / stop / connecting
                when (uiState.sessionState) {
                    VoiceSessionState.IDLE, VoiceSessionState.ERROR -> {
                        MicButton(
                            active = false,
                            enabled = uiState.voiceEnabled,
                            onClick = {
                                val started = viewModel.startSession()
                                if (!started) {
                                    permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            }
                        )
                    }
                    VoiceSessionState.CONNECTING -> {
                        FilledTonalButton(
                            onClick = { viewModel.stopSession() },
                            modifier = Modifier.size(72.dp),
                            shape = CircleShape
                        ) {
                            ConnectingIndicator()
                        }
                    }
                    VoiceSessionState.ACTIVE -> {
                        MicButton(
                            active = true,
                            enabled = true,
                            onClick = { viewModel.stopSession() }
                        )
                    }
                }

                Spacer(modifier = Modifier.width(16.dp))

                // Right slot: silent mode toggle
                Box(
                    modifier = Modifier.weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    val silentMode = uiState.silentMode
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        IconButton(
                            onClick = { viewModel.toggleSilentMode() },
                            modifier = Modifier
                                .size(56.dp)
                                .background(
                                    color = if (silentMode)
                                        MaterialTheme.colorScheme.errorContainer
                                    else
                                        MaterialTheme.colorScheme.primaryContainer,
                                    shape = CircleShape
                                )
                        ) {
                            Icon(
                                imageVector = if (silentMode) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                                contentDescription = if (silentMode) "Text only" else "Audio on",
                                tint = if (silentMode)
                                    MaterialTheme.colorScheme.onErrorContainer
                                else
                                    MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                        Text(
                            text = if (silentMode) "Text only" else "Audio",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // ── Bottom action bar ─────────────────────────────────────────────
            val hasContent = uiState.transcriptLines.isNotEmpty() || uiState.offlineRecordings.isNotEmpty()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // ── Always On ─────────────────────────────────────────────────
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .weight(1f)
                        .padding(horizontal = 4.dp)
                        .clip(MaterialTheme.shapes.small)
                        .background(
                            if (uiState.permanentListenMode)
                                MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surfaceVariant
                        )
                        .clickable { viewModel.togglePermanentListenMode() },
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.AllInclusive,
                            contentDescription = "Always On",
                            modifier = Modifier.size(20.dp),
                            tint = if (uiState.permanentListenMode)
                                MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "Always On",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (uiState.permanentListenMode)
                                MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // ── Save Offline ──────────────────────────────────────────────
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .weight(1f)
                        .padding(horizontal = 4.dp)
                        .clip(MaterialTheme.shapes.small)
                        .background(
                            if (uiState.offlineRecordMode)
                                MaterialTheme.colorScheme.errorContainer
                            else MaterialTheme.colorScheme.surfaceVariant
                        )
                        .clickable { viewModel.toggleOfflineRecordMode() },
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.FiberManualRecord,
                            contentDescription = "Save Offline",
                            modifier = Modifier.size(20.dp),
                            tint = if (uiState.offlineRecordMode)
                                MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "Save Offline",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (uiState.offlineRecordMode)
                                MaterialTheme.colorScheme.error
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // ── Clear ─────────────────────────────────────────────────────
                Box(
                    modifier = Modifier
                        .fillMaxHeight()
                        .weight(1f)
                        .padding(horizontal = 4.dp)
                        .clip(MaterialTheme.shapes.small)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable(enabled = hasContent) { viewModel.clearTranscript() },
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.DeleteSweep,
                            contentDescription = "Clear",
                            modifier = Modifier.size(20.dp),
                            tint = if (hasContent)
                                MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
                        )
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "Clear",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (hasContent)
                                MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.outline.copy(alpha = 0.35f)
                        )
                    }
                }
            }

            // Info + cost in a small row below the action buttons
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 0.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = { showAbout = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Info, contentDescription = "About",
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.outline)
                }
                Spacer(Modifier.weight(1f))
                if (uiState.showCost && uiState.costInfo != null) {
                    Text(uiState.costInfo!!.formatted(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.outline)
                }
            }

            // ── Offline recordings list ──────────────────────────────────────
            if (uiState.offlineRecordings.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                    Text("Offline recordings (tap to translate)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    uiState.offlineRecordings.forEach { file ->
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                file.name,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { viewModel.processOfflineRecording(file) }
                            )
                            IconButton(onClick = { viewModel.deleteOfflineRecording(file) }, Modifier.size(28.dp)) {
                                Icon(Icons.Default.DeleteSweep, contentDescription = "Delete", Modifier.size(16.dp))
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Language selectors
// ────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SourceLanguageSelector(
    selected: SourceLanguage,
    onSelect: (SourceLanguage) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = !expanded }
    ) {
        OutlinedTextField(
            value = if (selected == SourceLanguage.AUTO) "Auto" else selected.displayName,
            onValueChange = {},
            readOnly = true,
            label = { Text("Speaking") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            SourceLanguage.values().forEach { lang ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(lang.displayName, style = MaterialTheme.typography.bodyMedium)
                            if (lang != SourceLanguage.AUTO) {
                                Text(
                                    lang.nativeName,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.outline
                                )
                            }
                        }
                    },
                    onClick = { onSelect(lang); expanded = false }
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TargetLanguageSelector(
    selected: TranslationLanguage,
    onSelect: (TranslationLanguage) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = !expanded }
    ) {
        OutlinedTextField(
            value = selected.displayName,
            onValueChange = {},
            readOnly = true,
            label = { Text("Translate to") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            TranslationLanguage.values().forEach { lang ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(lang.displayName, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                lang.nativeName,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.outline
                            )
                        }
                    },
                    onClick = { onSelect(lang); expanded = false }
                )
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Transcript bubble
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun TranscriptBubble(
    role: String,
    text: String,
    targetLanguage: TranslationLanguage,
    isPartial: Boolean = false,
    detectedLanguage: String? = null,
    onSpeak: (() -> Unit)? = null,
    onSave: (() -> Unit)? = null,
    onShare: (() -> Unit)? = null
) {
    val isUser = role == "user"
    val bgColor = if (isUser)
        MaterialTheme.colorScheme.surfaceVariant
    else
        MaterialTheme.colorScheme.primaryContainer

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(bottom = 2.dp)
        ) {
            Text(
                text = if (isUser) "You" else "Grok → ${targetLanguage.displayName}",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.primary
            )
            if (isUser && detectedLanguage != null) {
                Text(
                    text = detectedLanguage,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier
                        .clip(MaterialTheme.shapes.extraSmall)
                        .background(MaterialTheme.colorScheme.secondaryContainer)
                        .padding(horizontal = 6.dp, vertical = 1.dp)
                )
            }
            Spacer(modifier = Modifier.weight(1f))
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(bgColor)
                .padding(10.dp)
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isPartial)
                    MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                else
                    MaterialTheme.colorScheme.onSurface
            )
        }
        // Action buttons for completed assistant bubbles
        if (!isUser && !isPartial && (onSpeak != null || onSave != null || onShare != null)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End)
            ) {
                if (onShare != null) {
                    FilledTonalButton(
                        onClick = onShare,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 12.dp, vertical = 4.dp
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.Share,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Share", style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (onSave != null) {
                    FilledTonalButton(
                        onClick = onSave,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 12.dp, vertical = 4.dp
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Save", style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (onSpeak != null) {
                    FilledTonalButton(
                        onClick = onSpeak,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(
                            horizontal = 12.dp, vertical = 4.dp
                        )
                    ) {
                        Icon(
                            imageVector = Icons.Default.VolumeUp,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Speak in ${targetLanguage.displayName}",
                            style = MaterialTheme.typography.labelMedium
                        )
                    }
                }
            }
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Status row (speaking indicators)
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun WaitingForTranslationBubble(targetLanguage: TranslationLanguage) {
    val infiniteTransition = rememberInfiniteTransition(label = "waitXL")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(700, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "waitAlpha"
    )
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(
            text = "Grok → ${targetLanguage.displayName}",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(bottom = 2.dp)
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f))
                .padding(10.dp)
        ) {
            listOf(0, 167, 334).forEach { delayMs ->
                val dotAlpha by infiniteTransition.animateFloat(
                    0.2f, 1f,
                    infiniteRepeatable(tween(500, delayMillis = delayMs), RepeatMode.Reverse),
                    label = "dot$delayMs"
                )
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary.copy(alpha = dotAlpha))
                )
                Spacer(modifier = Modifier.width(3.dp))
            }
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = "Translating to ${targetLanguage.displayName}…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = alpha)
            )
        }
    }
}

@Composable
private fun StatusRow(
    sessionState: VoiceSessionState,
    isUserSpeaking: Boolean,
    isAssistantSpeaking: Boolean
) {
    if (sessionState != VoiceSessionState.ACTIVE) return
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(24.dp),
        contentAlignment = Alignment.Center
    ) {
        when {
            isUserSpeaking -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                SoundWaveBars(color = MaterialTheme.colorScheme.primary)
                Text(
                    "Speaking…",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary
                )
                SoundWaveBars(color = MaterialTheme.colorScheme.primary)
            }
            isAssistantSpeaking -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SoundWaveBars(color = MaterialTheme.colorScheme.tertiary)
                Text(
                    "Grok is speaking…",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.tertiary
                )
                SoundWaveBars(color = MaterialTheme.colorScheme.tertiary)
            }
            else -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val infiniteTransition = rememberInfiniteTransition(label = "idle_dot")
                val dotAlpha by infiniteTransition.animateFloat(
                    initialValue = 0.3f, targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(1200, easing = FastOutSlowInEasing), RepeatMode.Reverse),
                    label = "idleDot"
                )
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.outline.copy(alpha = dotAlpha))
                )
                Text(
                    "Ready — speak to translate",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        }
    }
}

@Composable
private fun SoundWaveBars(color: Color) {
    val infiniteTransition = rememberInfiniteTransition(label = "wave")
    @Composable
    fun bar(minH: Float, maxH: Float, delay: Int, label: String): State<Float> =
        infiniteTransition.animateFloat(
            initialValue = minH, targetValue = maxH,
            animationSpec = infiniteRepeatable(tween(280 + delay / 2, delayMillis = delay, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = label
        )
    val h1 by bar(0.25f, 0.9f, 0, "h1")
    val h2 by bar(0.55f, 1.0f, 80, "h2")
    val h3 by bar(0.15f, 1.0f, 40, "h3")
    val h4 by bar(0.45f, 0.95f, 120, "h4")
    val h5 by bar(0.25f, 0.75f, 60, "h5")
    Row(
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.height(22.dp)
    ) {
        listOf(h1, h2, h3, h4, h5).forEach { h ->
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight(h)
                    .clip(RoundedCornerShape(2.dp))
                    .background(color)
            )
        }
    }
}

@Suppress("UnusedPrivateMember")
@Composable
private fun StatusBadge(text: String, color: Color) {
    // kept for API compat; StatusRow now builds inline
    Text(text, style = MaterialTheme.typography.labelMedium, color = color)
}

// ────────────────────────────────────────────────────────────────────────────
// Replay button
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun ReplayButton(
    onClick: () -> Unit,
    targetLanguage: TranslationLanguage
) {
    val infiniteTransition = rememberInfiniteTransition(label = "replay_idle")
    val glow by infiniteTransition.animateFloat(
        initialValue = 0.08f, targetValue = 0.18f,
        animationSpec = infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "replayGlow"
    )

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(72.dp)) {
            // Soft glow ring
            Box(
                modifier = Modifier
                    .size(60.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.secondary.copy(alpha = glow))
            )
            FloatingActionButton(
                onClick = onClick,
                modifier = Modifier.size(60.dp),
                shape = CircleShape,
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                elevation = FloatingActionButtonDefaults.elevation(defaultElevation = 4.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.VolumeUp,
                    contentDescription = "Replay last translation",
                    modifier = Modifier.size(28.dp)
                )
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "Replay",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Mic button
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun MicButton(
    active: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    val buttonColor = when {
        active  -> MaterialTheme.colorScheme.error
        !enabled -> MaterialTheme.colorScheme.surfaceVariant
        else    -> MaterialTheme.colorScheme.primary
    }
    val infiniteTransition = rememberInfiniteTransition(label = "mic_anim")

    // Expanding ripple rings when active (listening)
    val ring1Scale by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 1.7f,
        animationSpec = infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "r1s"
    )
    val ring1Alpha by infiniteTransition.animateFloat(
        initialValue = 0.55f, targetValue = 0f,
        animationSpec = infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "r1a"
    )
    val ring2Scale by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 1.7f,
        animationSpec = infiniteRepeatable(tween(1400, delayMillis = 500, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "r2s"
    )
    val ring2Alpha by infiniteTransition.animateFloat(
        initialValue = 0.55f, targetValue = 0f,
        animationSpec = infiniteRepeatable(tween(1400, delayMillis = 500, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "r2a"
    )

    // Gentle idle breathe on the button itself when waiting for tap
    val idlePulse by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 1.05f,
        animationSpec = infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "idle"
    )

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(96.dp)) {
            // Ripple rings (active state only)
            if (active) {
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .scale(ring1Scale)
                        .clip(CircleShape)
                        .background(buttonColor.copy(alpha = ring1Alpha * 0.35f))
                )
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .scale(ring2Scale)
                        .clip(CircleShape)
                        .background(buttonColor.copy(alpha = ring2Alpha * 0.35f))
                )
            }
            // Outer glow ring (idle ready state)
            if (!active && enabled) {
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .scale(idlePulse * 1.12f)
                        .clip(CircleShape)
                        .background(buttonColor.copy(alpha = 0.12f))
                )
            }
            // Main button
            FloatingActionButton(
                onClick = onClick,
                modifier = Modifier
                    .size(72.dp)
                    .scale(if (!active && enabled) idlePulse else 1f),
                shape = CircleShape,
                containerColor = buttonColor,
                contentColor = if (enabled || active)
                    MaterialTheme.colorScheme.onPrimary
                else
                    MaterialTheme.colorScheme.onSurfaceVariant,
                elevation = FloatingActionButtonDefaults.elevation(
                    defaultElevation = if (active) 12.dp else 6.dp
                )
            ) {
                Icon(
                    imageVector = when {
                        !enabled -> Icons.Default.MicOff
                        active   -> Icons.Default.Stop
                        else     -> Icons.Default.Mic
                    },
                    contentDescription = if (active) "Stop session" else "Start session",
                    modifier = Modifier.size(40.dp)
                )
            }
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = when {
                !enabled -> "Microphone disabled"
                active   -> "Tap to stop"
                else     -> "Tap to speak"
            },
            style = MaterialTheme.typography.labelSmall,
            color = if (active) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.outline
        )
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Connecting indicator
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun ConnectingIndicator() {
    val infiniteTransition = rememberInfiniteTransition(label = "connecting")
    val delays = listOf(0, 167, 334)
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = Alignment.CenterVertically) {
        delays.forEach { d ->
            val h by infiniteTransition.animateFloat(
                initialValue = 0.3f, targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(500, delayMillis = d), RepeatMode.Reverse),
                label = "cd$d"
            )
            Box(
                modifier = Modifier
                    .width(5.dp)
                    .height(20.dp * h)
                    .clip(RoundedCornerShape(3.dp))
                    .background(MaterialTheme.colorScheme.primary)
            )
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// About dialog helper
// ────────────────────────────────────────────────────────────────────────────

@Composable
private fun AboutRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.primary
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
