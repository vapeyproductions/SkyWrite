export type Point = [number, number]
export type Stroke = { name: string; points: Point[] }
export type StrokeData = { image: string; strokes: Stroke[] }
export type Level = 1 | 2 | 3 | 4
