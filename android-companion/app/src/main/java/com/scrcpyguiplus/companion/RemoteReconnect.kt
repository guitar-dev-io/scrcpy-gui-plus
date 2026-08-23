package com.scrcpyguiplus.companion

import java.net.Socket
import kotlin.math.min

data class RemoteReconnectPolicy(
    val initialDelayMs: Long = 400,
    val maximumDelayMs: Long = 8_000,
    val windowMs: Long = 120_000,
    val jitterRatio: Double = 0.2,
) {
    init {
        require(initialDelayMs >= 0)
        require(maximumDelayMs >= initialDelayMs)
        require(windowMs > 0)
        require(jitterRatio in 0.0..0.5)
    }

    fun delayMs(attempt: Int, randomUnit: Double): Long {
        require(attempt >= 1)
        val shift = min(attempt - 1, 30)
        val multiplied = initialDelayMs * (1L shl shift)
        val capped = min(maximumDelayMs, if (multiplied < 0) maximumDelayMs else multiplied)
        val centered = randomUnit.coerceIn(0.0, 1.0) * 2.0 - 1.0
        return (capped * (1.0 + centered * jitterRatio)).toLong().coerceIn(0, maximumDelayMs)
    }
}

fun interface RemoteSocketConnector {
    fun create(): Socket
}

fun interface RemoteSleeper {
    @Throws(InterruptedException::class)
    fun sleep(delayMs: Long)
}

val DEFAULT_REMOTE_SOCKET_CONNECTOR = RemoteSocketConnector(::Socket)

val DEFAULT_REMOTE_SLEEPER = RemoteSleeper(Thread::sleep)
