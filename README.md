# SkyWrite Web

Browser-based learning dashboard and air-writing practice app, adapted from the original Python prototypes without modifying them.

## Learning modes

- **Start Learning** creates or resumes an on-device learner profile and selects the next adaptive challenge.
- The learning path begins with `A, a, B, b`, rotates earlier skills back in, and introduces one new character at a time without keeping more than six Level 1 skills active.
- Level 1 requires three consecutive completions under 30 seconds with at least 80% of tracked movement inside the tracing corridor.
- Level 2 requires three consecutive completions under 30 seconds with at least 80% dotted-path coverage.
- Level 3 requires five consecutive completions under 30 seconds without revealing either hint.
- The three practice cards run an endless random-character session at the chosen level and never change mastery progress.

Learner progress is saved in the current browser after every completed learning-path character. No email, password, camera frame, or hand-tracking data is stored. Cross-device accounts require a future hosted authentication and database provider.

## Run locally

```bash
npm install
npm run dev
```

Use a mouse or touchscreen immediately. Select **Turn on air writing** to enable browser-based MediaPipe hand tracking; camera frames stay in the browser.

## Deploy

Import this repository into Vercel. The included `vercel.json` identifies the Vite build and supports client-side routing.
