import type { Point, StrokeData } from './types'

export const strokePathLength = (stroke: Point[]) => stroke.slice(1).reduce(
  (sum, point, index) => sum + Math.hypot(point[0] - stroke[index][0], point[1] - stroke[index][1]), 0,
)

export function trimStartupNoise(stroke: Point[], symbol: string, minimum: number) {
  const target = symbol === 'I' ? 'vertical' : symbol.toLowerCase() === 'c' ? 'curve' : null
  if (!target) return stroke
  if (stroke.length < 7) return []
  for (let index = 0; index <= stroke.length - 5; index++) {
    const start = stroke[index], end = stroke[index + 4], dx = end[0] - start[0], dy = end[1] - start[1]
    const aligned = target === 'vertical'
      ? dy >= minimum * .025 && Math.abs(dx) <= Math.abs(dy) * .42
      : dx <= -minimum * .018 && Math.abs(dy) <= Math.abs(dx) * 1.3
    if (aligned) return stroke.slice(index)
  }
  return []
}

const resample = (points: Point[], count = 32) => {
  if (points.length < 2) return points
  const cumulative = [0]
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative.at(-1)! + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]))
  const total = cumulative.at(-1)!
  if (!total) return Array.from({ length: count }, () => points[0])
  return Array.from({ length: count }, (_, sample) => {
    const distance = total * sample / (count - 1)
    let index = 1
    while (index < cumulative.length - 1 && cumulative[index] < distance) index++
    const segment = Math.max(cumulative[index] - cumulative[index - 1], 1e-6), amount = (distance - cumulative[index - 1]) / segment
    return [points[index - 1][0] + (points[index][0] - points[index - 1][0]) * amount, points[index - 1][1] + (points[index][1] - points[index - 1][1]) * amount] as Point
  })
}

const normalize = (strokes: Point[][]) => {
  const points = strokes.flat(), xs = points.map(point => point[0]), ys = points.map(point => point[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const scale = Math.max(maxX - minX, maxY - minY, 1e-5), centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
  return strokes.map(stroke => stroke.map(point => [(point[0] - centerX) / scale, (point[1] - centerY) / scale] as Point))
}

export function structuralAssessment(strokes: Point[][], reference: StrokeData | null, symbol: string, minimum: number) {
  if (!reference) return { cleaned: strokes, score: 0, complete: false, substantialExtra: false }
  const trimmed = strokes.map(stroke => trimStartupNoise(stroke, symbol, minimum)).filter(stroke => stroke.length >= 2)
  const lengths = trimmed.map(strokePathLength), total = lengths.reduce((sum, length) => sum + length, 0)
  const threshold = Math.max(minimum * .018, total * .045)
  let cleaned = trimmed.filter((_, index) => lengths[index] >= threshold || ((symbol === 'i' || symbol === 'j') && index > 0))
  const expected = reference.strokes.length
  if (expected === 1 && cleaned.length > 1) {
    const all = cleaned.flat(), xs = all.map(point => point[0]), ys = all.map(point => point[1]), diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    let gaps = 0
    for (let index = 1; index < cleaned.length; index++) gaps += Math.hypot(cleaned[index][0][0] - cleaned[index - 1].at(-1)![0], cleaned[index][0][1] - cleaned[index - 1].at(-1)![1])
    if (gaps <= diagonal * .35) cleaned = [cleaned.flat()]
    else {
      const ranked = cleaned.map(stroke => ({ stroke, length: strokePathLength(stroke) })).sort((a, b) => b.length - a.length)
      if (ranked.slice(1).reduce((sum, item) => sum + item.length, 0) <= ranked[0].length * .15) cleaned = [ranked[0].stroke]
    }
  }
  if (cleaned.length !== expected) return { cleaned, score: 0, complete: false, substantialExtra: cleaned.length > expected }
  const normalizedUser = normalize(cleaned), normalizedReference = normalize(reference.strokes.map(stroke => stroke.points))
  let distance = 0, comparisons = 0
  normalizedUser.forEach((stroke, index) => {
    const user = resample(stroke), guide = resample(normalizedReference[index])
    for (let point = 0; point < Math.min(user.length, guide.length); point++) {
      distance += Math.hypot(user[point][0] - guide[point][0], user[point][1] - guide[point][1]); comparisons++
    }
  })
  let score = Math.exp(-(distance / Math.max(comparisons, 1)) * 4.2)
  if (symbol === 'I') {
    const points = cleaned[0], xs = points.map(point => point[0]), ys = points.map(point => point[1]), width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys)
    const vertical = points.at(-1)![1] > points[0][1] && width / Math.max(height, 1) <= .28
    if (!vertical) score = 0
  }
  if (symbol.toLowerCase() === 'c') {
    const points = normalizedUser[0], start = points[0], end = points.at(-1)!, left = Math.min(...points.map(point => point[0]))
    const openOnRight = start[0] > left + .20 && end[0] > left + .20 && Math.max(start[0], end[0]) > left + .30 && Math.hypot(start[0] - end[0], start[1] - end[1]) >= .18
    if (!openOnRight) score = 0
  }
  return { cleaned, score, complete: true, substantialExtra: false }
}
