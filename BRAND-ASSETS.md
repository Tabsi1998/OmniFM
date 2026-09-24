# OmniFM — Bild- & Marken-Assets (Übersicht)

Alle Bilder liegen im Repo unter `frontend/public/`. Im Browser erreichbar unter
`http://<dein-server>:3000/<pfad>` bzw. über die **Brand-Kit-Seite: `/brand`**
(dort kannst du Assets direkt ansehen/herunterladen).

## 1) Marken-Assets  (`frontend/public/brand/`)
| Datei | Zweck |
|---|---|
| `omnifm-mark.svg` | **Master-Zeichen** (Infinity + Soundwave) – einzige Quelle, verlustfrei |
| `omnifm-mark-transparent.png` | Zeichen transparent (1024×1024) |
| `omnifm-mark-on-dark.png` / `-on-light.png` | Zeichen für dunkle/helle Flächen |
| `omnifm-mark-black.png` / `-white.png` | Ein-Farb-Varianten |
| `omnifm-discord-avatar.png` | **Marken-Discord-Avatar** (1024×1024, quadratisch) |
| `omnifm-wordmark-*.png` | Wortmarke (dark/light/on-dark/on-light) |
| `omnifm-banner*.png` | Banner (normal / light / transparent) |
| `omnifm-favicon.png` | Favicon |
| `omnifm-sponsor-badge.png` | Sponsor-Badge |

## 2) Bot-Avatare  (`docs/brand-assets/bots/`), quadratisch 1024×1024
Speziell für das **Discord Developer Portal** (Avatare müssen 1:1 sein):

| Datei | Bot | Farbe | Zuweisen an |
|---|---|---|---|
| `commander-dj.png` | **Commander / „DJ"** | Signal-Orange + Kopfhörer | Deine Haupt-App (Commander-Bot) |
| `worker-cyan.png` | Worker 1 | Cyber-Cyan | 1. Worker-Bot |
| `worker-orange.png` | Worker 2 | Signal-Orange | 2. Worker-Bot |
| `worker-red.png` | Worker 3 | Live-Red | 3. Worker-Bot |

### So weist du die Avatare zu (Discord Developer Portal)
1. https://discord.com/developers/applications öffnen
2. Application (Bot) auswählen → **General Information** → **App Icon** = Avatar hochladen
   - Commander-App → `commander-dj.png`
   - Worker-Apps → `worker-cyan.png` / `worker-orange.png` / `worker-red.png`
3. Speichern. Der Avatar erscheint dann als Bot-Profilbild in Discord.

> Hinweis: `frontend/public/img/bot-1..4.png` sind kleine Querformat-Vorschauen (384×256)
> für die Website und **nicht** als Discord-Avatar gedacht. Nutze für Avatare die
> quadratischen Originale aus `docs/brand-assets/bots/`. Sie liegen bewusst nicht
> in `frontend/public`, damit die Website sie nicht mit ausliefert (#258).
