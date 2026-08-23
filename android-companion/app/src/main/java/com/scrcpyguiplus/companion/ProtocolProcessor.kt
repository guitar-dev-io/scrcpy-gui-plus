package com.scrcpyguiplus.companion

import org.json.JSONObject

data class ProtocolHandlerResult(
    val result: JSONObject,
    val afterResponse: (() -> Unit)? = null,
)

data class PreparedResponse(
    val payload: ByteArray,
    val afterWrite: (() -> Unit)? = null,
)

/** Pure request boundary: parse, dispatch, encode, and contain per-request failures. */
class ProtocolProcessor(
    private val requestHandler: (ProtocolRequest) -> ProtocolHandlerResult,
    private val eventLogger: (String) -> Unit = {},
) {
    /** Convenience for callers and tests that only need the encoded response. */
    fun process(payload: ByteArray): ByteArray = prepare(payload).payload

    /** Preserves an optional side effect so the USB owner can run it only after flushing. */
    fun prepare(payload: ByteArray): PreparedResponse {
        val request = try {
            ProtocolJson.parseRequest(payload)
        } catch (error: RequestParseException) {
            val detail = compactMessage(error.message, "invalid request")
            safeLog("Rejected malformed request: $detail")
            return PreparedResponse(
                ProtocolJson.errorResponse(
                    id = error.requestId ?: 0,
                    message = "invalid request: $detail",
                ),
            )
        }

        return try {
            val handled = requestHandler(request)
            val response = ProtocolJson.successResponse(request.id, handled.result)
            if (response.size > FrameCodec.MAX_PAYLOAD_BYTES) {
                safeLog("Response for ${request.method.logLabel()} exceeded the 1 MiB payload limit")
                PreparedResponse(
                    ProtocolJson.errorResponse(request.id, "response exceeds the 1 MiB payload limit"),
                )
            } else {
                safeLog("Handled ${request.method.logLabel()} (#${request.id})")
                PreparedResponse(response, afterWrite = handled.afterResponse)
            }
        } catch (error: StackOverflowError) {
            requestFailure(request, "request data nesting is too deep")
        } catch (error: Exception) {
            requestFailure(request, compactMessage(error.message, "request failed"))
        }
    }

    private fun requestFailure(request: ProtocolRequest, detail: String): PreparedResponse {
        safeLog("Rejected ${request.method.logLabel()} (#${request.id}): $detail")
        return PreparedResponse(ProtocolJson.errorResponse(request.id, detail))
    }

    private fun safeLog(message: String) {
        try {
            eventLogger(message)
        } catch (_: Exception) {
            // Diagnostics must not change protocol behavior.
        }
    }
}

/**
 * Last-resort session guard around the frame handler. ProtocolProcessor normally catches errors,
 * but this prevents a future handler regression or invalid response from terminating the USB loop.
 */
class ResilientRequestHandler(
    private val delegate: (ByteArray) -> PreparedResponse,
    private val failureLogger: (String) -> Unit = {},
) {
    fun handle(payload: ByteArray): PreparedResponse {
        return try {
            val response = delegate(payload)
            require(response.payload.isNotEmpty()) { "request handler returned an empty response" }
            require(response.payload.size <= FrameCodec.MAX_PAYLOAD_BYTES) {
                "request handler returned ${response.payload.size} bytes"
            }
            response
        } catch (error: StackOverflowError) {
            failureResponse(payload, "request handler exhausted the stack")
        } catch (error: Exception) {
            failureResponse(payload, compactMessage(error.message, "request handler failed"))
        }
    }

    private fun failureResponse(payload: ByteArray, detail: String): PreparedResponse {
        safeLog("Recovered from request handler failure: $detail")
        return PreparedResponse(
            ProtocolJson.errorResponse(
                id = ProtocolJson.extractRequestId(payload) ?: 0,
                message = "request handler failed: $detail",
            ),
        )
    }

    private fun safeLog(message: String) {
        try {
            failureLogger(message)
        } catch (_: Exception) {
            // Diagnostics must not terminate the USB loop.
        }
    }
}

private fun compactMessage(message: String?, fallback: String): String =
    (message ?: fallback)
        .replace('\n', ' ')
        .replace('\r', ' ')
        .ifBlank { fallback }
        .take(400)

private fun String.logLabel(): String =
    replace('\n', ' ')
        .replace('\r', ' ')
        .take(80)
