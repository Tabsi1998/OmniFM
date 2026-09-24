// Shared JSDoc types (#211). `npm run typecheck` checks src/lib and src/core
// against them (tsconfig.json); other modules reference them in JSDoc.

/**
 * An Error that carries the HTTP status an API route should answer with.
 * @typedef {Error & { statusCode?: number, code?: string }} HttpError
 */

/**
 * The playback state of one server in one bot runtime (BotRuntime#getState).
 * The runtime, the worker bridge and the saved bot state all describe this
 * object; the fields below are the ones they rely on.
 *
 * @typedef {object} GuildPlaybackState
 * @property {any} player                    @discordjs/voice AudioPlayer
 * @property {any} connection                VoiceConnection, null while not joined
 * @property {string | null} currentStationKey
 * @property {string | null} currentStationName
 * @property {object | null} currentMeta     now-playing metadata of the stream
 * @property {string | null} desiredStationKey   the station the server chose; differs while a backup plays
 * @property {string | null} desiredStationName
 * @property {string | null} lastChannelId   voice channel to return to
 * @property {number} volume                 0-100
 * @property {boolean} shouldReconnect       playback target is active and survives disconnects
 * @property {number} streamGeneration       increases with every started stream (idle guard)
 * @property {number} streamErrorCount
 * @property {number} reconnectAttempts
 * @property {any} reconnectTimer
 * @property {any} streamRestartTimer
 * @property {boolean} failoverActive        a backup station replaces the desired one
 * @property {number} failoverStartedAt      epoch ms
 * @property {string | null} failoverReason
 * @property {string | null} failoverFromStationKey
 * @property {number} failbackNextProbeAt    epoch ms of the next check of the desired station
 * @property {string | null} parkedReason    set while the target is paused after repeated failures
 * @property {number} parkedAt               epoch ms
 * @property {boolean} serverMuted           the bot is server-muted in its channel
 * @property {number} lastAudioHeardAt       epoch ms of the last audio packet
 */

export {};
