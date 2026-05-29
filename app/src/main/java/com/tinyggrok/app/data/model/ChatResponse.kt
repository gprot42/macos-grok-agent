package com.tinyggrok.app.data.model

import com.google.gson.annotations.SerializedName

data class ChatResponse(
    val id: String,
    val choices: List<Choice>,
    val usage: Usage? = null
)

data class Choice(
    val index: Int,
    val message: ResponseMessage,
    val finish_reason: String? = null
)

data class ResponseMessage(
    val role: String,
    val content: String
)

data class Usage(
    @SerializedName("prompt_tokens")
    val prompt_tokens: Int,
    @SerializedName("completion_tokens")
    val completion_tokens: Int,
    @SerializedName("total_tokens")
    val total_tokens: Int
)
