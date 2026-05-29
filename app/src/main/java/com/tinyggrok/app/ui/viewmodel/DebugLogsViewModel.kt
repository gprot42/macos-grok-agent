package com.tinyggrok.app.ui.viewmodel

import androidx.lifecycle.ViewModel
import com.tinyggrok.app.data.repository.DebugLogEntry
import com.tinyggrok.app.data.repository.DebugLogRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Inject

/** A group of log entries that occurred close together in time. */
data class LogGroup(
    val id: Long,           // timestampMillis of first entry — stable key for Compose
    val label: String,      // short title shown as the group header
    val entries: List<DebugLogEntry>
) {
    /** Formats all entries in this group as a single copyable string. */
    fun formatted(): String = buildString {
        appendLine("=== $label ===")
        entries.forEach { e ->
            appendLine("${e.timestamp}  ${e.direction}  ${e.summary}")
            if (e.body.isNotBlank()) appendLine(e.body)
        }
    }
}

private const val GROUP_GAP_MS = 30_000L   // new group if gap > 30 s

@HiltViewModel
class DebugLogsViewModel @Inject constructor(
    private val debugLogRepository: DebugLogRepository
) : ViewModel() {

    val logs: StateFlow<List<DebugLogEntry>> = debugLogRepository.logs

    /** Flat log list grouped by 30-second time windows. */
    val groups: StateFlow<List<LogGroup>> = debugLogRepository.logs
        .map { entries -> groupEntries(entries) }
        .stateIn(
            scope = CoroutineScope(Dispatchers.Default + SupervisorJob()),
            started = kotlinx.coroutines.flow.SharingStarted.Eagerly,
            initialValue = emptyList()
        )

    fun clearLogs() = debugLogRepository.clear()

    /** Formats every entry across all groups into one copyable block. */
    fun allFormatted(entries: List<DebugLogEntry>): String = buildString {
        entries.forEach { e ->
            appendLine("${e.timestamp}  ${e.direction}  ${e.summary}")
            if (e.body.isNotBlank()) appendLine(e.body)
            appendLine()
        }
    }
}

private fun groupEntries(entries: List<DebugLogEntry>): List<LogGroup> {
    if (entries.isEmpty()) return emptyList()

    val groups = mutableListOf<LogGroup>()
    var currentBucket = mutableListOf(entries.first())

    for (i in 1 until entries.size) {
        val prev = entries[i - 1]
        val curr = entries[i]
        if (curr.timestampMillis - prev.timestampMillis > GROUP_GAP_MS) {
            groups += currentBucket.toGroup()
            currentBucket = mutableListOf()
        }
        currentBucket += curr
    }
    if (currentBucket.isNotEmpty()) groups += currentBucket.toGroup()

    return groups
}

private fun List<DebugLogEntry>.toGroup(): LogGroup {
    val first = this.first()
    // Derive a readable label from the first entry
    val rawSummary = first.summary
        .removePrefix("[Voice] ")
        .removePrefix("[Chat] ")
        .take(40)
    val label = "${first.timestamp.take(8)}  $rawSummary"
    return LogGroup(id = first.timestampMillis, label = label, entries = this)
}
