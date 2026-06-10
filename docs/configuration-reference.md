# OmniFM Configuration Reference

## Scope

This document covers the operator-facing environment variables used by the canonical Node.js runtime and highlights the less common advanced knobs that still exist in code.

The starter template is [`.env.example`](../.env.example).

## Required Bot Configuration

| Variable | Purpose | Notes |
| --- | --- | --- |
| `BOT_1_TOKEN` | Discord bot token | Required |
| `BOT_1_CLIENT_ID` | Discord application ID | Required |
| `BOT_1_NAME` | Display name used in logs/UI | Optional |
| `BOT_1_TIER` | Bot minimum tier label | Usually `free`, `pro`, or `ultimate` |
| `BOT_1_PERMISSIONS` | Invite permission integer | Optional, defaults to the current invite permission set |
| `BOT_2_TOKEN`, `BOT_2_CLIENT_ID`, ... | Additional bots | Supported up to `BOT_20_*` |
| `COMMANDER_BOT_INDEX` | Which `BOT_N` is the commander | Defaults to `1` |
| `OMNIFM_DEPLOYMENT_MODE` | `auto`, `monolith`, or `split` | Controls compose/runtime topology |

Legacy fallback:

- `DISCORD_TOKEN`
- `CLIENT_ID`
- `BOT_NAME`
- `BOT_PERMISSIONS`

Those are only used when no numbered `BOT_N_*` configuration exists.

## Language

| Variable | Purpose |
| --- | --- |
| `DEFAULT_LANGUAGE` | Default UI/bot language, `de` or `en` |
| `DEFAULT_LANG` | Legacy alias |
| `APP_LANGUAGE` | Legacy alias |

## Web, CORS, And Admin API

| Variable | Purpose | Notes |
| --- | --- | --- |
| `WEB_PORT` | External web/API port | Common local default: `8081` |
| `WEB_INTERNAL_PORT` | Internal container port | Common default: `8080` |
| `WEB_BIND` | Bind address | Default is `0.0.0.0` |
| `PUBLIC_WEB_URL` | Public base URL | Used for checkout links, webhook URLs, user-facing links |
| `WEB_DOMAIN` | Helper domain value | Used by management scripts |
| `CORS_ALLOWED_ORIGINS` | Allowed browser origins | CSV |
| `CORS_ORIGINS` | Legacy alias | CSV |
| `CHECKOUT_RETURN_ORIGINS` | Allowed checkout return origins | CSV |
| `TRUST_PROXY_HEADERS` | Trust `x-forwarded-*` style proxy headers | Useful behind reverse proxies |
| `API_ADMIN_TOKEN` | Admin token for protected API routes | Primary current name |
| `ADMIN_API_TOKEN` | Legacy admin token alias | Still accepted |

Admin auth headers accepted by the runtime:

- `X-Admin-Token`
- `Authorization: Bearer <token>`

## Command Registration

| Variable | Purpose | Notes |
| --- | --- | --- |
| `COMMAND_REGISTRATION_MODE` | `guild`, `global`, or `hybrid` | Primary command-registration switch |
| `SYNC_GUILD_COMMANDS_ON_BOOT` | Legacy fallback when explicit mode is missing | `1` implies guild mode, `0` implies global mode |
| `CLEAN_GLOBAL_COMMANDS_ON_BOOT` | Remove stale global commands | Mostly for commander/worker cleanup |
| `CLEAN_GUILD_COMMANDS_ON_BOOT` | Remove stale guild commands | Advanced cleanup flag |
| `CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT` | Remove worker guild commands | Useful when only the commander should expose commands |
| `PERIODIC_GUILD_COMMAND_SYNC_MS` | Periodic guild sync interval | `0` disables it |

Related advanced retry/timing knobs used by the runtime:

