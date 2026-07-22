# SkyWrite

**Little steps. Big sky writing.**

SkyWrite is a browser-based handwriting tutor that helps children learn uppercase letters, lowercase letters, and numbers by tracing with an index finger in the air. Its four-level learning path gradually removes guidance, while an adaptive review system keeps sessions focused on a small, manageable set of characters.

[Try the live app](https://skywrite-web.vercel.app/) · [View the repository](https://github.com/vapeyproductions/SkyWrite)

## What it does

SkyWrite turns a webcam into an air-writing canvas. MediaPipe tracks the learner's hand locally in the browser, and SkyWrite maps the index fingertip to a smoothed pen line. A learner can create a nickname-only profile, select **Start Learning**, and work toward mastery of all 62 characters in the order `A, a, B, b, ... Z, z, 0, 1, ... 9`.

| Level | Experience | Strong performance required to advance |
| --- | --- | --- |
| 1 — Guided tracer | Dotted character, start/end nodes, a tracing corridor, and a progress-linked guide | Finish in under 30 seconds with at least 80% of tracked movement inside the path, 3 times consecutively |
| 2 — Path finder | Dotted character, start/end nodes, and a progress-linked guide; no tracing corridor | Finish in under 30 seconds with at least 80% dotted-path coverage, 3 times consecutively |
| 3 — Sky writer | Dotted character with no immediate start, end, or guide cues | Finish in under 30 seconds without either timed hint, 5 times consecutively |
| 4 — Free write | Only the target character and an empty air-writing board | Earn a recognized free-writing pass without the tracing reminder, 3 times consecutively |

A failed mastery check resets that character's current-level streak. Progress is saved after every learning-path attempt. The four level cards on the dashboard also provide endless random practice, but practice-card results do not alter mastery.

The adaptive scheduler starts with four characters, introduces one new character at a time, keeps no more than six Level 1 skills active, avoids immediate repeats when possible, and prioritizes unseen, older, and nearly completed skills. This scheduler is deterministic application logic; GPT-5.6 helped design and implement it but is not called while a child is using SkyWrite.

## How Level 4 works

Level 4 is a hybrid machine-learning and geometric-validation pipeline. Both learned models were trained in PyTorch, exported to ONNX, and run in the browser with ONNX Runtime Web. No inference API or cloud model receives camera frames.

```text
Webcam
  -> MediaPipe Hand Landmarker (21 hand landmarks)
  -> 70-feature sequence
  -> DRAW/MOVE GRU
  -> delayed, smoothed pen strokes
  -> 3-channel 48x48 raster
  -> 62-class symbol CNN
  -> visibility/overdraw checks + targeted shape fallback
  -> pass, retry, or guided reminder
```

### 1. Pen-intent model

The first model decides whether the moving index finger represents **DRAW** or **MOVE**. Each frame contains 70 values:

- 63 wrist-relative, palm-scale-normalized coordinates from 21 three-dimensional hand landmarks;
- the index fingertip's three coordinates;
- its three velocity components; and
- scalar fingertip speed.

The browser supplies a causal window of 30 frames to a two-layer gated recurrent unit (GRU) with hidden size 96 and dropout 0.2. A layer-normalized linear head produces one draw-intent logit. The model has 104,545 learned parameters. Runtime hysteresis requires several consistent predictions before starting or stopping a line, and a 250 ms display delay lets the classifier remove short accidental transitions before showing the cleaned stroke.

Training used weighted binary cross-entropy to account for DRAW/MOVE imbalance, AdamW (`lr=1e-3`, `weight_decay=1e-4`), gradient clipping, and a participant-disjoint validation split. The saved checkpoint reached a held-out frame-level F1 score of **0.989** on the volunteer pilot corpus.

### 2. Symbol-recognition model

The second model classifies the completed air-writing as one of 62 labels: digits `0–9`, uppercase `A–Z`, or lowercase `a–z`. Each attempt is normalized and rasterized to a `3 x 48 x 48` tensor with separate channels for:

1. ink occupancy;
2. horizontal drawing direction; and
3. vertical drawing direction.

The convolutional neural network uses four convolution blocks (`32 -> 64 -> 128 -> 192` channels) with batch normalization, ReLU activations, pooling, global average pooling, 0.25 dropout, and a 62-class linear head. It has 329,794 learned parameters.

Training used cross-entropy with 0.05 label smoothing, AdamW (`lr=2e-3`, `weight_decay=2e-4`), cosine learning-rate annealing, and augmentation with small rotations, translations, scale changes, and Gaussian noise. Model selection used a participant-disjoint split so the same person's writing style could not appear in both training and validation. After selecting the checkpoint, the deployment model was fine-tuned on every usable sample so none of the contributed writing was discarded.

On the expanded participant-disjoint validation split of 186 samples from 3 entirely held-out writers, the selected pre-fine-tuning checkpoint achieved:

| Metric | Result |
| --- | ---: |
| Exact 62-class accuracy | 47.8% |
| Top-3 accuracy | 69.9% |
| Case-folded accuracy | 60.8% |

This harder split measures transfer to writers the model had never seen. It is a small volunteer-set engineering metric, not evidence of classroom effectiveness or performance across all children and devices. Because the deployed checkpoint was subsequently fine-tuned on the complete corpus, its final-corpus fit statistics are not reported as independent validation results.

### 3. Structural verifier and retry behavior

The CNN is the primary judge of the completed character. SkyWrite also removes tiny startup marks and rejects attempts that are too small, excessively long, too heavily filled, or far beyond the expected stroke count. Template geometry remains a fallback for historically ambiguous `0`, `I`, and `C/c` shapes, but it no longer vetoes a confident model match simply because a child lifted their finger or used a different valid stroke split.

The former model-and-template gate was too strict: only **7.0%** of 316 usable newly collected attempts passed the complete Level 4 pipeline. With the retrained model and calibrated quality checks, **85.4%** pass the same offline regression harness. That comparison measures behavior on samples used during this development round, so it validates the acceptance pipeline rather than estimating performance on unseen children.

If drawing covers 9% of the board without a passing answer, the board clears for another attempt. After 30 seconds without a pass, SkyWrite clears the previous ink and reveals the Level 3-style stroke diagrams and tracing sequence. The learner must touch each **GO**, follow its path to **END**, and wait for the next stroke. Completing this reminder finishes the activity but never counts toward the three-pass Level 4 mastery streak.

## How the models were developed

To obtain data that matched the actual interaction, a separate web collector presented all 62 characters to volunteers and recorded anonymous air-writing samples. MediaPipe ran on each volunteer's device; raw video was never uploaded. Each sample contained a pseudonymous participant code, the assigned character, normalized hand landmarks, the 70 derived features, timestamps, DRAW/MOVE labels, and normalized index-finger strokes.

After the second collection round, the private corpus contains **754 usable character samples from 17 pseudonymous participants**, spans all 62 classes, and contains **134,499 landmark frames**. The symbol model's selection split separated participants—not individual frames—to prevent one writer's samples from leaking into both training and validation. The chosen checkpoint was then fine-tuned across the complete usable corpus, exported with ONNX opset 17, checked for structural validity, and compared numerically with the PyTorch checkpoint before browser integration. The high-performing DRAW/MOVE intent checkpoint was retained because offline analysis identified character recognition and the template veto—not pen-intent classification—as the Level 4 bottlenecks.

Raw volunteer samples and PyTorch checkpoints are intentionally excluded from this public repository. The deployed, inference-only ONNX files and their non-identifying normalization metadata live in [`public/models`](public/models); the browser inference code is in [`src/intentModel.ts`](src/intentModel.ts) and [`src/symbolModel.ts`](src/symbolModel.ts). Export architecture is documented in [`scripts/export_intent_model.py`](scripts/export_intent_model.py) and [`scripts/export_symbol_model.py`](scripts/export_symbol_model.py).

## Privacy

- Camera frames, landmarks, and live writing remain on the learner's device.
- The app has no email/password account system. A profile is only a first name or nickname stored in that browser's `localStorage`.
- Learning progress is device-local and is not synchronized across browsers or devices.
- The public repository contains trained inference exports, not the private volunteer corpus.

SkyWrite is an educational prototype, not a diagnostic, therapeutic, or medical device.

## Run locally

Requirements: a current Node.js release, npm, and a browser with camera support.

```bash
git clone https://github.com/vapeyproductions/SkyWrite.git
cd SkyWrite
npm ci
npm run dev
```

Open the local URL printed by Vite. Levels 1–3 can be explored with a mouse or touchscreen. For air writing and Level 4, select **Turn on air writing**, allow camera access, and keep one raised index finger in view. Browser camera access requires HTTPS or `localhost`.

Useful checks:

```bash
npm run build
npm run preview
```

## Judge walkthrough

1. Open the [Vercel deployment](https://skywrite-web.vercel.app/) in a current Chrome or Edge browser on a device with a front-facing camera.
2. Select **Start Learning**, enter a nickname, and allow camera access.
3. Follow the **GO**, guide, and **END** cues in Levels 1 and 2; Level 3 demonstrates delayed hints.
4. Open the Level 4 practice card to see free-writing recognition and the 30-second guided fallback.
5. Return to the dashboard to see character-by-character progress. No login, payment, API key, or special judge account is required.

## Project structure

```text
src/
  App.tsx                 dashboard and four learning experiences
  learning.ts            adaptive queue, mastery rules, local profiles
  intentModel.ts          ONNX DRAW/MOVE inference
  symbolModel.ts          ONNX 62-class symbol inference
  strokeMatching.ts       ordered-stroke structural validation
public/
  dotted_pngs/            62 dotted character images
  strokes_jsons/          62 ordered tracing definitions
  models/                 browser-ready ONNX models and metadata
  hand_landmarker.task    MediaPipe hand-landmark model
scripts/                  model export and lowercase-asset utilities
```

## Hackathon development disclosure

SkyWrite builds on pre-existing work, and that boundary matters:

**Before the hackathon:** Eva Moughan had a local Python/MediaPipe experiment based on Joey Musante's Apache-2.0 [`mediapipe_gesture_recognition`](https://github.com/jrmusan/mediapipe_gesture_recognition) demo. Eva had also designed the pedagogy and local exercises for Levels 1–3, plus uppercase-letter and number tracing assets.

**During the hackathon:** the project became this deployable React application. New work included the responsive dashboard, browser camera pipeline, web ports and iterative refinements of all guided levels, 26 lowercase manuscript assets, profiles and adaptive scheduling, the volunteer data collector, private-corpus preparation, both custom PyTorch models, ONNX browser inference, the hybrid Level 4 verifier and fallback, and Vercel deployment. The dated commit history in this repository records those milestones during the competition period. The original local prototype files were preserved unchanged.

### Collaboration with Codex and GPT-5.6

Eva made the central product, teaching, and research decisions: using air writing for handwriting practice; preserving ordered school-style strokes; defining each level's feedback and mastery rules; choosing consecutive evidence for progression; designing the data-collection task; recruiting volunteers; and testing the experience repeatedly against the original exercises.

Codex with GPT-5.6 accelerated the implementation by reading the local prototypes and stroke assets, converting them to a React/Vite web app, debugging browser camera behavior, generating the lowercase asset set, building the collector and training/export utilities, integrating both ONNX models, implementing the adaptive learning state, and preparing the Vercel/GitHub release. The collaboration was iterative: when an early web adaptation changed important Level 1 behavior, Eva identified the pedagogical differences and directed the exact timing, start/end, guide, smoothing, stroke-transition, and completion-state corrections.

GPT-5.6 is therefore a development collaborator, not the runtime tutor or recognizer. The deployed app uses local MediaPipe, custom ONNX models, and deterministic scheduling logic; it does not send learner data to GPT-5.6 or any hosted language model.

## Limitations and next steps

- Recognition was trained on a small volunteer pilot corpus and needs broader, age-diverse validation.
- Hand tracking can be affected by lighting, camera placement, background clutter, and device performance.
- Progress is stored in one browser; a consent-aware parent/teacher account system would be needed for cross-device use.
- Future work includes child-centered usability testing, accessibility review, clearer model confidence calibration, and privacy-preserving classroom analytics.

## License and acknowledgments

SkyWrite is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution. Third-party packages and model assets retain their own licenses.

The project uses [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker), [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), [React](https://react.dev/), [Vite](https://vite.dev/), and [Lucide](https://lucide.dev/).
