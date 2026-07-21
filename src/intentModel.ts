import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { Point } from './types'

type Landmark = { x: number; y: number; z?: number }
type Metadata = {
  featureCount: number
  windowSize: number
  featureMean: number[]
  featureStd: number[]
  startThreshold: number
  stopThreshold: number
  startFrames: number
  stopFrames: number
  displayDelayMs: number
}
export type DelayedIntentPoint = { point: Point; drawing: boolean; confidence: number }

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value))

export class IntentModel {
  private history: number[][] = []
  private delayed: Array<{ at: number; point: Point; drawing: boolean; confidence: number }> = []
  private previousTip: [number, number, number] | null = null
  private previousTime: number | null = null
  private drawing = false
  private startCount = 0
  private stopCount = 0

  private constructor(
    private session: ort.InferenceSession,
    private metadata: Metadata,
  ) {}

  static async load() {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
    const [metadataResponse, session] = await Promise.all([
      fetch('/models/pen_intent.json'),
      ort.InferenceSession.create('/models/pen_intent.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }),
    ])
    if (!metadataResponse.ok) throw new Error('Intent model metadata could not be loaded')
    return new IntentModel(session, await metadataResponse.json() as Metadata)
  }

  reset() {
    this.history = []
    this.delayed = []
    this.previousTip = null
    this.previousTime = null
    this.drawing = false
    this.startCount = 0
    this.stopCount = 0
  }

  async release() {
    await this.session.release()
  }

  private extractFeatures(hand: Landmark[], timestamp: number) {
    const wrist = hand[0]
    const palm = hand[9]
    const palmScale = Math.max(1e-4, Math.hypot(
      palm.x - wrist.x,
      palm.y - wrist.y,
      (palm.z ?? 0) - (wrist.z ?? 0),
    ))
    const features: number[] = []
    for (const landmark of hand) {
      features.push(
        (landmark.x - wrist.x) / palmScale,
        (landmark.y - wrist.y) / palmScale,
        ((landmark.z ?? 0) - (wrist.z ?? 0)) / palmScale,
      )
    }
    const tip: [number, number, number] = [hand[8].x, hand[8].y, hand[8].z ?? 0]
    const dt = this.previousTime === null ? 0 : Math.max((timestamp - this.previousTime) / 1000, .001)
    const velocity: [number, number, number] = this.previousTip && dt
      ? [(tip[0] - this.previousTip[0]) / dt, (tip[1] - this.previousTip[1]) / dt, (tip[2] - this.previousTip[2]) / dt]
      : [0, 0, 0]
    features.push(...tip, ...velocity, Math.hypot(...velocity))
    this.previousTip = tip
    this.previousTime = timestamp
    return features.map((value, index) =>
      (value - this.metadata.featureMean[index]) / Math.max(this.metadata.featureStd[index], 1e-5)
    )
  }

  async process(hand: Landmark[], point: Point, fallbackDrawing: boolean, timestamp: number) {
    this.history.push(this.extractFeatures(hand, timestamp))
    if (this.history.length > this.metadata.windowSize) this.history.shift()
    let confidence = fallbackDrawing ? 1 : 0
    if (this.history.length === this.metadata.windowSize) {
      const input = new Float32Array(this.history.flat())
      const result = await this.session.run({
        features: new ort.Tensor('float32', input, [1, this.metadata.windowSize, this.metadata.featureCount]),
      })
      confidence = sigmoid(Number(result.logit.data[0]))
      if (this.drawing) {
        this.stopCount = confidence <= this.metadata.stopThreshold ? this.stopCount + 1 : 0
        if (this.stopCount >= this.metadata.stopFrames) {
          this.drawing = false
          this.stopCount = 0
        }
      } else {
        this.startCount = confidence >= this.metadata.startThreshold ? this.startCount + 1 : 0
        if (this.startCount >= this.metadata.startFrames) {
          this.drawing = true
          this.startCount = 0
        }
      }
    } else {
      this.drawing = fallbackDrawing
    }
    this.delayed.push({ at: timestamp, point, drawing: this.drawing, confidence })
    const ready: DelayedIntentPoint[] = []
    while (this.delayed.length && timestamp - this.delayed[0].at >= this.metadata.displayDelayMs) {
      const { point: delayedPoint, drawing, confidence: delayedConfidence } = this.delayed.shift()!
      ready.push({ point: delayedPoint, drawing, confidence: delayedConfidence })
    }
    return ready
  }
}