- `GUILD_COMMAND_READY_DELAY_MS`
- `GUILD_COMMAND_SYNC_JOIN_DELAY_MS`
- `GUILD_COMMAND_SYNC_JOIN_DELAY_MIN_MS`
- `GUILD_COMMAND_SYNC_JOIN_DELAY_MAX_MS`
- `GUILD_COMMAND_SYNC_JOIN_REQUEST_TIMEOUT_MS`
- `GUILD_COMMAND_SYNC_JOIN_TRANSPORT`
- `GUILD_COMMAND_SYNC_JOIN_TRIES`
- `GUILD_COMMAND_SYNC_READY_DELAY_MS`
- `GUILD_COMMAND_SYNC_READY_DELAY_MIN_MS`
- `GUILD_COMMAND_SYNC_READY_DELAY_MAX_MS`
- `GUILD_COMMAND_SYNC_REQUEST_TIMEOUT_MS`
- `GUILD_COMMAND_SYNC_RETRIES`
- `GUILD_COMMAND_SYNC_RETRY_DELAY_MS`
- `GUILD_COMMAND_SYNC_RETRY_MS`
- `GUILD_COMMAND_SYNC_STARTUP_DELAY_MIN_MS`
- `GUILD_COMMAND_SYNC_STARTUP_DELAY_MAX_MS`
- `GUILD_COMMAND_SYNC_TRIES`

## Dashboard OAuth

| Variable | Purpose |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `DISCORD_REDIRECT_URI` | OAuth callback URI |
| `DISCORD_OAUTH_SCOPES` | OAuth scopes, default is `identify guilds` |
| `DISCORD_OAUTH_STATE_TTL_SECONDS` | OAuth state lifetime |
| `DASHBOARD_SESSION_COOKIE` | Session cookie name |
| `DASHBOARD_SESSION_TTL_SECONDS` | Dashboard session lifetime |

## Premium, Billing, And Email

| Variable | Purpose | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe backend key | Primary current name |
| `STRIPE_API_KEY` | Legacy alias for the Stripe secret key | Still read by the runtime |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook validation secret | Required for webhook verification |
| `PRO_TRIAL_ENABLED` | Enable or disable the one-time Pro trial | Defaults to enabled |
| `EXPIRY_REMINDER_DAYS` | Reminder schedule before expiry | CSV like `30,14,7,1` |
| `SMTP_HOST` | SMTP host | Optional unless mail is used |
| `SMTP_PORT` | SMTP port | Optional |
| `SMTP_USER` | SMTP username | Optional |
| `SMTP_PASS` | SMTP password | Optional |
| `SMTP_FROM` | Sender address | Optional |
| `ADMIN_EMAIL` | Internal notification address | Optional |

Extended SMTP/TLS variables used by code:

- `SMTP_TLS_MODE`
- `SMTP_TLS_CA_PATH`
- `SMTP_TLS_SERVERNAME`
- `SMTP_TLS_REJECT_UNAUTHORIZED`

Current billing defaults in code:

- duration options: `1`, `3`, `6`, `12`
- seat options: `1`, `2`, `3`, `5`
- one-time Pro trial duration: `1` month

## MongoDB, Storage, And Logging

| Variable | Purpose | Notes |
| --- | --- | --- |
| `MONGO_ENABLED` | Enable Mongo-backed runtime features | `1` or `0` |
| `MONGO_URL` | MongoDB connection string | Enables Mongo automatically when set |
| `DB_NAME` | Database name | Used by Mongo connection |
| `LOGS_DIR` | Override log directory | Default is `logs` |
| `LOG_MAX_MB` | Rotate log files at size threshold | Default written by management scripts |
| `LOG_MAX_FILES` | Max rotated files retained |  |
| `LOG_MAX_DAYS` | Max age for rotated logs |  |
| `BOT_STATE_SPLIT_DIR` | Split-mode bot state directory | Default is `bot-state` |

Additional log/runtime housekeeping knobs:

- `LOG_ROTATE_CHECK_MS`
- `LOG_PRUNE_CHECK_MS`
- `LOG_REPEAT_COOLDOWN_MS`

## Playback, History, And Metadata

| Variable | Purpose |
| --- | --- |
| `NOW_PLAYING_ENABLED` | Enable now-playing updates |
| `NOW_PLAYING_COVER_ENABLED` | Enable cover lookups |
| `SONG_HISTORY_ENABLED` | Enable song history |
| `SONG_HISTORY_MAX_PER_GUILD` | Song history retention per guild |
| `LISTENER_STATS_POLL_MS` | Listening-stats poll interval |
| `ONBOARDING_MESSAGE_ENABLED` | Runtime onboarding/help messaging |

Stream and transcoding variables used by the runtime:

