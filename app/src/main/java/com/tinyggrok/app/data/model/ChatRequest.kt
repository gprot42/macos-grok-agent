package com.tinyggrok.app.data.model

import com.google.gson.annotations.SerializedName
import com.tinyggrok.app.AppDefaults

sealed class MessageContent {
    abstract val type: String
}

data class TextContent(
    @SerializedName("type")
    override val type: String = "text",
    val text: String
) : MessageContent()

data class ImageUrlContent(
    @SerializedName("type")
    override val type: String = "image_url",
    @SerializedName("image_url")
    val imageUrl: ImageUrl
) : MessageContent()

data class ImageUrl(
    val url: String
)

data class Message(
    val role: String,
    val content: List<MessageContent>
) {
    constructor(role: String, text: String) : this(role, listOf(TextContent(text = text)))
}

data class ChatRequest(
    val model: String = AppDefaults.DEFAULT_MODEL,
    val messages: List<Message>,
    val stream: Boolean = false,
    val temperature: Double = 0.7,
    val max_tokens: Int = 4096
)
