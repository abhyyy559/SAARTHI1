# SAARTHI Stitch design reference

Project: SAARTHI Regional Decision Assistant (`18005686446919134555`)
Screen: SAARTHI Desktop - Simple 4-Section Voice & Advisory (`4c89cec11a6144b6891fb0d5d4a1a43c`)

## Downloaded artifacts
- `screen-full.png`: full-resolution screenshot, verified PNG, 2560 × 2048.
- `screen.png`: default hosted thumbnail, verified PNG, 512 × 410.
- `screen.html`: original exported HTML, 22,032 bytes. Uses external Tailwind CDN and Google Fonts. This is a design prototype, not the connected application; sample data and listening indicators must not be treated as live state.

## MCP setup
The repository-root `opencode.json` configures the remote Stitch server with OAuth disabled and a file-reference API-key header. The credential is stored outside this repository at `~/.config/opencode/secrets/stitch-key`. Do not commit or embed the credential in frontend code. Rotate the key shared in chat and replace that local file's contents.

Verified: authenticated MCP initialize, tool discovery, and get_screen for this exact resource. OpenCode recognizes the project config. Restart OpenCode in this workspace to load the newly configured tools into a fresh session.

## Implementation boundary
No application files were changed for this export. No commit or deployment was made. User design approval is required before integration.

Likely integration targets within `weathergpt/frontend-react/src`: `components/Home.jsx`, `components/ChatPanel.jsx`, `components/VoicePanel.jsx`, `components/ProfileAdvice.jsx`, `components/Shell.jsx`, and `styles.css`. Adapt the reference into existing React and CSS rather than shipping the standalone prototype or adding its CDN dependencies. Preserve profile/language wiring, real microphone state, source timestamps and unavailable-warning states.