- `TRANSCODE`
- `TRANSCODE_MODE`
- `OPUS_APPLICATION`
- `OPUS_BITRATE`
- `OPUS_COMPRESSION`
- `OPUS_FRAME`
- `OPUS_PACKET_LOSS`
- `OPUS_VBR`

FFmpeg tuning variables read by code:

- `FFMPEG_PROBESIZE`
- `FFMPEG_ANALYZE_US`
- `FFMPEG_RTBUFSIZE`
- `FFMPEG_IO_TIMEOUT_US`
- `FFMPEG_RW_TIMEOUT_US`
- `FFMPEG_MAX_DELAY_US`
- `FFMPEG_THREAD_QUEUE_SIZE`
- `FFMPEG_OUTPUT_FLUSH_PACKETS`
- `FFMPEG_STDERR_VERBOSITY`

## Audio Recognition

| Variable | Purpose | Notes |
| --- | --- | --- |
| `NOW_PLAYING_RECOGNITION_ENABLED` | Enable fingerprint fallback | Disabled by default |
| `ACOUSTID_API_KEY` | AcoustID API key | Required for recognition |
| `NOW_PLAYING_MUSICBRAINZ_ENABLED` | Enable MusicBrainz enrichment | Defaults to enabled |
| `NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS` | Capture duration | Default `18` |
| `NOW_PLAYING_RECOGNITION_MIN_SECONDS` | Minimum usable captured audio | Default `10` |
| `NOW_PLAYING_RECOGNITION_TIMEOUT_MS` | Recognition timeout | Default `28000` |
| `NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD` | Minimum accepted AcoustID score | Default `0.55` |

Additional recognition tuning variables:

- `NOW_PLAYING_RECOGNITION_CAPTURE_RETRIES`
- `NOW_PLAYING_RECOGNITION_CAPTURE_SAMPLE_RATE`
- `NOW_PLAYING_RECOGNITION_CAPTURE_CHANNELS`
- `NOW_PLAYING_RECOGNITION_CACHE_TTL_MS`
- `NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS`
- `NOW_PLAYING_RECOGNITION_STREAM_SOFT_FAILURE_TTL_MS`
- `NOW_PLAYING_RECOGNITION_SOFT_LOG_COOLDOWN_MS`
- `NOW_PLAYING_RECOGNITION_NO_MATCH_LOG_COOLDOWN_MS`
- `NOW_PLAYING_MUSICBRAINZ_MIN_DELAY_MS`
- `NOW_PLAYING_ACOUSTID_MIN_DELAY_MS`

## Voice And Runtime Reliability

| Variable | Purpose |
| --- | --- |
| `PREMIUM_GUILD_ACCESS_MODE` | Guild scope enforcement behavior |
| `VOICE_CHANNEL_STATUS_ENABLED` | Voice channel status updates |
| `VOICE_CHANNEL_STATUS_TEMPLATE` | Voice channel status template |
| `VOICE_CHANNEL_STATUS_REFRESH_MS` | Voice channel status refresh delay |
| `VOICE_CHANNEL_STATUS_MAX_LENGTH` | Voice channel status max length |
| `VOICE_STATE_RECONCILE_ENABLED` | Voice-state reconciliation |
| `VOICE_STATE_RECONCILE_MS` | Voice-state reconciliation interval |
| `VOICE_MOVE_POLICY` | How OmniFM reacts to foreign voice-channel moves: `allow`, `return`, or `disconnect` |
| `VOICE_MOVE_CONFIRMATIONS` | Confirmed mismatches before a foreign move counts as real |
| `VOICE_MOVE_RETURN_COOLDOWN_MS` | Cooldown between protected return attempts |
| `VOICE_MOVE_WINDOW_MS` | Time window for repeated foreign-move escalation |
| `VOICE_MOVE_MAX_EVENTS_PER_WINDOW` | Max confirmed foreign moves inside the escalation window |
| `VOICE_MOVE_ESCALATION` | Escalation after repeated foreign moves: `disconnect` or `cooldown` |
| `VOICE_MOVE_ESCALATION_COOLDOWN_MS` | Cooldown applied when escalation mode is `cooldown` |
| `VOICE_TRANSIENT_RECHECK_MS` | Recheck delay for transient mismatches |
| `VOICE_STATE_MISSING_CONFIRMATIONS` | Missing-state confirmation threshold |
| `VOICE_RECONNECT_RESOURCE_CONFIRMATIONS` | Resource confirmation threshold before clearing reconnect targets |
| `VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS` | Reconnect failures before the circuit opens |
| `VOICE_RECONNECT_CIRCUIT_BREAKER_MS` | Circuit-open cooldown |
| `VOICE_RECONNECT_MAX_MS` | Max reconnect backoff |
| `DNS_LOOKUP_RETRY_COUNT` | DNS retry count |
| `DNS_LOOKUP_RETRY_DELAY_MS` | DNS retry delay |
| `DNS_LOOKUP_CACHE_TTL_MS` | DNS cache TTL |
| `DNS_LOOKUP_STALE_TTL_MS` | DNS stale-cache TTL |

