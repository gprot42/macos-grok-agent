package com.tinyggrok.app.ui.screens

import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.tinyggrok.app.ui.viewmodel.ChatUiMessage
import com.tinyggrok.app.ui.viewmodel.ChatViewModel
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.parser.Parser
import org.commonmark.renderer.html.HtmlRenderer

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    onNavigateToSettings: () -> Unit,
    onNavigateToDebugLogs: () -> Unit = {},
    onNavigateToHistory: () -> Unit = {},
    onNavigateToVoiceTranslator: () -> Unit = {},
    viewModel: ChatViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    val imagePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { viewModel.attachImage(it) }
    }

    // Scroll to the sentinel (true bottom) whenever:
    //  • a new message is added/removed
    //  • the last message's content changes (streaming)
    //  • the typing indicator appears/disappears
    LaunchedEffect(Unit) {
        snapshotFlow {
            Triple(
                uiState.messages.size,
                uiState.isSending,
                uiState.messages.lastOrNull()?.content
            )
        }
            .distinctUntilChanged()
            .filter { (size, _, _) -> size > 0 || uiState.isSending }
            .collect { (size, isSending, _) ->
                val sentinelIndex = size + (if (isSending) 1 else 0)
                delay(80) // brief pause so layout settles before scroll
                listState.animateScrollToItem(sentinelIndex)
            }
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
        topBar = {
            TopAppBar(
                title = { Text("Tiny Ggrok") },
                actions = {
                    if (uiState.messages.isNotEmpty()) {
                        TextButton(onClick = viewModel::clearMessages) {
                            Text("Clear")
                        }
                    }
                    TextButton(onClick = onNavigateToVoiceTranslator) {
                        Text("Voice")
                    }
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
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .navigationBarsPadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (uiState.messages.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    Text("Ask Grok something, or attach an image.")
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                ) {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(uiState.messages) { message ->
                            MessageItem(
                                message = message,
                                showCost = uiState.showCost,
                                responseFormat = uiState.responseFormat,
                                fontSize = uiState.fontSize,
                                onShare = { text ->
                                    val intent = Intent(Intent.ACTION_SEND).apply {
                                        type = "text/plain"
                                        putExtra(Intent.EXTRA_TEXT, text)
                                    }
                                    context.startActivity(Intent.createChooser(intent, "Share response"))
                                }
                            )
                        }
                        if (uiState.isSending) {
                            item {
                                TypingIndicator()
                            }
                        }
                        // Sentinel: always the last item so scrollToItem(sentinelIndex) reaches
                        // the true bottom regardless of how tall the last message is.
                        item(key = "bottom") { Spacer(Modifier.height(1.dp)) }
                    }
                }
            }

            uiState.errorMessage?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error
                )
            }

            // Image attachment preview
            uiState.attachedImageUri?.let { uri ->
                Card(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box {
                        AsyncImage(
                            model = uri,
                            contentDescription = "Attached image",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(120.dp),
                            contentScale = ContentScale.Crop
                        )
                        IconButton(
                            onClick = viewModel::removeImage,
                            modifier = Modifier.align(Alignment.TopEnd)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Remove image"
                            )
                        }
                    }
                }
            }

            OutlinedTextField(
                value = uiState.prompt,
                onValueChange = viewModel::updatePrompt,
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Prompt") },
                minLines = 2,
                maxLines = 4,
                enabled = !uiState.isSending,
                trailingIcon = {
                    IconButton(
                        onClick = { imagePicker.launch("image/*") },
                        enabled = !uiState.isSending
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Image,
                            contentDescription = "Attach image"
                        )
                    }
                }
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Bottom-left: History
                TextButton(onClick = onNavigateToHistory) {
                    Text("History")
                }

                // Right side: prompt actions
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val copyText = uiState.prompt.ifEmpty { uiState.lastSentPrompt }
                    TextButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(copyText))
                            Toast.makeText(context, "Prompt copied", Toast.LENGTH_SHORT).show()
                        },
                        enabled = copyText.isNotEmpty() && !uiState.isSending
                    ) {
                        Text("Copy")
                    }
                    TextButton(
                        onClick = viewModel::resendLastPrompt,
                        enabled = uiState.lastSentPrompt.isNotBlank() && !uiState.isSending
                    ) {
                        Text("Resend")
                    }
                    TextButton(
                        onClick = viewModel::clearPrompt,
                        enabled = (uiState.prompt.isNotEmpty() || uiState.attachedImageBase64 != null) && !uiState.isSending
                    ) {
                        Text("Clear")
                    }
                    Button(
                        onClick = viewModel::sendPrompt,
                        modifier = Modifier.padding(start = 8.dp),
                        enabled = (uiState.prompt.isNotBlank() || uiState.attachedImageBase64 != null) && !uiState.isSending
                    ) {
                        Text(if (uiState.isSending) "Sending..." else "Send")
                    }
                }
            }
        }
    }
}

@Composable
private fun TypingIndicator() {
    val infiniteTransition = rememberInfiniteTransition(label = "typing")

    val alpha1 by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot1"
    )
    val alpha2 by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, delayMillis = 200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot2"
    )
    val alpha3 by infiniteTransition.animateFloat(
        initialValue = 0.2f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, delayMillis = 400, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dot3"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = "Grok",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(modifier = Modifier.width(8.dp))
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .size(8.dp)
                .alpha(alpha1)
        ) {}
        Spacer(modifier = Modifier.width(4.dp))
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .size(8.dp)
                .alpha(alpha2)
        ) {}
        Spacer(modifier = Modifier.width(4.dp))
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .size(8.dp)
                .alpha(alpha3)
        ) {}
    }
}

