import type { Level } from './types'

const alphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

export const learningSymbols = alphabet.flatMap(letter => [letter, letter.toLowerCase()]).concat([...'0123456789'])

export const masteryRules = {
  1: { required: 3, accuracy: 0.8, label: 'Stay in the path' },
  2: { required: 3, coverage: 0.8, label: 'Cover the dots' },
  3: { required: 5, label: 'Write without hints' },
  4: { required: 3, label: 'Free write without guidance' },
} as const

export type AttemptMetrics = {
  symbol: string
  level: Level
  durationSeconds: number
  pathAccuracy: number
  dotCoverage: number
  hintsUsed: number
  passed: boolean
}

export type SkillProgress = {
  level: Level
  strongStreak: number
  attempts: number
  strongAttempts: number
  lastSeenAt: number
  introducedAt: number
  mastered: boolean
  proofs: Record<Level, number>
}

export type LearnerProfile = {
  version: 2
  id: string
  name: string
  createdAt: number
  updatedAt: number
  totalAttempts: number
  nextSymbolIndex: number
  recentSymbols: string[]
  skills: Record<string, SkillProgress>
}

export type Challenge = { symbol: string; level: Level }

export type AttemptEvaluation = {
  strong: boolean
  fastEnough: boolean
  skillEnough: boolean
  required: number
  achieved: number
  promotedTo?: Level
  masteredNow: boolean
  introducedSymbol?: string
}

const newSkill = (introducedAt: number): SkillProgress => ({
  level: 1,
  strongStreak: 0,
  attempts: 0,
  strongAttempts: 0,
  lastSeenAt: -1,
  introducedAt,
  mastered: false,
  proofs: { 1: 0, 2: 0, 3: 0, 4: 0 },
})

