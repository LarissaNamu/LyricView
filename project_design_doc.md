# Floating Lyrics Overlay: Product Design Document

**Version:** 0.1 (Draft) | **Platforms:** Windows, macOS, Linux | **Stack:** Electron + vanilla JS

---

## 1. Overview

A lightweight desktop app that shows synced lyrics for whatever is playing on the user's Spotify account. The lyrics live in a transparent, always-on-top, draggable box that can sit anywhere on screen, over a game, a browser, or a second monitor.

**One-line pitch:** Your Spotify lyrics, floating on your desktop, styled your way.

## 2. Problem & Goals

**Problem.** Spotify's built-in lyrics view takes over the app window. People who work, game, or browse while listening can't keep lyrics visible without giving up screen space or switching windows.

**Goals**

1. Show the current lyric line in real time, with minimal clutter.
2. Let users position and style the box freely.
3. Setup in under two minutes (log in once, done).
4. Stay small: low CPU and memory use while idle.

**Non-goals (v1)**

- Playback controls (play, pause, skip)
- A lyrics editor or contribution tool
- Mobile support
- Support for music services other than Spotify

## 3. Target Users

| Persona | Need |
| --- | --- |
| **Multitasker** | Reads lyrics while working or studying |
| **Gamer / streamer** | Wants a subtle overlay on top of other windows |
| **Language learner** | Follows lyrics line by line to learn vocabulary |
| **Karaoke-at-home fan** | Wants large, readable, highlighted lines |

## 4. Core User Flows

### 4.1 First launch

1. App opens a small overlay with a "Connect Spotify" button.
2. User clicks it, and the default browser opens Spotify's consent page.
3. After approval, the browser redirects back to the app and the overlay switches to "Waiting for music…".
4. Play a song, and lyrics appear.

### 4.2 Everyday use

1. Launch the app, and it auto-reconnects with the saved login.
2. The overlay appears where the user last left it, with their saved style.
3. Lyrics follow the song and update on track changes.

### 4.3 Customize

1. Hover over the overlay, and a small gear icon fades in.
2. Click it to open the settings panel.
3. Changes apply live, with no save button needed.

### 4.4 Log out

Settings → Account → **Log out**. The app deletes the stored token and returns to the "Connect Spotify" state.

## 5. Features & Requirements

### 5.1 Must have (v1)

| ID | Requirement |
| --- | --- |
| F1 | Transparent background, frameless window |
| F2 | Always-on-top across other windows |
| F3 | Drag to move from anywhere on the lyric area; position remembered between launches |
| F4 | Detect the currently playing Spotify track, artist, and playback position |
| F5 | Fetch and display synced lyrics, highlighting the current line |
| F6 | Fallback to plain (unsynced) lyrics, or a "No lyrics found" message |
| F7 | Settings button with: Spotify log in / log out |
| F8 | Settings: lyric text color (current line and other lines separately) |
| F9 | Settings: font size slider |
| F10 | Settings persist locally between sessions |

### 5.2 Should have

| ID | Requirement |
| --- | --- |
| F11 | Opacity slider for the text |
| F12 | Font family picker |
| F13 | Click-through lock mode (mouse passes through the box to the apps beneath) |
| F14 | Resize by dragging edges |
| F15 | Lines shown: 1, 3, or 5 (previous, current, next) |
| F16 | Global hotkey to show or hide the overlay |

### 5.3 Nice to have (later)

- Text shadow or outline for readability on bright backgrounds
- Smooth line-to-line animations
- Optional album art or track title display
- System tray icon with quick toggles
- Launch at startup
- Manual lyric offset (nudge timing ±) per song

## 6. Screens & Layout

### 6.1 Overlay (main view)

- No window frame or background. Only text is visible.
- Current line is larger and fully opaque. Neighboring lines are dimmer and smaller.
- A faint dashed outline and a gear icon appear **only on hover**, so the box is invisible when idle.

```
          (previous line, dim)
   ▶  CURRENT LINE, HIGHLIGHTED  ◀
          (next line, dim)                [⚙ on hover]
```

### 6.2 Settings panel

A small compact panel (separate window or slide-out) with sections:

**Account**

- Status: "Connected as *username*"
- Button: Log in / Log out

**Appearance**

- Current line color (color picker)
- Other lines color (color picker)
- Font size (slider, 12–72 px)
- Font family (dropdown)
- Text opacity (slider)
- Lines displayed (1 / 3 / 5)

**Behavior**

- Lock position and click-through (toggle)
- Always on top (toggle)
- Show/hide hotkey (input)

**Footer:** Reset to defaults, Close.

### 6.3 Empty and error states

| State | Message |
| --- | --- |
| Not logged in | "Connect Spotify to get started" + button |
| Nothing playing | "Play something on Spotify ♪" |
| No lyrics found | "No lyrics found for this song" |
| Instrumental | "Instrumental" |
| Connection lost | "Reconnecting…" with a retry in the background |
| Token expired | Silent refresh; if that fails, show the login button |

## 7. Technical Design

### 7.1 Architecture

```
┌────────────────────── Electron ──────────────────────┐
│ Main process                                          │
│  • Creates transparent overlay window                 │
│  • Spotify OAuth (PKCE) + token storage               │
│  • Polling loop, lyrics fetching                      │
│  • Settings store, global shortcuts                   │
│            ▲ IPC (contextBridge) ▼                    │
│ Renderer: Overlay UI        Renderer: Settings UI     │
└───────────────────────────────────────────────────────┘
        │                                │
   Spotify Web API                   LRCLIB API
```

