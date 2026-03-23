# Pianio

Free piano lessons that listen.

https://github.com/user-attachments/assets/c39e6335-71bb-4d38-9abf-772879aa217a

**80 courses · 1500+ exercises · Open source**

🎹 [Try it live](https://dipiano.web.app) · 💻 [View source](https://github.com/ismaelponce/pianio)

---

A free, open-source piano learning platform. Practice method courses, technique drills, and real songs — all in your browser with a MIDI keyboard.

## Features

- **80 courses, 1500+ exercises** across Method, Technique, and Songs
- **Web MIDI** — plug in any MIDI keyboard and play
- **Sheet music rendering** via OpenSheetMusicDisplay (OSMD)
- **Practice & Performance modes** — untimed practice or timed performance with star ratings
- **Chords** — multi-note chord recognition and grading
- **Dynamics coaching** — velocity feedback (pp through ff) without blocking progress
- **Sustain pedal tracking** — CC64 pedal detection with coaching feedback
- **Ties & dotted rhythms** — full rhythmic notation support
- **Swing timing** — automatic off-beat adjustment for jazz/blues pieces
- **Section looping** — select measure ranges to drill specific passages
- **Progress tracking** — stars, streaks, and completion stored in localStorage
- **Dark mode** — full light/dark theme support

## Tech Stack

React 19 · TypeScript · Vite 7 · Tone.js · OSMD · Web MIDI API · Firebase Hosting

## Getting Started
```bash
pnpm install
pnpm dev
```

This regenerates content assets and starts the Vite dev server at `http://localhost:5173`.

## Build
```bash
pnpm build
```

## Project Structure
```
apps/web/              Vite SPA (React)
packages/core-engine/  Practice matching engine
packages/midi-web/     Browser MIDI adapter
packages/content-schema/ TypeScript content types
content/               Course source files (JSON)
scripts/               Content generation pipeline
```

## Audio Samples

Piano sounds use the [Salamander Grand Piano](https://sfzinstruments.github.io/pianos/salamander/) samples by Alexander Holm, licensed under [CC-BY-3.0](https://creativecommons.org/licenses/by/3.0/), served via the Tone.js CDN.

## License

Code: [MIT](LICENSE) · Content: [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/)