export function createLearnerProfile(name: string, now = Date.now()): LearnerProfile {
  const initialCount = 4
  const skills = Object.fromEntries(learningSymbols.slice(0, initialCount).map(symbol => [symbol, newSkill(0)]))
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${now}-${Math.random().toString(36).slice(2)}`
  return {
    version: 2,
    id: randomId,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    totalAttempts: 0,
    nextSymbolIndex: initialCount,
    recentSymbols: [],
    skills,
  }
}

export function migrateLearnerProfile(value: unknown): LearnerProfile | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as Record<string, unknown>
  if ((saved.version !== 1 && saved.version !== 2) || typeof saved.id !== 'string' || typeof saved.name !== 'string' || typeof saved.totalAttempts !== 'number' || typeof saved.nextSymbolIndex !== 'number' || !saved.skills || typeof saved.skills !== 'object') return null
  const legacy = saved.version === 1
  const skills = Object.fromEntries(Object.entries(saved.skills as Record<string, unknown>).flatMap(([symbol, raw]) => {
    if (!raw || typeof raw !== 'object') return []
    const source = raw as Record<string, unknown>, storedLevel = Number(source.level)
    if (![1, 2, 3, 4].includes(storedLevel)) return []
    const wasLegacyMastered = legacy && source.mastered === true
    const level = (wasLegacyMastered ? 4 : storedLevel) as Level
    const proofs = source.proofs && typeof source.proofs === 'object' ? source.proofs as Record<string, unknown> : {}
    const safeNumber = (candidate: unknown, fallback = 0) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
    const strongStreak = wasLegacyMastered ? 0 : Math.max(0, safeNumber(source.strongStreak))
    const normalizedProofs: Record<Level, number> = {
      1: Math.min(masteryRules[1].required, Math.max(0, safeNumber(proofs[1]))),
      2: Math.min(masteryRules[2].required, Math.max(0, safeNumber(proofs[2]))),
      3: Math.min(masteryRules[3].required, Math.max(0, safeNumber(proofs[3]))),
      4: legacy ? 0 : Math.min(masteryRules[4].required, Math.max(0, safeNumber(proofs[4]))),
    }
    if (legacy && !wasLegacyMastered) normalizedProofs[level] = Math.min(masteryRules[level].required, strongStreak)
    const skill: SkillProgress = {
      level,
      strongStreak,
      attempts: Math.max(0, safeNumber(source.attempts)),
      strongAttempts: Math.max(0, safeNumber(source.strongAttempts)),
      lastSeenAt: safeNumber(source.lastSeenAt, -1),
      introducedAt: Math.max(0, safeNumber(source.introducedAt)),
      mastered: legacy ? false : source.mastered === true,
      proofs: normalizedProofs,
    }
    return [[symbol, skill]]
  })) as Record<string, SkillProgress>
  return {
    version: 2,
    id: saved.id,
    name: saved.name,
    createdAt: typeof saved.createdAt === 'number' ? saved.createdAt : Date.now(),
    updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : Date.now(),
    totalAttempts: Math.max(0, saved.totalAttempts),
    nextSymbolIndex: Math.max(0, Math.min(learningSymbols.length, saved.nextSymbolIndex)),
    recentSymbols: Array.isArray(saved.recentSymbols) ? saved.recentSymbols.filter((item): item is string => typeof item === 'string').slice(-6) : [],
    skills,
  }
}

export function evaluateAttempt(metrics: AttemptMetrics) {
  const fastEnough = metrics.level === 4 || metrics.durationSeconds < 30
  const skillEnough = metrics.level === 1
    ? metrics.pathAccuracy >= masteryRules[1].accuracy
    : metrics.level === 2
      ? metrics.dotCoverage >= masteryRules[2].coverage
      : metrics.hintsUsed === 0
  return { strong: metrics.passed && fastEnough && skillEnough, fastEnough, skillEnough: metrics.passed && skillEnough }
}

export function recordLearningAttempt(profile: LearnerProfile, metrics: AttemptMetrics): { profile: LearnerProfile; evaluation: AttemptEvaluation } {
  const skills = Object.fromEntries(Object.entries(profile.skills).map(([symbol, skill]) => [symbol, { ...skill, proofs: { ...skill.proofs } }])) as Record<string, SkillProgress>
  const skill = skills[metrics.symbol] ?? newSkill(profile.totalAttempts)
  skills[metrics.symbol] = skill
  const measured = evaluateAttempt(metrics)
  const attemptedLevel = skill.level
  const required = masteryRules[attemptedLevel].required

  skill.attempts += 1
  skill.lastSeenAt = profile.totalAttempts + 1
  if (measured.strong) {
    skill.strongAttempts += 1
    skill.strongStreak += 1
    skill.proofs[attemptedLevel] = Math.min(required, skill.proofs[attemptedLevel] + 1)
  } else {
    skill.strongStreak = 0
    skill.proofs[attemptedLevel] = 0
  }

  let promotedTo: Level | undefined
  let masteredNow = false
  if (skill.strongStreak >= required) {
    if (attemptedLevel < 4) {
      promotedTo = (attemptedLevel + 1) as Level
      skill.level = promotedTo
      skill.strongStreak = 0
    } else {
      skill.mastered = true
      skill.strongStreak = required
      masteredNow = true
    }
  }

  const totalAttempts = profile.totalAttempts + 1
  let nextSymbolIndex = profile.nextSymbolIndex
  let introducedSymbol: string | undefined
  const levelOneCohort = Object.values(skills).filter(item => !item.mastered && item.level === 1).length
  if (totalAttempts % 5 === 0 && nextSymbolIndex < learningSymbols.length && levelOneCohort < 6) {
    introducedSymbol = learningSymbols[nextSymbolIndex]
    skills[introducedSymbol] = newSkill(totalAttempts)
    nextSymbolIndex += 1
  }

  const nextProfile: LearnerProfile = {
    ...profile,
    updatedAt: Date.now(),
    totalAttempts,
    nextSymbolIndex,
    recentSymbols: [...profile.recentSymbols, metrics.symbol].slice(-6),
    skills,
  }

  return {
    profile: nextProfile,
    evaluation: {
      ...measured,
      required,
      achieved: skill.strongStreak,
      promotedTo,
      masteredNow,
      introducedSymbol,
    },
  }
}

export function chooseNextChallenge(profile: LearnerProfile): Challenge {
  const candidates = learningSymbols
    .map((symbol, order) => ({ symbol, order, skill: profile.skills[symbol] }))
    .filter((item): item is { symbol: string; order: number; skill: SkillProgress } => !!item.skill && !item.skill.mastered)

  if (!candidates.length) return { symbol: learningSymbols[0], level: 4 }

  const recent = new Set(profile.recentSymbols.slice(-2))
  const spaced = candidates.filter(item => !recent.has(item.symbol))
  const pool = spaced.length ? spaced : candidates
  const ranked = pool.map(item => {
    const age = item.skill.lastSeenAt < 0 ? profile.totalAttempts + 3 : profile.totalAttempts - item.skill.lastSeenAt
    const remaining = masteryRules[item.skill.level].required - item.skill.strongStreak
    const score = age * 5 + (item.skill.attempts === 0 ? 55 : 0) + remaining * 2 + (item.skill.level - 1) * 6
    return { ...item, score }
  }).sort((a, b) => b.score - a.score || a.order - b.order)

  return { symbol: ranked[0].symbol, level: ranked[0].skill.level }
}

export function profileSummary(profile: LearnerProfile | null) {
  if (!profile) return { mastered: 0, introduced: 0, percent: 0 }
  const skills = Object.values(profile.skills)
  const mastered = skills.filter(skill => skill.mastered).length
  const proofs = skills.reduce((sum, skill) => sum + skill.proofs[1] + skill.proofs[2] + skill.proofs[3] + skill.proofs[4], 0)
  const totalProofs = learningSymbols.length * (masteryRules[1].required + masteryRules[2].required + masteryRules[3].required + masteryRules[4].required)
  return { mastered, introduced: skills.length, percent: Math.round(proofs / totalProofs * 100) }
}

export function skillLabel(skill?: SkillProgress) {
  if (!skill) return 'Not introduced yet'
  if (skill.mastered) return 'Mastered'
  return `Level ${skill.level} · ${skill.strongStreak} of ${masteryRules[skill.level].required} strong tries`
}
