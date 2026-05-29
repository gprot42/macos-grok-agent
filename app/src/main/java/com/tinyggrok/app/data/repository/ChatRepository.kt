package com.tinyggrok.app.data.repository

import android.util.Log
import com.google.gson.GsonBuilder
import com.tinyggrok.app.data.api.XaiApiService
import com.tinyggrok.app.data.model.ChatRequest
import com.tinyggrok.app.data.model.ImageUrl
import com.tinyggrok.app.data.model.ImageUrlContent
import com.tinyggrok.app.data.model.Message
import com.tinyggrok.app.data.model.TextContent
import retrofit2.HttpException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.inject.Inject
import javax.inject.Singleton

data class ChatResult(
    val assistantMessage: String,
    val usage: com.tinyggrok.app.data.model.Usage? = null
)

@Singleton
class ChatRepository @Inject constructor(
    private val apiService: XaiApiService,
    private val debugLogRepository: DebugLogRepository
) {
    private val gson = GsonBuilder().setPrettyPrinting().create()
    private val TAG = "ChatRepository"

    suspend fun sendMessage(
        apiKey: String,
        text: String,
        imageBase64: String?,
        history: List<Message>,
        debugMode: Boolean = false,
        responseFormat: String = "html"
    ): Result<ChatResult> {
        return try {
            val systemPrompt = when (responseFormat) {
                "html" -> "Respond using valid HTML markup only. Use tags like <p>, <ul>, <ol>, <li>, <strong>, <em>, <code>, <pre>, <h1>-<h3>, <table>, <blockquote> where appropriate. Do not wrap in <html> or <body> tags. Do not use markdown."
                "markdown" -> "Respond using Markdown formatting. Use headers, bold, italic, code blocks, lists, tables where appropriate."
                else -> null
            }

            val content = buildList {
                if (imageBase64 != null) {
                    add(ImageUrlContent(imageUrl = ImageUrl(url = "data:image/jpeg;base64,$imageBase64")))
                }
                add(TextContent(text = text))
            }

            val allMessages = buildList {
                if (systemPrompt != null) {
                    add(Message(role = "system", text = systemPrompt))
                }
                addAll(history)
                add(Message(role = "user", content = content))
            }

            val request = ChatRequest(messages = allMessages)

            if (debugMode) {
                val requestJson = gson.toJson(request)
                debugLogRepository.logOutgoing(
                    summary = "POST /v1/chat/completions | model=${request.model} | msgs=${allMessages.size} | hasImage=${imageBase64 != null}",
                    body = requestJson
                )
                Log.d(TAG, "REQUEST: $requestJson")
            }

            val response = apiService.chatCompletions(
                auth = "Bearer $apiKey",
                request = request
            )

            val assistantMessage = response.choices.firstOrNull()?.message?.content ?: "No response"

            if (debugMode) {
                val responseJson = gson.toJson(response)
                debugLogRepository.logIncoming(
                    summary = "HTTP 200 | choices=${response.choices.size} | usage=${response.usage?.total_tokens ?: "N/A"} tokens",
                    body = responseJson
                )
                Log.d(TAG, "RESPONSE: $responseJson")
            }

            Result.success(ChatResult(assistantMessage, response.usage))
        } catch (e: HttpException) {
            val body = try { e.response()?.errorBody()?.string().orEmpty() } catch (_: Throwable) { "" }
            if (debugMode) {
                debugLogRepository.logIncoming(
                    summary = "HTTP ${e.code()}: ${e.message()}",
                    body = body.take(2000)
                )
                Log.e(TAG, "HTTP ERROR ${e.code()}: $body")
            }
            Result.failure(RuntimeException("HTTP ${e.code()}: ${body.take(400).ifBlank { e.message() }}"))
        } catch (e: SocketTimeoutException) {
            if (debugMode) {
                debugLogRepository.logIncoming(summary = "TIMEOUT", body = e.message ?: "Socket timeout")
            }
            Result.failure(RuntimeException("Timed out contacting api.x.ai. Check network."))
        } catch (e: UnknownHostException) {
            if (debugMode) {
                debugLogRepository.logIncoming(summary = "DNS ERROR", body = e.message ?: "Unknown host")
            }
            Result.failure(RuntimeException("Can't reach api.x.ai (DNS). Check network."))
        } catch (e: Exception) {
            if (debugMode) {
                debugLogRepository.logIncoming(summary = "EXCEPTION: ${e.javaClass.simpleName}", body = e.message ?: "unknown")
            }
            Result.failure(RuntimeException("${e.javaClass.simpleName}: ${e.message ?: "unknown error"}"))
        }
    }
}