Additional voice/runtime guard rails used by code:

- `VOICE_RECONNECT_MAX_CIRCUIT_TRIPS`
- `VOICE_RECONNECT_PERMISSION_CONFIRMATIONS`
- `VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS`
- `RESTORE_RETRY_BASE_MS`
- `RESTORE_RETRY_MAX_MS`
- `STREAM_HEALTHCHECK_ENABLED`
- `STREAM_HEALTHCHECK_POLL_MS`
- `STREAM_HEALTHCHECK_GRACE_MS`
- `STREAM_HEALTHCHECK_STALL_MS`
- `STREAM_HEALTHCHECK_RESTART_MS`
- `STREAM_IDLE_RESTART_WINDOW_MS`
- `STREAM_IDLE_RESTART_EXP_STEPS`
- `EVENT_DEFAULT_TIMEZONE`
- `EVENT_SCHEDULER_ENABLED`

Voice guard resolution order:

- Voice guard itself is only active on guilds with the `Ultimate` capability tier.
- Global defaults come from the `VOICE_MOVE_*` env values.
- A guild can override only the move policy through dashboard settings or `/voiceguard policy`.
- Temporary admin unlocks via `/voiceguard unlock` only affect the currently active runtime session.
- In split mode, `/voiceguard status`, `/voiceguard unlock`, and `/voiceguard lock` accept an optional `bot` worker slot so the active worker can be targeted explicitly.

## Provider Integrations

### DiscordBotList

| Variable | Purpose |
| --- | --- |
| `DISCORDBOTLIST_ENABLED` | Enable DiscordBotList features |
| `DISCORDBOTLIST_TOKEN` | API token |
| `DISCORDBOTLIST_BOT_ID` | Explicit bot ID |
| `DISCORDBOTLIST_SLUG` | Public listing slug |
| `DISCORDBOTLIST_WEBHOOK_SECRET` | Vote webhook secret |
| `DISCORDBOTLIST_STATS_SCOPE` | `commander` or `aggregate` |
| `DISCORDBOTLIST_COMMANDS_SYNC_MS` | Command sync interval |
| `DISCORDBOTLIST_STATS_SYNC_MS` | Stats sync interval |
| `DISCORDBOTLIST_VOTE_SYNC_MS` | Vote sync interval |

### Top.gg

| Variable | Purpose |
| --- | --- |
| `TOPGG_ENABLED` | Enable Top.gg features |
| `TOPGG_TOKEN` | API token |
| `TOPGG_BOT_ID` | Explicit bot ID |
| `TOPGG_WEBHOOK_SECRET` | Vote webhook secret |
| `TOPGG_STATS_SCOPE` | `commander` or `aggregate` |
| `TOPGG_STARTUP_DELAY_MS` | Initial sync delay |
| `TOPGG_PROJECT_SYNC_MS` | Project sync interval |
| `TOPGG_COMMANDS_SYNC_MS` | Command sync interval |
| `TOPGG_STATS_SYNC_MS` | Stats sync interval |
| `TOPGG_VOTE_SYNC_MS` | Vote sync interval |
| `TOPGG_VOTE_SYNC_START_DAYS` | Initial vote-backfill window |

### discord.bots.gg

| Variable | Purpose |
| --- | --- |
| `BOTSGG_ENABLED` | Enable discord.bots.gg stats sync |
| `BOTSGG_TOKEN` | API token |
| `BOTSGG_BOT_ID` | Explicit bot ID |
| `BOTSGG_STATS_SCOPE` | `commander` or `aggregate` |
| `BOTSGG_STARTUP_DELAY_MS` | Initial sync delay |
| `BOTSGG_STATS_SYNC_MS` | Stats sync interval |

