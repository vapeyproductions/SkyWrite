import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { Point } from './types'

type Metadata = {
  labels: string[]
  imageSize: number
  matchThreshold: number
  marginThreshold: number
  minimumPoints: number
}

export type SymbolAssessment = {
  matched: boolean
  confidence: number
  predicted: string
}

const softmax = (values: number[]) => {
  const maximum = Math.max(...values)
  const exponentials = values.map(value => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return exponentials.map(value => value / total)
}

const rasterize = (strokes: Point[][], size: number) => {
  const points = strokes.flat()
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const low: Point = [Math.min(...xs), Math.min(...ys)], high: Point = [Math.max(...xs), Math.max(...ys)]
  const span: Point = [Math.max(high[0] - low[0], 1e-4), Math.max(high[1] - low[1], 1e-4)]
  const scale = (size - 8) / Math.max(span[0], span[1])
  const center: Point = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2]
  const canvas = new Float32Array(3 * size * size)
  const occupancyOffset = 0, directionXOffset = size * size, directionYOffset = 2 * size * size

  const stamp = (x: number, y: number, dx: number, dy: number) => {
    const ix = Math.round(x), iy = Math.round(y)
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = ix + ox, yy = iy + oy
      if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue
      const index = yy * size + xx, weight = ox === 0 && oy === 0 ? 1 : .45
      canvas[occupancyOffset + index] = Math.max(canvas[occupancyOffset + index], weight)
      canvas[directionXOffset + index] += dx * weight
      canvas[directionYOffset + index] += dy * weight
    }
  }
  for (const stroke of strokes) {
    const normalized = stroke.map(([x, y]) => [(x - center[0]) * scale + (size - 1) / 2, (y - center[1]) * scale + (size - 1) / 2] as Point)
    if (normalized.length === 1) stamp(normalized[0][0], normalized[0][1], 0, 0)
    for (let index = 1; index < normalized.length; index++) {
      const previous = normalized[index - 1], current = normalized[index]
      const delta: Point = [current[0] - previous[0], current[1] - previous[1]]
      const distance = Math.hypot(delta[0], delta[1]), dx = delta[0] / Math.max(distance, 1e-5), dy = delta[1] / Math.max(distance, 1e-5)
      const steps = Math.max(1, Math.ceil(distance * 1.5))
      for (let step = 0; step <= steps; step++) {
        const amount = step / steps
        stamp(previous[0] + delta[0] * amount, previous[1] + delta[1] * amount, dx, dy)
      }
    }
  }
  for (let index = 0; index < size * size; index++) {
    const occupancy = Math.max(canvas[index], 1e-4)
    canvas[directionXOffset + index] = Math.max(-1, Math.min(1, canvas[directionXOffset + index] / occupancy)) * canvas[index]
    canvas[directionYOffset + index] = Math.max(-1, Math.min(1, canvas[directionYOffset + index] / occupancy)) * canvas[index]
  }
  return canvas
}

export class SymbolModel {
  private constructor(private session: ort.InferenceSession, private metadata: Metadata) {}

  static async load() {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
    const [metadataResponse, session] = await Promise.all([
      fetch('/models/symbol_recognizer.json'),
      ort.InferenceSession.create('/models/symbol_recognizer.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }),
    ])
    if (!metadataResponse.ok) throw new Error('Symbol model metadata could not be loaded')
    return new SymbolModel(session, await metadataResponse.json() as Metadata)
  }

  async assess(strokes: Point[][], assigned: string): Promise<SymbolAssessment> {
    const usable = strokes.filter(stroke => stroke.length >= 2)
    const pointCount = usable.reduce((sum, stroke) => sum + stroke.length, 0)
    if (pointCount < this.metadata.minimumPoints) return { matched: false, confidence: 0, predicted: '' }
    const size = this.metadata.imageSize, drawing = rasterize(usable, size)
    const result = await this.session.run({ drawing: new ort.Tensor('float32', drawing, [1, 3, size, size]) })
    const probabilities = softmax(Array.from(result.logits.data as Float32Array))
    const equivalent = this.metadata.labels.map((label, index) => ({ label, index })).filter(item => item.label.toLowerCase() === assigned.toLowerCase())
    const assignedConfidence = Math.max(...equivalent.map(item => probabilities[item.index]))
    const bestEquivalent = equivalent.reduce((best, item) => probabilities[item.index] > probabilities[best.index] ? item : best)
    const competingConfidence = Math.max(...probabilities.filter((_, index) => !equivalent.some(item => item.index === index)))
    const bestIndex = probabilities.indexOf(Math.max(...probabilities))
    return {
      matched: bestEquivalent.index === bestIndex && assignedConfidence >= this.metadata.matchThreshold && assignedConfidence - competingConfidence >= this.metadata.marginThreshold,
      confidence: assignedConfidence,
      predicted: this.metadata.labels[bestIndex],
    }
  }

  async release() { await this.session.release() }
}
