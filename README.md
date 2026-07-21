# SkyWrite Web

Browser-based learning dashboard and air-writing practice app, adapted from the original Python prototypes without modifying them.

## Learning modes

- **Start Learning** creates or resumes an on-device learner profile and selects the next adaptive challenge.
- The learning path begins with `A, a, B, b`, rotates earlier skills back in, and introduces one new character at a time without keeping more than six Level 1 skills active.
- Level 1 requires three consecutive completions under 30 seconds with at least 80% of tracked movement inside the tracing corridor.
- Level 2 requires three consecutive completions under 30 seconds with at least 80% dotted-path coverage.
- Level 3 requires five consecutive completions under 30 seconds without revealing either hint, then promotes the character to Level 4.
- Level 4 requires three consecutive recognized free-writing passes before a character is mastered. A tracing reminder disqualifies that attempt from mastery. Any failed mastery check resets the current level's consecutive count.
- All four practice cards run an endless random-character session at the chosen level and never change mastery progress.
- **Level 4: Free Write** initially shows only the target character. Camera points pass through the delayed DRAW/MOVE intent model and stroke smoother, then a symbol model checks the cleaned result against the hidden manuscript stroke order. Short off-template startup marks are discarded, and a confident whole-character match advances automatically. The board clears after the drawing covers 9% of its area or after 15 seconds without intentional drawing. If no passing answer is detected within 30 seconds, the dotted character and sidebar stroke arrows appear as a reminder; a recognized guided result can complete the task but does not count toward mastery. These models are not loaded or used by Levels 1–3.

Learner progress is saved in the current browser after every completed learning-path character. No email, password, camera frame, or hand-tracking data is stored. Cross-device accounts require a future hosted authentication and database provider.

## Run locally

```bash
npm install
npm run dev
```

Use a mouse or touchscreen immediately. Select **Turn on air writing** to enable browser-based MediaPipe hand tracking; camera frames stay in the browser.

## Deploy

Import this repository into Vercel. The included `vercel.json` identifies the Vite build and supports client-side routing.