@Composable
private fun MessageItem(
    message: ChatUiMessage,
    showCost: Boolean,
    responseFormat: String,
    fontSize: Float,
    onShare: ((String) -> Unit)? = null
) {
    val clipboard = LocalClipboardManager.current
    val isAssistant = message.role == "assistant"

    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (isAssistant) "Grok" else "You",
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f)
            )
            if (isAssistant) {
                val context = LocalContext.current
                IconButton(
                    onClick = { onShare?.invoke(message.content) },
                    modifier = Modifier.size(32.dp)
                ) {
                    Icon(Icons.Default.Share, contentDescription = "Share",
                        modifier = Modifier.size(16.dp),
                        tint = MaterialTheme.colorScheme.outline)
                }
                TextButton(
                    onClick = {
                        // Strip any HTML tags so the clipboard receives clean plain text
                        val plain = android.text.Html
                            .fromHtml(message.content, android.text.Html.FROM_HTML_MODE_COMPACT)
                            .toString()
                            .trim()
                        clipboard.setText(AnnotatedString(plain))
                        Toast.makeText(context, "Response copied", Toast.LENGTH_SHORT).show()
                    }
                ) {
                    Text("Copy")
                }
            }
        }
        if (message.hasImage && !isAssistant) {
            Icon(
                imageVector = Icons.Outlined.Image,
                contentDescription = "Image attached",
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }
        if (isAssistant) {
            val htmlContent = if (responseFormat == "markdown") {
                markdownToHtml(message.content)
            } else {
                message.content
            }
            HtmlContent(html = htmlContent, fontSize = fontSize)
        } else {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = fontSize.sp)
            )
        }
        if (showCost && isAssistant && message.costInfo != null) {
            Text(
                text = message.costInfo.formatted(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

/** Convert GFM markdown (including tables) to HTML using commonmark. */
private fun markdownToHtml(markdown: String): String {
    val extensions = listOf(TablesExtension.create())
    val parser = Parser.builder().extensions(extensions).build()
    val renderer = HtmlRenderer.builder().extensions(extensions).build()
    return renderer.render(parser.parse(markdown))
}

@Composable
private fun HtmlContent(html: String, fontSize: Float = 14f) {
    val bgColor = MaterialTheme.colorScheme.surface
    val textColor = MaterialTheme.colorScheme.onSurface
    val linkColor = MaterialTheme.colorScheme.primary
    val fullHtml = """
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=5.0, user-scalable=yes">
            <style>
                body {
                    margin: 0;
                    padding: 8px 0;
                    font-family: sans-serif;
                    font-size: ${fontSize}px;
                    line-height: 1.5;
                    color: ${colorToHex(textColor)};
                    background-color: ${colorToHex(bgColor)};
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    max-width: 100%;
                    overflow-x: hidden;
                    -webkit-user-select: text;
                    user-select: text;
                    -webkit-touch-callout: default;
                }
                a { color: ${colorToHex(linkColor)}; }
                pre {
                    background: rgba(128,128,128,0.15);
                    padding: 8px;
                    border-radius: 4px;
                    overflow-x: auto;
                    white-space: pre-wrap;
                    word-break: break-all;
                }
                code {
                    font-family: monospace;
                    background: rgba(128,128,128,0.15);
                    padding: 2px 4px;
                    border-radius: 3px;
                    word-break: break-all;
                }
                blockquote {
                    border-left: 3px solid ${colorToHex(linkColor)};
                    margin: 8px 0;
                    padding-left: 12px;
                    opacity: 0.7;
                }
                table {
                    border-collapse: collapse;
                    width: 100%;
                    max-width: 100%;
                    overflow-x: auto;
                    display: block;
                    word-break: normal;
                }
                th, td {
                    border: 1px solid rgba(128,128,128,0.3);
                    padding: 6px 8px;
                    text-align: left;
                    white-space: normal;
                    word-wrap: break-word;
                }
                th {
                    background: rgba(128,128,128,0.15);
                    font-weight: bold;
                }
                tr:nth-child(even) {
                    background: rgba(128,128,128,0.05);
                }
            </style>
        </head>
        <body>$html</body>
        </html>
    """.trimIndent()

    AndroidView(
        modifier = Modifier.fillMaxWidth(),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                settings.javaScriptEnabled = false
                // Pinch-to-zoom support (two-finger gesture won't conflict with list scroll)
                settings.setSupportZoom(true)
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                settings.useWideViewPort = true
                settings.loadWithOverviewMode = true
                // Long-press text selection is enabled by default
                isLongClickable = true
                loadDataWithBaseURL(null, fullHtml, "text/html", "UTF-8", null)
            }
        },
        update = { webView ->
            webView.loadDataWithBaseURL(null, fullHtml, "text/html", "UTF-8", null)
        }
    )
}

private fun colorToHex(color: androidx.compose.ui.graphics.Color): String {
    val r = (color.red * 255).toInt()
    val g = (color.green * 255).toInt()
    val b = (color.blue * 255).toInt()
    return String.format("#%02X%02X%02X", r, g, b)
}
