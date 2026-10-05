# LyricView

A transparent, draggable Electron overlay for Spotify lyrics. Vanilla JavaScript, HTML and CSS; no build step or extra service account required for lyrics.

## Run

Use Node.js 24 LTS or newer. From this project folder:

```powershell
npm.cmd ci
npm.cmd start
```

For a preview without a Spotify account:

```powershell
npm.cmd run demo
```

The demo contains original sample text, not downloaded or bundled song lyrics. Demo is a session-only option. Use Settings to leave demo mode.

## Spotify setup (your action required)

1. Sign into https://developer.spotify.com/dashboard and create or select the LyricView app. Select Web API.
2. Register **exactly** `http://127.0.0.1:43821/callback` as a redirect URI. Do not use localhost.
3. Copy the Client ID (not the Client Secret).
4. Start LyricView, hover the overlay, and click the gear. Paste the ID in Account and click Save.
5. Click Connect Spotify, approve access in your browser, then play a song in Spotify.

The app uses Authorization Code with PKCE and requests `user-read-currently-playing` and `user-read-playback-state`. It never needs a Client Secret. The app owner needs Spotify Premium for Development Mode; up to five authorized users can be allowlisted. Additional testers must be added to the dashboard allowlist. Public distribution needs separate planning; Development Mode is limited.

Official references: [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri), [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

LRCLIB supplies synchronized or plain lyrics and needs no API key: https://lrclib.net/docs. Lyrics are fetched at runtime and cached locally, not bundled with the app.

## Controls

- Drag anywhere on the lyric area to move the overlay. Position and size are saved.
- Hover to reveal the settings gear; right-click the overlay for Settings, demo, and Quit.
- Synchronized lyric rows slide as the current line advances, and song changes fade between lyric displays. Seeks jump directly to their new position. Animations respect the system reduced-motion preference.
- `Ctrl+Shift+L` shows/hides the overlay (`Cmd+Shift+L` on macOS). Change it in Settings.
- `Ctrl+Shift+,` opens Settings even when the overlay is hidden or click-through is enabled (`Cmd+Shift+,` on macOS).
- Quit from Settings or the right-click menu. Closing Settings leaves the overlay running.
- Window dimensions are chosen by the user using unlocked edge resizing or Width/Height controls in Settings. Lyrics wrap at that width; font changes preserve the size and position.
- Appearance updates immediately: colors, font size (12–72 px), font family, opacity and 1/3/5 lines.
- Backdrop color and strength control a soft rounded background behind the lyrics. The default is black at 22% strength; 0% disables it. These preferences apply live and are saved separately from text opacity.
- Lock mode forwards mouse input to applications underneath and disables dragging/resizing. Hover the overlay to reveal the gear; only the gear accepts clicks. Settings can also be reopened with the recovery shortcut.

## Files

`main.js` owns windows, shortcuts, validated IPC and polling. `preload.js` exposes a narrow bridge to sandboxed renderers. `spotify.js` handles PKCE, token refresh and the temporary loopback callback server. `lyrics.js` handles LRCLIB and caching. `sync.js` parses LRC and resolves the current lyric line. `store.js` validates and persists settings. `overlay/` and `settings/` contain the two interfaces. `project_design_doc.md` is the original design reference.

Settings, the encrypted refresh token, and the bounded lyrics cache live in Electron's user-data folder, normally `%APPDATA%\lyricview` on Windows. Tokens never reach renderer code. `safeStorage` encryption requires the OS credential store; insecure Linux basic-text storage is refused. Logout deletes the stored refresh token. Reset restores appearance/behavior and keeps the Client ID.

## Verification

```powershell
npm.cmd test
npm.cmd run smoke
```

Unit tests cover LRC timestamps, seeks/pauses, settings persistence and validation, display bounds, lyric fallbacks/caching, PKCE, token lifecycle, and API retry behavior. Smoke opens hidden Electron windows, checks sandboxed preload and settings IPC, persists a change and verifies it reaches the overlay. Its isolated test data is under ignored `tmp/`. It checks renderer DOM, sandbox isolation, settings IPC, disk persistence, and live appearance updates without relying on GPU screenshot capture.

Real Spotify login, live synchronization, dragging, game overlays, and performance need manual checks on your machine. Test borderless-windowed games; exclusive full-screen can obscure the overlay. Transparent native edge resizing varies by OS/window manager. Mac and Linux need their own verification; do not treat Windows success as cross-platform validation.

## Current scope

Core overlay, Spotify and LRCLIB integration, persistence, customization, click-through and shortcuts are implemented. Packaging/installers, tray support, startup launch, manual timing offsets and other future ideas are deferred. No live Spotify verification is claimed until you configure and authorize the app.

The overlay uses equal 30px padding on all sides. Both window modes stay on top; locked mode passes clicks through the lyrics and prevents manual resizing, while its hover settings button remains clickable.

Window size is now manual: drag the unlocked window edges or use Width/Height in Settings. Font changes leave the box size and position unchanged. Lyrics wrap, with the current lyric centered vertically; surrounding context can extend beyond a short window.