## Split Runtime / Remote Worker Bridge

| Variable | Purpose |
| --- | --- |
| `BOT_PROCESS_ROLE` | Internal role marker for split processes |
| `BOT_PROCESS_INDEX` | Worker process bot index |
| `REMOTE_WORKER_HEARTBEAT_MS` | Remote worker heartbeat interval |
| `REMOTE_WORKER_COMMAND_POLL_MS` | Remote command poll interval |
| `REMOTE_WORKER_COMMAND_TTL_MS` | Remote command TTL |
| `REMOTE_WORKER_STATUS_POLL_MS` | Remote status poll interval |
| `REMOTE_WORKER_STATUS_STALE_MS` | Remote status staleness threshold |

Operational update strategy variables:

- `UPDATE_STRATEGY`
- `UPDATE_ROLLING_DELAY_MS`
- `UPDATE_ROLLING_WAIT_TIMEOUT_MS`
- `WORKER_AUTOHEAL_ENABLED`
- `WORKER_AUTOHEAL_CHECK_MS`
- `WORKER_AUTOHEAL_GRACE_MS`
- `WORKER_AUTOHEAL_RECOVERING_MS`

## Legal Pages

Required minimum:

| Variable | Purpose |
| --- | --- |
| `LEGAL_PRODUCT_NAME` | Public product/service name, for example `OmniFM` |
| `LEGAL_PROVIDER_NAME` | Legal operator/provider name, for example `IT-Tabelander`; do not put only the product name here |
| `LEGAL_STREET_ADDRESS` | Street address |
| `LEGAL_POSTAL_CODE` | Postal code |
| `LEGAL_CITY` | City |
| `LEGAL_EMAIL` | Legal contact email |

Obvious placeholder values such as `Example ...`, `*@example.com`, `localhost`, and `127.0.0.1` are treated as missing in public legal payloads so the website does not look legally configured when only sample data was copied.

Common optional fields:

- `LEGAL_COUNTRY`
- `LEGAL_WEBSITE`
- `LEGAL_PHONE`
- `LEGAL_LEGAL_FORM`
- `LEGAL_REPRESENTATIVE`
- `LEGAL_BUSINESS_PURPOSE`
- `LEGAL_COMMERCIAL_REGISTER_NUMBER`
- `LEGAL_COMMERCIAL_REGISTER_COURT`
- `LEGAL_VAT_ID`
- `LEGAL_SUPERVISORY_AUTHORITY`
- `LEGAL_CHAMBER`
- `LEGAL_PROFESSION`
- `LEGAL_PROFESSION_RULES`
- `LEGAL_EDITORIAL_RESPONSIBLE`
- `LEGAL_MEDIA_OWNER`
- `LEGAL_MEDIA_LINE`

Privacy page fields:

- `PRIVACY_CONTACT_EMAIL`
- `PRIVACY_CONTACT_PHONE`
- `PRIVACY_DPO_NAME`
- `PRIVACY_DPO_EMAIL`
- `PRIVACY_HOSTING_PROVIDER`
- `PRIVACY_HOSTING_LOCATION`
- `PRIVACY_ADDITIONAL_RECIPIENTS`
- `PRIVACY_CUSTOM_NOTE`
- `PRIVACY_AUTHORITY_NAME`
- `PRIVACY_AUTHORITY_WEBSITE`

Terms page fields:

- `TERMS_CONTACT_EMAIL`
- `TERMS_SUPPORT_URL`
- `TERMS_EFFECTIVE_DATE`
- `TERMS_GOVERNING_LAW`
- `TERMS_CUSTOM_NOTE`

## Less Common Runtime Variables Still Read By Code

These are not usually needed for normal operation but currently exist in the runtime:

- `API_RATE_STATE_MAX_ENTRIES`
- `NODE_TEST_CONTEXT`
- `OMNIFM_ALLOW_LOCAL_WEBHOOKS`
- `OMNIFM_BASE_URL`
- `OMNIFM_COMMAND_PERMISSIONS_FILE`
- `OMNIFM_CUSTOM_STATIONS_FILE`
- `OMNIFM_DOCKER_SERVICE`
- `OMNIFM_LOG_SINCE`
- `RECOGNITION_TEST_URL`
- `WEB_STRICT_FRONTEND_BUILD`