### 7.2 Window configuration

- `transparent: true`, `frame: false`, `hasShadow: false`
- `alwaysOnTop: true` (level set to `screen-saver` on macOS to float above full-screen apps)
- `skipTaskbar: true`, `resizable: true`
- Dragging via CSS `-webkit-app-region: drag`. Interactive elements (gear, controls) use `no-drag`.
- Click-through via `setIgnoreMouseEvents(true, { forward: true })`, toggled when the cursor enters the gear hotspot.

### 7.3 Spotify integration

- **Auth:** Authorization Code flow with PKCE. No client secret is stored in the app.
- **Scope:** `user-read-currently-playing` and `user-read-playback-state`
- **Redirect:** loopback address (`http://127.0.0.1:PORT/callback`) handled by a temporary local server.
- **Storage:** refresh token saved with the OS keychain (e.g. `keytar` or Electron `safeStorage`).
- **Polling:** `GET /v1/me/player/currently-playing` every \~3 seconds. Back off to \~10 seconds when nothing is playing.
- **Log out:** delete stored tokens and clear in-memory state.

### 7.4 Lyrics source

- **Primary:** LRCLIB (free, open, no key) for time-synced lyrics, matched by track, artist, album, and duration.
- **Fallback:** plain lyrics from the same service if no synced version exists.
- **Caching:** store fetched results locally by track ID to avoid repeat requests.
- Lyrics are fetched and displayed at runtime only. The app never bundles lyric text.

### 7.5 Sync algorithm

1. On each poll, record `progress_ms` and the local timestamp.
2. Between polls, estimate position as `progress_ms + (now − lastPollTime)`.
3. Binary-search the parsed lyric timestamps to find the current line.
4. Re-anchor whenever a poll shows drift beyond \~300 ms (seeks, pauses, track changes).
5. If playback is paused, freeze the timer.

### 7.6 Settings storage

JSON file in the user's app-data directory:

```json
{
  "position": { "x": 400, "y": 700, "width": 800, "height": 200 },
  "fontSize": 32,
  "fontFamily": "Inter",
  "currentColor": "#ffffff",
  "otherColor": "#ffffff99",
  "opacity": 1,
  "linesShown": 3,
  "clickThrough": false,
  "alwaysOnTop": true,
  "hotkey": "CommandOrControl+Shift+L"
}
```

### 7.7 Suggested project structure

```
lyrics-overlay/
├── package.json
├── main.js            # windows, IPC, shortcuts
├── spotify.js         # auth + polling
├── lyrics.js          # LRCLIB fetch, LRC parser, cache
├── store.js           # settings persistence
├── preload.js         # safe IPC bridge
├── overlay/           # index.html, overlay.js, overlay.css
└── settings/          # index.html, settings.js, settings.css
```

## 8. Design Principles

1. **Invisible until needed.** No chrome, borders, or backgrounds when idle.
2. **Readable anywhere.** Offer shadow and outline so text works on light and dark backgrounds.
3. **Zero friction.** Log in once, then it just works.
4. **Never in the way.** Click-through and hotkeys let users get the overlay out of the way instantly.

## 9. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Spotify has no lyrics endpoint | Core feature depends on a third party | Use LRCLIB; keep the lyrics provider behind an interface so it can be swapped |
| Lyrics missing for some songs | Empty experience | Clear fallback messages; plain-lyrics fallback |
| Sync drift | Lines highlight too early or late | Frequent re-anchoring; manual offset control (later) |
| Spotify API rate limits | Missed updates | Adaptive polling, caching, exponential backoff |
| Spotify dev-mode user cap | Limits public distribution | Fine for personal use; apply for extended quota before wider release |
| Overlay hidden over exclusive full-screen games | Overlay doesn't appear | Document that borderless-windowed mode is required |
| Licensing of lyrics content | Legal exposure if distributed | Fetch at runtime only, never bundle; review provider terms before public release |
| Linux transparency varies by compositor | Visual glitches | Document supported setups; test on common desktops |

## 10. Success Metrics

- Time to first lyric after install: **under 2 minutes**
- Idle CPU usage: **under 2%**
- Idle memory: **under 150 MB**
- Lyric timing accuracy: **within ±500 ms** on songs with synced lyrics
- Songs with lyrics found: **target 85%+** of a typical listener's library

## 11. Milestones

| Phase | Scope | Est. time |
| --- | --- | --- |
| **M1: Prototype** | Transparent draggable window with hard-coded text | 0.5 day |
| **M2: Spotify** | OAuth login/logout, now-playing polling | 1 day |
| **M3: Lyrics** | LRCLIB fetch, LRC parser, synced highlighting | 1 day |
| **M4: Settings** | Settings panel, color/size controls, persistence | 1 day |
| **M5: Polish** | Hover gear, click-through, hotkey, error states | 1–2 days |
| **M6: Package** | Installers via `electron-builder` for each OS | 0.5 day |

## 12. Open Questions

1. Should settings open as a separate window or a slide-out inside the overlay?
2. Is a system tray icon required for v1, or is the hotkey enough?
3. Should the app support a manual lyric search when auto-match fails?
4. Is public distribution planned, or is this personal use only? (This affects Spotify quota and lyric licensing.)

## 13. Future Ideas

- Translation line under each lyric (for language learners)
- Themes (neon, minimal, karaoke)
- Support for other players (Apple Music, YouTube Music)
- Shareable style presets