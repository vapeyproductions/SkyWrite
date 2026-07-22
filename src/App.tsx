import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowLeft, Camera, Check, ChevronRight, Crown, Hand, LockKeyhole, MousePointer2, RotateCcw, Sparkles, Star, Trophy, UserRound, X } from 'lucide-react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Level, Point, StrokeData } from './types'
import { chooseNextChallenge, createLearnerProfile, learningSymbols, masteryRules, migrateLearnerProfile, profileSummary, recordLearningAttempt, skillLabel } from './learning'
import type { AttemptEvaluation, AttemptMetrics, Challenge, LearnerProfile } from './learning'
import { IntentModel } from './intentModel'
import { SymbolModel } from './symbolModel'
import { structuralAssessment, strokePathLength, trimStartupNoise } from './strokeMatching'

const strokeAssetName = (symbol: string) => /[a-z]/.test(symbol) ? `lower_${symbol}` : symbol
type PracticeLevel = Level
const levelInfo = {
  1: { title: 'Follow the trail', detail: 'A safe path, start points, and a friendly guide', color: '#6c56df' },
  2: { title: 'Follow the guide', detail: 'Keep up with the glowing guide dot', color: '#e56f9e' },
  3: { title: 'Sky writer', detail: 'Write from memory—hints appear if you need them', color: '#30a992' },
  4: { title: 'Free write', detail: 'Write independently—help appears only after 30 seconds', color: '#ee8a3a' },
} satisfies Record<PracticeLevel, { title: string; detail: string; color: string }>
type SessionMode = 'learning' | 'practice'
type CompletionFeedback = {
  mode: SessionMode
  headline: string
  detail: string
  next: Challenge
  evaluation?: AttemptEvaluation
}

const PROFILE_KEY = 'skywrite-learner-profile-v1'
const readProfile = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')
    const migrated = migrateLearnerProfile(saved)
    if (migrated && saved?.version !== migrated.version) localStorage.setItem(PROFILE_KEY, JSON.stringify(migrated))
    return migrated
  } catch { return null }
}
const saveProfile = (profile: LearnerProfile) => {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)) }
  catch (error) { console.error('SkyWrite could not save this learner profile.', error) }
}
const randomPracticeSymbol = (exclude = '') => {
  const pool = learningSymbols.filter(symbol => symbol !== exclude)
  return pool[Math.floor(Math.random() * pool.length)] ?? learningSymbols[0]
}

function polylineMetrics(points: Point[]) {
  const lengths=points.slice(0,-1).map((point,index)=>Math.hypot(points[index+1][0]-point[0],points[index+1][1]-point[1]))
  const cumulative=[0]
  lengths.forEach(length=>cumulative.push(cumulative.at(-1)!+length))
  return {lengths,cumulative,total:cumulative.at(-1)!}
}

function pointAtDistance(points: Point[], lengths: number[], cumulative: number[], target: number): Point {
  const distance=Math.max(0,Math.min(target,cumulative.at(-1)!))
  const found=cumulative.findIndex(value=>value>distance)
  const index=found===-1?lengths.length-1:Math.max(0,found-1)
  if(lengths[index]===0) return [...points[index]]
  const amount=(distance-cumulative[index])/lengths[index]
  return [points[index][0]+amount*(points[index+1][0]-points[index][0]),points[index][1]+amount*(points[index+1][1]-points[index][1])]
}

function nearestProgress(point: Point, points: Point[], lengths: number[], cumulative: number[], minimum: number, maximum: number) {
  let bestDistance=Infinity, bestProgress=minimum
  lengths.forEach((length,index)=>{
    if(!length||cumulative[index+1]<minimum||cumulative[index]>maximum) return
    const ax=points[index][0], ay=points[index][1], vx=points[index+1][0]-ax, vy=points[index+1][1]-ay
    const amount=Math.max(0,Math.min(1,((point[0]-ax)*vx+(point[1]-ay)*vy)/(length*length)))
    const progress=cumulative[index]+amount*length
    if(progress<minimum||progress>maximum) return
    const distance=Math.hypot(point[0]-(ax+amount*vx),point[1]-(ay+amount*vy))
    if(distance<bestDistance){bestDistance=distance;bestProgress=progress}
  })
  return {distance:bestDistance,progress:bestProgress}
}

function isPointingHand(hand: Array<{x:number;y:number}>) {
  const inside=(index:number)=>hand[index]&&hand[index].x>=0&&hand[index].x<=1&&hand[index].y>=0&&hand[index].y<=1
  if(!inside(8)||hand[8].y>=hand[6].y) return false
  return ([[10,12],[14,16],[18,20]] as const).every(([pip,tip])=>!inside(pip)||!inside(tip)||hand[tip].y>hand[pip].y)
}

function freeWriteStats(strokes: Point[][], width: number, height: number) {
  const usable = strokes.filter(stroke => stroke.length >= 2), points = usable.flat(), minimum = Math.min(width, height)
  if (!points.length || !width || !height) return { coverage: 0, pathLength: 0, width: 0, height: 0, strokeCount: 0 }
  const columns = 80, rows = 50, occupied = new Set<number>(), radius = Math.max(1, Math.round(12 / width * columns))
  const stamp = (point: Point) => {
    const x = Math.round(point[0] / width * (columns - 1)), y = Math.round(point[1] / height * (rows - 1))
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      const xx = x + ox, yy = y + oy
      if (xx >= 0 && xx < columns && yy >= 0 && yy < rows && ox * ox + oy * oy <= radius * radius) occupied.add(yy * columns + xx)
    }
  }
  let pathLength = 0
  usable.forEach(stroke => stroke.forEach((point, index) => {
    if (index) {
      const previous = stroke[index - 1], distance = Math.hypot(point[0] - previous[0], point[1] - previous[1])
      pathLength += distance
      const steps = Math.max(1, Math.ceil(distance / Math.max(3, minimum / 120)))
      for (let step = 0; step <= steps; step++) stamp([previous[0] + (point[0] - previous[0]) * step / steps, previous[1] + (point[1] - previous[1]) * step / steps])
    } else stamp(point)
  }))
  const xs = points.map(point => point[0]), ys = points.map(point => point[1])
  return { coverage: occupied.size / (columns * rows), pathLength, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), strokeCount: usable.length }
}

function looksLikeZero(strokes: Point[][], canvasWidth: number, canvasHeight: number) {
  const usable = strokes.filter(stroke => stroke.length >= 3)
  if (!usable.length || usable.length > 5) return false
  const loop = usable.flat(), xs = loop.map(point => point[0]), ys = loop.map(point => point[1])
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys), diagonal = Math.hypot(width, height)
  let disconnectedDistance = 0
  for (let index = 1; index < usable.length; index++) disconnectedDistance += Math.hypot(usable[index][0][0] - usable[index - 1].at(-1)![0], usable[index][0][1] - usable[index - 1].at(-1)![1])
  if (disconnectedDistance > diagonal * .45) return false
  const closure = Math.hypot(loop[0][0] - loop.at(-1)![0], loop[0][1] - loop.at(-1)![1]) / Math.max(diagonal, 1)
  let length = 0
  for (let index = 1; index < loop.length; index++) length += Math.hypot(loop[index][0] - loop[index - 1][0], loop[index][1] - loop[index - 1][1])
  const perimeter = Math.PI * Math.sqrt(2 * (width * width / 4 + height * height / 4))
  return height >= Math.min(canvasWidth, canvasHeight) * .20 && width / Math.max(height, 1) >= .25 && width / Math.max(height, 1) <= .95 && closure <= .38 && length / Math.max(perimeter, 1) >= .65 && length / Math.max(perimeter, 1) <= 1.90
}

function StrokePreview({ points }: { points: Point[] }) {
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys)
  const width=Math.max(maxX-minX,.001),height=Math.max(maxY-minY,.001),scale=Math.min(82/width,34/height)
  const offsetX=15+(82-width*scale)/2-minX*scale,offsetY=15+(34-height*scale)/2-minY*scale
  const preview=points.map(([x,y])=>[x*scale+offsetX,y*scale+offsetY] as Point)
  const path=preview.map(([x,y],index)=>`${index?'L':'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const metrics=polylineMetrics(preview)
  const arrowCandidates=metrics.total>80?[.33,.66,1]:metrics.total>38?[.5,1]:[1]
  const candidatePositions=arrowCandidates.map(fraction=>pointAtDistance(preview,metrics.lengths,metrics.cumulative,metrics.total*fraction))
  const arrowFractions=arrowCandidates.filter((_,index)=>index===arrowCandidates.length-1||candidatePositions.slice(index+1).every(position=>Math.hypot(candidatePositions[index][0]-position[0],candidatePositions[index][1]-position[1])>=18))
  const arrows=arrowFractions.map((fraction,index)=>{
    const distance=metrics.total*fraction,position=pointAtDistance(preview,metrics.lengths,metrics.cumulative,distance)
    const before=pointAtDistance(preview,metrics.lengths,metrics.cumulative,Math.max(0,distance-7))
    const after=pointAtDistance(preview,metrics.lengths,metrics.cumulative,Math.min(metrics.total,distance+7))
    const angle=Math.atan2(after[1]-before[1],after[0]-before[0])*180/Math.PI
    return <path className="stroke-preview-arrow" d="M 3 0 L -8 -4.5 L -6 0 L -8 4.5 Z" transform={`translate(${position[0].toFixed(2)} ${position[1].toFixed(2)}) rotate(${angle.toFixed(2)})`} key={`${fraction}-${index}`}/>
  })
  return <svg className="stroke-preview" viewBox="0 0 112 64" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path className="stroke-preview-path" d={path}/>
    {arrows}
    <circle className="stroke-preview-start" cx={preview[0][0]} cy={preview[0][1]} r="4"/>
  </svg>
}

export function App() {
  const [route, setRoute] = useState<'dashboard' | 'practice'>('dashboard')
  const [sessionMode, setSessionMode] = useState<SessionMode>('learning')
  const [challenge, setChallenge] = useState<Challenge>({ symbol: 'A', level: 1 })
  const [challengeId, setChallengeId] = useState(0)
  const [profile, setProfile] = useState<LearnerProfile | null>(readProfile)
  const profileRef = useRef<LearnerProfile | null>(profile)
  const [profileOpen, setProfileOpen] = useState(false)
  const [startAfterProfile, setStartAfterProfile] = useState(false)
  const [draftName, setDraftName] = useState(profile?.name ?? '')

  const launchLearning = (learner: LearnerProfile) => {
    setSessionMode('learning')
    setChallenge(chooseNextChallenge(learner))
    setChallengeId(value => value + 1)
    setRoute('practice')
  }
  const requestLearning = () => {
    if (profile) launchLearning(profile)
    else {
      setDraftName('')
      setStartAfterProfile(true)
      setProfileOpen(true)
    }
  }
  const startPractice = (level: PracticeLevel) => {
    setSessionMode('practice')
    setChallenge({ symbol: randomPracticeSymbol(), level })
    setChallengeId(value => value + 1)
    setRoute('practice')
  }
  const openProfile = () => {
    setDraftName(profile?.name ?? '')
    setStartAfterProfile(false)
    setProfileOpen(true)
  }
  const submitProfile = (event: FormEvent) => {
    event.preventDefault()
    if (!draftName.trim()) return
    const learner = profile ? { ...profile, name: draftName.trim(), updatedAt: Date.now() } : createLearnerProfile(draftName)
    saveProfile(learner)
    profileRef.current = learner
    setProfile(learner)
    setProfileOpen(false)
    if (startAfterProfile) launchLearning(learner)
    setStartAfterProfile(false)
  }
  const completeAttempt = useCallback((metrics: AttemptMetrics): CompletionFeedback => {
    const learner = profileRef.current
    if (sessionMode === 'learning' && learner) {
      const recorded = recordLearningAttempt(learner, metrics)
      saveProfile(recorded.profile)
      profileRef.current = recorded.profile
      setProfile(recorded.profile)
      const next = chooseNextChallenge(recorded.profile)
      const evaluation = recorded.evaluation
      const skill = recorded.profile.skills[metrics.symbol]
      const headline = evaluation.masteredNow
        ? `${metrics.symbol} is mastered!`
        : evaluation.promotedTo
          ? `${metrics.symbol} reached Level ${evaluation.promotedTo}!`
          : evaluation.strong
            ? `Strong sky writing!`
            : `Good practice—keep growing!`
      const detail = evaluation.masteredNow
        ? `All three independent free-writing checks are complete.`
        : evaluation.promotedTo
          ? evaluation.promotedTo === 4
            ? `The next ${metrics.symbol} challenge will be free writing with no help.`
            : `The next ${metrics.symbol} challenge will use less guidance.`
          : evaluation.strong
            ? `${skill.strongStreak} of ${masteryRules[skill.level].required} strong tries at Level ${skill.level}.`
            : `SkyWrite will bring ${metrics.symbol} back soon for another try.`
      return { mode: 'learning', headline, detail, next, evaluation }
    }
    return {
      mode: 'practice',
      headline: 'Practice complete!',
      detail: 'Free practice does not change the learner mastery path.',
      next: { symbol: randomPracticeSymbol(metrics.symbol), level: metrics.level },
    }
  }, [sessionMode])
  const nextChallenge = (next: Challenge) => {
    setChallenge(next)
    setChallengeId(value => value + 1)
  }
  const dashboardNext = profile ? chooseNextChallenge(profile) : { symbol: 'A', level: 1 as Level }

  return route === 'dashboard'
    ? <><Dashboard profile={profile} next={dashboardNext} onStartLearning={requestLearning} onPractice={startPractice} onOpenProfile={openProfile}/><ProfileDialog open={profileOpen} profile={profile} name={draftName} setName={setDraftName} startAfterCreate={startAfterProfile} onSubmit={submitProfile} onClose={() => { setProfileOpen(false); setStartAfterProfile(false) }}/></>
    : challenge.level === 4
      ? <FreeWritePractice symbol={challenge.symbol} challengeId={challengeId} sessionMode={sessionMode} masteredCount={profileSummary(profile).mastered} goBack={() => setRoute('dashboard')} onComplete={completeAttempt} onNext={nextChallenge} />
      : <Practice challengeId={challengeId} level={challenge.level} symbol={challenge.symbol} sessionMode={sessionMode} masteredCount={profileSummary(profile).mastered} goBack={() => setRoute('dashboard')} onComplete={completeAttempt} onNext={nextChallenge} />
}

function Dashboard({ profile, next, onStartLearning, onPractice, onOpenProfile }: { profile: LearnerProfile | null; next: Challenge; onStartLearning: () => void; onPractice: (level: PracticeLevel) => void; onOpenProfile: () => void }) {
  const summary = profileSummary(profile)
  const initials = profile?.name.trim().slice(0, 2).toUpperCase() || ''
  return <main className="shell">
    <nav className="topbar"><a className="brand" href="#"><span className="brand-mark"><Sparkles size={22}/></span><span>SkyWrite</span></a><button className={`profile-button ${profile ? 'has-profile' : ''}`} onClick={onOpenProfile}>{profile ? <span className="avatar">{initials}</span> : <span className="avatar empty"><UserRound size={20}/></span>}<span><b>{profile?.name ?? 'Create profile'}</b><small>{profile ? 'Saved on this device' : 'First-time setup'}</small></span></button></nav>
    <section className="hero"><div><p className="eyebrow">YOUR LEARNING PATH</p><h1>Little steps.<br/><em>Big sky writing.</em></h1><p>Meet a few letters at a time, revisit them often, and grow from guided tracing to writing from memory.</p><button className="primary" onClick={onStartLearning}><Hand size={20}/> Start Learning<ChevronRight size={20}/></button><p className="profile-note">{profile ? `Up next for ${profile.name}: ${next.symbol} at Level ${next.level}` : 'First time? Enter one learner name to create a profile.'}</p></div><div className="hero-art" aria-hidden="true"><span className="orbit o1">★</span><span className="orbit o2">✦</span><span className="orbit o3">●</span><div className="letter-card">{next.symbol}<span className="trace-dot d1"/><span className="trace-dot d2"/><span className="trace-dot d3"/></div></div></section>
    <section className="stats"><div><span className="stat-icon purple"><Trophy/></span><p><b>{summary.mastered} / 62</b><small>Characters mastered</small></p></div><div><span className="stat-icon pink"><Star/></span><p><b>{summary.percent}%</b><small>Mastery journey</small></p></div><div><span className="stat-icon green">Aa</span><p><b>{summary.introduced}</b><small>Characters introduced</small></p></div></section>
    <section className="content">
      <div className="section-head"><div><p className="eyebrow">HOW LEARNING GROWS</p><h2>A small, smart rotation</h2></div><span className="tiny-note">Progress saves after every letter</span></div>
      <div className="mastery-roadmap">{([1,2,3,4] as Level[]).map(level => <div className="roadmap-step" key={level} style={{'--accent': levelInfo[level].color} as React.CSSProperties}><span>{level}</span><div><b>{levelInfo[level].title}</b><small>{level === 1 ? 'Under 30 sec · 80% in the path · 3 in a row' : level === 2 ? 'Under 30 sec · 80% dot coverage · 3 in a row' : level === 3 ? 'Under 30 sec · no hints · 5 in a row' : 'No tracing reminder · 3 in a row'}</small></div></div>)}</div>
      <div className="section-head practice-heading"><div><p className="eyebrow">JUST FOR PRACTICE</p><h2>Choose one level</h2></div><span className="tiny-note">Random letters · does not change mastery</span></div>
      <div className="level-grid">{([1,2,3,4] as PracticeLevel[]).map((l, i) => <button className="level-card" style={{'--accent': levelInfo[l].color} as React.CSSProperties} key={l} onClick={() => onPractice(l)}><span className="level-number">{l}</span><div className="level-visual">{i === 0 ? 'A···' : i === 1 ? 'a  ●' : i === 2 ? 'B  ✦' : 'R  ☝'}</div><h3>{levelInfo[l].title}</h3><p>{levelInfo[l].detail}</p><span className="card-link">Practice random letters<ChevronRight size={18}/></span></button>)}</div>
      <div className="section-head alphabet-head"><div><p className="eyebrow">THE 62-SKILL JOURNEY</p><h2>Alphabet & number progress</h2></div><span className="progress-legend"><span>★ Level</span><span><Crown size={14}/> Mastered</span></span></div>
      <div className="symbol-grid progress-grid">{learningSymbols.map(symbol => {const skill=profile?.skills[symbol],shownLevel=skill ? skill.level : 0;return <div className={`symbol-progress ${skill?'introduced':''} ${skill?.mastered?'mastered':''}`} key={symbol} title={skillLabel(skill)} aria-label={`${symbol}: ${skillLabel(skill)}`}><b>{symbol}</b>{skill?.mastered?<Crown size={15}/>:<span className="skill-stars">{[1,2,3,4].map(star=><span className={star<=shownLevel?'filled':''} key={star}>★</span>)}</span>}</div>})}</div>
    </section><footer>Made with wonder for growing writers <span>✦</span></footer>
  </main>
}

function ProfileDialog({ open, profile, name, setName, startAfterCreate, onSubmit, onClose }: { open: boolean; profile: LearnerProfile | null; name: string; setName: (name: string) => void; startAfterCreate: boolean; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  if (!open) return null
  const summary = profileSummary(profile)
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title"><button className="dialog-close" onClick={onClose} aria-label="Close profile"><X/></button><span className="dialog-icon"><UserRound/></span><p className="eyebrow">LEARNER PROFILE</p><h2 id="profile-title">{profile ? `${profile.name}'s learning path` : 'Who is learning today?'}</h2><p>{profile ? 'Update the learner name or continue the saved path.' : 'Enter a first name or nickname. No email or password is needed.'}</p>{profile&&<div className="profile-summary"><span><b>{summary.mastered}</b> mastered</span><span><b>{summary.percent}%</b> complete</span></div>}<form onSubmit={onSubmit}><label htmlFor="learner-name">Learner name</label><input id="learner-name" value={name} onChange={event => setName(event.target.value)} maxLength={24} autoFocus placeholder="First name or nickname"/><button className="primary" disabled={!name.trim()}>{profile ? 'Save profile' : startAfterCreate ? 'Create & start learning' : 'Create profile'}<ChevronRight size={18}/></button></form><p className="device-note"><LockKeyhole size={15}/> Progress is private and saved in this browser on this device.</p></section></div>
}

function FreeWritePractice({ symbol, challengeId, sessionMode, masteredCount, goBack, onComplete, onNext }: { symbol: string; challengeId: number; sessionMode: SessionMode; masteredCount: number; goBack: () => void; onComplete: (metrics: AttemptMetrics) => CompletionFeedback; onNext: (challenge: Challenge) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarker = useRef<HandLandmarker | null>(null), intentModel = useRef<IntentModel | null>(null), symbolModel = useRef<SymbolModel | null>(null)
  const raf = useRef(0), intentQueue = useRef<Promise<void>>(Promise.resolve())
  const strokes = useRef<Point[][]>([]), activeStroke = useRef<Point[]>([]), smoothedPoint = useRef<Point | null>(null)
  const hasInk = useRef(false), passed = useRef(false), recognitionBusy = useRef(false), lastRecognitionAt = useRef(0), lastMeaningfulAt = useRef(performance.now()), advanceTimer = useRef<number | null>(null)
  const expectedStrokeCount = useRef(1), repositionGuard = useRef<{ active: boolean; samples: Point[] }>({ active: false, samples: [] }), coverageCheckAt = useRef(0)
  const referenceData = useRef<StrokeData | null>(null), cameraOnRef = useRef(false), taskStartedAt = useRef<number | null>(null), drawingRevision = useRef(0)
  const guidanceShownRef = useRef(false), guidanceFailureRecorded = useRef(false), guidedNext = useRef<Challenge | null>(null)
  const guidanceStrokeIndex = useRef(0), guidanceProgress = useRef(0), guidanceTraceState = useRef<'WAITING' | 'TRACING' | 'TRANSITION' | 'COMPLETE'>('WAITING')
  const guidanceTrace = useRef<Point[]>([]), guidanceCompletedTraces = useRef<Point[][]>([]), guidancePreviousPoint = useRef<Point | null>(null), guidanceTransitionTimer = useRef<number | null>(null)
  const [cameraOn, setCameraOn] = useState(false), [cameraStarting, setCameraStarting] = useState(false), [guidanceShown, setGuidanceShown] = useState(false)
  const [reference, setReference] = useState<StrokeData | null>(null)
  const [guidedStrokeIndex, setGuidedStrokeIndex] = useState(0), [guidedTransitioning, setGuidedTransitioning] = useState(false), [guidedComplete, setGuidedComplete] = useState(false)
  const [message, setMessage] = useState('Turn on air writing, then write the character shown at left.')

  const finishStroke = useCallback(() => {
    const box = canvasRef.current?.getBoundingClientRect(), minimum = box ? Math.min(box.width, box.height) : 600
    const prepared = trimStartupNoise(activeStroke.current, symbol, minimum), isExpectedDot = (symbol === 'i' || symbol === 'j') && strokes.current.length === 1
    if (prepared.length >= 3 && (strokePathLength(prepared) >= minimum * .02 || isExpectedDot)) strokes.current.push([...prepared])
    activeStroke.current = []
  }, [symbol])

  const clearDrawing = useCallback(() => {
    drawingRevision.current += 1
    strokes.current = []
    activeStroke.current = []
    smoothedPoint.current = null
    intentModel.current?.reset()
    repositionGuard.current = { active: false, samples: [] }
    coverageCheckAt.current = 0
    lastRecognitionAt.current = 0
    guidanceStrokeIndex.current = 0
    guidanceProgress.current = 0
    guidanceTraceState.current = 'WAITING'
    guidanceTrace.current = []
    guidanceCompletedTraces.current = []
    guidancePreviousPoint.current = null
    if (guidanceTransitionTimer.current !== null) { window.clearTimeout(guidanceTransitionTimer.current); guidanceTransitionTimer.current = null }
    setGuidedStrokeIndex(0)
    setGuidedTransitioning(false)
    setGuidedComplete(false)
    hasInk.current = false
    passed.current = false
    recognitionBusy.current = false
    lastMeaningfulAt.current = performance.now()
    if (advanceTimer.current !== null) { window.clearTimeout(advanceTimer.current); advanceTimer.current = null }
  }, [])

  const attemptMetrics = useCallback((didPass: boolean, hintsUsed: number): AttemptMetrics => ({
    symbol,
    level: 4,
    durationSeconds: taskStartedAt.current === null ? 0 : (performance.now() - taskStartedAt.current) / 1000,
    pathAccuracy: 0,
    dotCoverage: 0,
    hintsUsed,
    passed: didPass,
  }), [symbol])

  const recordFailure = useCallback(() => {
    if (sessionMode !== 'learning') return null
    return onComplete(attemptMetrics(false, guidanceShownRef.current ? 1 : 0))
  }, [attemptMetrics, onComplete, sessionMode])

  const resetFailedDrawing = useCallback((reason: string) => {
    recordFailure()
    clearDrawing()
    setMessage(reason)
  }, [clearDrawing, recordFailure])

  useEffect(() => {
    let current = true
    clearDrawing()
    guidanceShownRef.current = false
    guidanceFailureRecorded.current = false
    guidedNext.current = null
    setGuidanceShown(false)
    setReference(null)
    taskStartedAt.current = cameraOnRef.current ? performance.now() : null
    setMessage(cameraOnRef.current ? `Write ${symbol} freely in the air.` : 'Turn on air writing, then write the character shown at left.')
    referenceData.current = null
    fetch(`/strokes_jsons/${strokeAssetName(symbol)}_dotted.strokes.json`).then(response => response.json()).then((value: StrokeData) => {
      if (!current) return
      referenceData.current = value
      setReference(value)
      expectedStrokeCount.current = Math.max(1, value.strokes.length)
    }).catch(() => {
      if (!current) return
      referenceData.current = null
      setReference(null)
      expectedStrokeCount.current = 1
    })
    return () => { current = false }
  }, [challengeId, clearDrawing, symbol])

  const assessDrawing = useCallback(async () => {
    const model = symbolModel.current
    if (!model || recognitionBusy.current || passed.current) return
    const revision = drawingRevision.current
    const rawCandidate = [...strokes.current, ...(activeStroke.current.length >= 2 ? [[...activeStroke.current]] : [])]
    const box = canvasRef.current?.getBoundingClientRect()
    if (!box) return
    const structure = structuralAssessment(rawCandidate, referenceData.current, symbol, Math.min(box.width, box.height))
    const candidate = structure.cleaned.length
      ? structure.cleaned
      : rawCandidate.filter(stroke => stroke.length >= 2)
    const quality = freeWriteStats(candidate, box.width, box.height), minimum = Math.min(box.width, box.height)
    const clearlyVisible = quality.height >= minimum * .12 && Math.max(quality.width, quality.height) >= minimum * .18
    const uncluttered = quality.coverage < .09 && quality.pathLength < minimum * 7.5 && quality.strokeCount <= expectedStrokeCount.current + 2
    if (!clearlyVisible || !uncluttered) return
    recognitionBusy.current = true
    try {
      const assessment = await model.assess(candidate, symbol)
      const acceptedZero = symbol === '0' && structure.score >= .38 && looksLikeZero(candidate, box.width, box.height)
      const strongTemplateOverride = (symbol === 'I' || symbol.toLowerCase() === 'c') && structure.score >= .68
      // Free Write is judged primarily by the trained whole-character model.
      // Template geometry remains a fallback for the two historically ambiguous shapes,
      // but no longer vetoes a confident match merely because a child lifted a finger
      // or used a different valid stroke split.
      const matchedWholeCharacter = assessment.matched || acceptedZero || strongTemplateOverride
      if (matchedWholeCharacter && !passed.current && revision === drawingRevision.current) {
        passed.current = true
        finishStroke()
        const usedGuidance = guidanceShownRef.current
        let feedback: CompletionFeedback | null = null
        let next = guidedNext.current
        if (!(sessionMode === 'learning' && usedGuidance && guidanceFailureRecorded.current)) {
          feedback = onComplete(attemptMetrics(true, usedGuidance ? 1 : 0))
          next = feedback.next
        }
        if (!next) {
          feedback = onComplete(attemptMetrics(true, usedGuidance ? 1 : 0))
          next = feedback.next
        }
        setMessage(usedGuidance
          ? `Yes—that looks like ${symbol}! The reminder helped; this try will not count toward mastery.`
          : `Yes—that looks like ${symbol}! ${feedback?.headline ?? 'Moving to the next character…'}`)
        advanceTimer.current = window.setTimeout(() => onNext(next!), 900)
      }
    } catch (error) { console.error('SkyWrite symbol assessment failed.', error) }
    finally { recognitionBusy.current = false }
  }, [attemptMetrics, finishStroke, onComplete, onNext, sessionMode, symbol])

  const acceptIntentPoint = useCallback((point: Point, drawing: boolean) => {
    if (guidanceShownRef.current) return
    if (!drawing) { finishStroke(); return }
    const previous = activeStroke.current.at(-1)
    const box = canvasRef.current?.getBoundingClientRect(), minimum = box ? Math.min(box.width, box.height) : 600
    if (repositionGuard.current.active) {
      const samples = repositionGuard.current.samples
      samples.push(point); if (samples.length > 8) samples.shift()
      if (samples.length >= 5) {
        const recent = samples.slice(-5), xs = recent.map(value => value[0]), ys = recent.map(value => value[1])
        const settled = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) <= minimum * .035
        const lastStrokeEnd = strokes.current.at(-1)?.at(-1)
        if (settled && lastStrokeEnd && Math.hypot(point[0] - lastStrokeEnd[0], point[1] - lastStrokeEnd[1]) >= minimum * .05) {
          repositionGuard.current = { active: false, samples: [] }; activeStroke.current = [point]
        }
      }
      return
    }
    if ((symbol === 'i' || symbol === 'j') && strokes.current.length === 0 && activeStroke.current.length >= 8 && previous && box) {
      const lowest = Math.max(...activeStroke.current.map(value => value[1]))
      if (point[1] < previous[1] && point[1] <= lowest - box.height * .07) {
        finishStroke(); repositionGuard.current = { active: true, samples: [point] }; return
      }
    }
    if (symbol === 'Q' && strokes.current.length === 0 && activeStroke.current.length >= 18 && previous) {
      const first = activeStroke.current[0], xs = activeStroke.current.map(value => value[0]), ys = activeStroke.current.map(value => value[1])
      const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      let travelled = 0; for (let index = 1; index < activeStroke.current.length; index++) travelled += Math.hypot(activeStroke.current[index][0] - activeStroke.current[index - 1][0], activeStroke.current[index][1] - activeStroke.current[index - 1][1])
      if (diagonal > minimum * .15 && travelled > diagonal * 1.6 && Math.hypot(point[0] - first[0], point[1] - first[1]) <= diagonal * .18) {
        finishStroke(); repositionGuard.current = { active: true, samples: [] }; return
      }
    }
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 1.5) {
      activeStroke.current.push(point)
      hasInk.current = true
      lastMeaningfulAt.current = performance.now()
      if (box && performance.now() - coverageCheckAt.current >= 250) {
        coverageCheckAt.current = performance.now()
        const candidate = [...strokes.current, [...activeStroke.current]], quality = freeWriteStats(candidate, box.width, box.height)
        if (quality.coverage >= .09 || quality.pathLength >= minimum * 6) {
          resetFailedDrawing(`That drawing covered too much of the board. Let's try ${symbol} again.`)
          return
        }
      }
      if (performance.now() - lastRecognitionAt.current >= 450) {
        lastRecognitionAt.current = performance.now(); void assessDrawing()
      }
    }
  }, [assessDrawing, finishStroke, resetFailedDrawing, symbol])

  const completeGuidedAttempt = useCallback(() => {
    if (passed.current) return
    passed.current = true
    hasInk.current = false
    guidanceTraceState.current = 'COMPLETE'
    let next = guidedNext.current
    if (!next) next = onComplete(attemptMetrics(true, 1)).next
    guidedNext.current = next
    setGuidedComplete(true)
    setMessage(`Amazing! You traced every stroke of ${symbol}. This reminder try is complete.`)
  }, [attemptMetrics, onComplete, symbol])

  const acceptGuidedPoint = useCallback((point: Point, drawing: boolean) => {
    const data = referenceData.current, canvas = canvasRef.current
    if (!guidanceShownRef.current || !data || !canvas || passed.current || guidanceTraceState.current === 'COMPLETE') return
    if (!drawing) { guidancePreviousPoint.current = null; return }
    if (guidanceTraceState.current === 'TRANSITION') return
    const box = canvas.getBoundingClientRect(), size = Math.min(box.width, box.height) * .86, ox = (box.width - size) / 2, oy = (box.height - size) / 2
    const scale = Math.max(.72, size / 720), activeIndex = guidanceStrokeIndex.current
    const points = data.strokes[activeIndex].points.map(([x, y]) => [ox + x * size, oy + y * size] as Point)
    const metrics = polylineMetrics(points), start = points[0], end = points.at(-1)!
    if (guidanceTraceState.current === 'WAITING') {
      if (Math.hypot(point[0] - start[0], point[1] - start[1]) <= 36 * scale) {
        guidanceTraceState.current = 'TRACING'
        guidanceProgress.current = 0
        guidancePreviousPoint.current = point
        guidanceTrace.current = [start]
        hasInk.current = true
        lastMeaningfulAt.current = performance.now()
        setMessage(`Stroke ${activeIndex + 1} of ${data.strokes.length}: follow the path all the way to END.`)
      }
      return
    }
    const nearest = nearestProgress(point, points, metrics.lengths, metrics.cumulative, Math.max(0, guidanceProgress.current - 20 * scale), Math.min(metrics.total, guidanceProgress.current + 55 * scale))
    if (nearest.distance > 55 * scale) { guidancePreviousPoint.current = null; return }
    guidanceProgress.current = Math.max(guidanceProgress.current, nearest.progress)
    const previous = guidancePreviousPoint.current
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= 1.5) guidanceTrace.current.push(point)
    guidancePreviousPoint.current = point
    lastMeaningfulAt.current = performance.now()
    if (guidanceProgress.current < metrics.total - 12 * scale || Math.hypot(point[0] - end[0], point[1] - end[1]) > 16 * scale) return
    guidanceTrace.current.push(end)
    guidanceCompletedTraces.current.push([...guidanceTrace.current])
    guidanceTrace.current = []
    guidancePreviousPoint.current = null
    guidanceProgress.current = 0
    const next = activeIndex + 1
    if (next === data.strokes.length) {
      guidanceStrokeIndex.current = next
      setGuidedStrokeIndex(next)
      completeGuidedAttempt()
      return
    }
    guidanceTraceState.current = 'TRANSITION'
    setGuidedTransitioning(true)
    setMessage(`Wonderful stroke ${next}! Pause and look at what you made…`)
    guidanceTransitionTimer.current = window.setTimeout(() => {
      guidanceStrokeIndex.current = next
      setGuidedStrokeIndex(next)
      guidanceTraceState.current = 'WAITING'
      setGuidedTransitioning(false)
      lastMeaningfulAt.current = performance.now()
      setMessage(`Ready? Touch GO to begin stroke ${next + 1}.`)
      guidanceTransitionTimer.current = null
    }, 1000)
  }, [completeGuidedAttempt])

  const draw = useCallback((finger?: Point) => {
    const canvas = canvasRef.current, video = videoRef.current
    if (!canvas) return
    const box = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(box.width * dpr) || canvas.height !== Math.round(box.height * dpr)) {
      canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr)
    }
    const ctx = canvas.getContext('2d')!, w = box.width, h = box.height
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h)
    if (cameraOn && video?.readyState === 4) {
      const vw = video.videoWidth || w, vh = video.videoHeight || h, sourceRatio = vw / vh, targetRatio = w / h
      let sx = 0, sy = 0, sw = vw, sh = vh
      if (sourceRatio > targetRatio) { sw = vh * targetRatio; sx = (vw - sw) / 2 }
      else { sh = vw / targetRatio; sy = (vh - sh) / 2 }
      ctx.save(); ctx.scale(-1, 1); ctx.drawImage(video, sx, sy, sw, sh, -w, 0, w, h); ctx.restore()
      ctx.fillStyle = 'rgba(25,18,54,.12)'; ctx.fillRect(0, 0, w, h)
    } else {
      const gradient = ctx.createLinearGradient(0, 0, w, h)
      gradient.addColorStop(0, '#f6f2ff'); gradient.addColorStop(1, '#e8fbf6')
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h)
    }
    if (guidanceShownRef.current && referenceData.current) {
      const size = Math.min(w, h) * .86, ox = (w - size) / 2, oy = (h - size) / 2
      ctx.strokeStyle = 'rgba(108,86,223,.68)'; ctx.lineWidth = 10; ctx.setLineDash([2, 18]); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      referenceData.current.strokes.forEach(stroke => {
        ctx.beginPath()
        stroke.points.forEach(([x, y], index) => index ? ctx.lineTo(ox + x * size, oy + y * size) : ctx.moveTo(ox + x * size, oy + y * size))
        ctx.stroke()
      })
      ctx.setLineDash([])
    }
    const renderStroke = (points: Point[]) => {
      if (points.length < 2) return
      ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1])
      for (let index = 1; index < points.length - 1; index++) {
        const midpoint: Point = [(points[index][0] + points[index + 1][0]) / 2, (points[index][1] + points[index + 1][1]) / 2]
        ctx.quadraticCurveTo(points[index][0], points[index][1], midpoint[0], midpoint[1])
      }
      const end = points.at(-1)!; ctx.lineTo(end[0], end[1])
      ctx.strokeStyle = '#ef6d9e'; ctx.lineWidth = 24; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
    }
    if (guidanceShownRef.current) {
      guidanceCompletedTraces.current.forEach(renderStroke)
      renderStroke(guidanceTrace.current)
    } else {
      strokes.current.forEach(renderStroke)
      renderStroke(trimStartupNoise(activeStroke.current, symbol, Math.min(w, h)))
    }
    if (guidanceShownRef.current && referenceData.current?.strokes.length && !guidedComplete) {
      const size = Math.min(w, h) * .86, ox = (w - size) / 2, oy = (h - size) / 2
      const screenStrokes = referenceData.current.strokes.map(stroke => stroke.points.map(([x, y]) => [ox + x * size, oy + y * size] as Point))
      const active = screenStrokes[Math.min(guidanceStrokeIndex.current, screenStrokes.length - 1)], metrics = polylineMetrics(active)
      const start = active[0], end = active.at(-1)!, scale = Math.max(.72, size / 720)
      const first = active[0], last = active.at(-1)!, mostlyVertical = Math.abs(last[1] - first[1]) > Math.abs(last[0] - first[0])
      const movingUp = mostlyVertical && last[1] < first[1], movingDown = mostlyVertical && last[1] > first[1]
      const lead = (movingUp ? 44 : movingDown ? 36 : 46) * scale
      const guide = pointAtDistance(active, metrics.lengths, metrics.cumulative, Math.min(metrics.total, guidanceProgress.current + lead))
      const circle = (position: Point, radius: number, label = '') => {
        ctx.fillStyle = '#30a992'; ctx.strokeStyle = 'white'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(position[0], position[1], radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        if (label) { ctx.fillStyle = 'white'; ctx.font = '800 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, position[0], position[1] + 3) }
      }
      if (guidanceTraceState.current === 'WAITING') circle(start, 20, 'GO')
      if (guidanceTraceState.current === 'TRACING') {
        circle(end, 21, 'END')
        ctx.save(); ctx.shadowColor = '#79e7ba'; ctx.shadowBlur = 18; circle(guide, 13); ctx.restore()
      }
    }
    if (finger) {
      ctx.fillStyle = '#ffe05b'; ctx.strokeStyle = 'white'; ctx.lineWidth = 4
      ctx.beginPath(); ctx.arc(finger[0], finger[1], 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
  }, [cameraOn, guidedComplete, symbol])

  const startCamera = async () => {
    setCameraStarting(true); setMessage('Starting camera and smart drawing filter…')
    let stream: MediaStream | null = null
    let startupStage = 'camera'
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported by this browser.')
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      videoRef.current!.srcObject = stream; await videoRef.current!.play()
      const files = await FilesetResolver.forVisionTasks('/wasm')
      startupStage = 'hand tracking'
      const options = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: '/hand_landmarker.task', delegate }, runningMode: 'VIDEO' as const, numHands: 1 })
      try { landmarker.current = await HandLandmarker.createFromOptions(files, options('GPU')) }
      catch { landmarker.current = await HandLandmarker.createFromOptions(files, options('CPU')) }
      startupStage = 'smart drawing model'
      ;[intentModel.current, symbolModel.current] = await Promise.all([IntentModel.load(), SymbolModel.load()])
      cameraOnRef.current = true
      taskStartedAt.current = performance.now()
      setCameraOn(true)
      setMessage(`Write ${symbol} freely in the air. Your cleaned strokes appear after a short delay.`)
    } catch (error) {
      console.error('SkyWrite free-write startup failed.', error)
      stream?.getTracks().forEach(track => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      landmarker.current?.close(); landmarker.current = null
      const detail = error instanceof Error ? error.message : String(error)
      setMessage(`Free Write ${startupStage} could not start: ${detail}`)
    } finally { setCameraStarting(false) }
  }

  const manuallyClear = () => {
    if (hasInk.current && !passed.current) recordFailure()
    clearDrawing()
    setMessage(cameraOnRef.current ? `The board is clear. Try ${symbol} again.` : 'Turn on air writing, then write the character shown at left.')
  }

  useEffect(() => {
    let stopped = false, lastVideoTime = -1
    const loop = () => {
      let finger: Point | undefined
      const video = videoRef.current
      if (cameraOn && landmarker.current && video?.readyState === 4 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime
        try {
          const timestamp = performance.now(), result = landmarker.current.detectForVideo(video, timestamp), hand = result.landmarks[0], tip = hand?.[8]
          if (tip && canvasRef.current) {
            const box = canvasRef.current.getBoundingClientRect(), raw: Point = [(1 - tip.x) * box.width, tip.y * box.height], previous = smoothedPoint.current
            if (previous) {
              const distance = Math.hypot(raw[0] - previous[0], raw[1] - previous[1]), alpha = distance > 30 ? .46 : distance > 10 ? .27 : .13
              smoothedPoint.current = distance < 3 ? previous : [previous[0] + alpha * (raw[0] - previous[0]), previous[1] + alpha * (raw[1] - previous[1])]
            } else smoothedPoint.current = raw
            finger = smoothedPoint.current
            const queuedPoint: Point = [finger[0], finger[1]], fallbackDrawing = isPointingHand(hand), model = intentModel.current
            if (guidanceShownRef.current) acceptGuidedPoint(queuedPoint, fallbackDrawing)
            else if (model) intentQueue.current = intentQueue.current.then(async () => {
              const ready = await model.process(hand, queuedPoint, fallbackDrawing, timestamp)
              ready.forEach(item => acceptIntentPoint(item.point, item.drawing))
            }).catch(error => console.error('SkyWrite free-write filtering failed.', error))
          } else {
            smoothedPoint.current = null
            if (guidanceShownRef.current) guidancePreviousPoint.current = null
            else { finishStroke(); intentModel.current?.reset() }
          }
        } catch (error) { console.error('SkyWrite free-write hand tracking failed.', error) }
      }
      draw(finger)
      if (!stopped) raf.current = requestAnimationFrame(loop)
    }
    loop()
    return () => { stopped = true; cancelAnimationFrame(raf.current) }
  }, [acceptGuidedPoint, acceptIntentPoint, cameraOn, draw, finishStroke])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (!passed.current && cameraOnRef.current && taskStartedAt.current !== null && !guidanceShownRef.current && now - taskStartedAt.current >= 30000) {
        const feedback = sessionMode === 'learning' && !guidanceFailureRecorded.current ? recordFailure() : null
        clearDrawing()
        guidanceShownRef.current = true
        guidanceStrokeIndex.current = 0
        guidanceProgress.current = 0
        guidanceTraceState.current = 'WAITING'
        setGuidanceShown(true)
        if (sessionMode === 'learning' && !guidanceFailureRecorded.current) {
          guidanceFailureRecorded.current = true
          guidedNext.current = feedback?.next ?? null
        }
        setMessage(`Here's a reminder—touch GO to begin stroke 1.`)
      }
      if (hasInk.current && !passed.current && now - lastMeaningfulAt.current >= 15000) {
        resetFailedDrawing(`Let's try ${symbol} again—the board was cleared after a 15-second pause.`)
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [clearDrawing, recordFailure, resetFailedDrawing, sessionMode, symbol])

  useEffect(() => () => {
    cameraOnRef.current = false
    ;(videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach(track => track.stop())
    landmarker.current?.close(); void intentModel.current?.release(); void symbolModel.current?.release()
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current)
    if (guidanceTransitionTimer.current !== null) window.clearTimeout(guidanceTransitionTimer.current)
  }, [])

  return <main className="practice-shell">
    <header className="practice-nav">
      <button onClick={goBack}><ArrowLeft/> {sessionMode === 'learning' ? 'End session' : 'Dashboard'}</button>
      <div className="practice-title"><span>{sessionMode === 'learning' ? 'Learning path' : 'Free practice'} · Level 4</span><b>{symbol} · Free write</b></div>
      <button onClick={manuallyClear}><RotateCcw/> Clear drawing</button>
    </header>
    <section className="practice-layout freewrite-layout">
      <aside aria-label={guidanceShown ? `Stroke reminder for ${symbol}` : `Character to free-write: ${symbol}`}>
        <div className="session-badge">{sessionMode === 'learning' ? <><Trophy size={15}/>{masteredCount}/62 mastered</> : <><Star size={15}/>Practice only</>}</div>
        {guidanceShown ? <>
          <div className="quest-visuals"><div className="big-symbol">{symbol}</div><div className="finger-cue" role="img" aria-label="Point one finger">☝️</div></div>
          <div className="step-list">{reference?.strokes.map((stroke, index) => {
            const done = guidedComplete || index < guidedStrokeIndex || (guidedTransitioning && index === guidedStrokeIndex)
            const upNext = guidedTransitioning && index === guidedStrokeIndex + 1
            return <div className={`stroke-step guidance-step ${done ? 'done' : upNext ? 'up-next' : index === guidedStrokeIndex ? 'active' : ''}`} key={`${stroke.name}-${index}`}><span>{done ? '✓' : index + 1}</span><StrokePreview points={stroke.points}/></div>
          })}</div>
          <p className="freewrite-copy">Touch GO, follow the correct path to END, then wait for the next GO.</p>
        </> : <>
          <p className="freewrite-label">WRITE THIS CHARACTER</p><div className="freewrite-target">{symbol}</div>
          <p className="freewrite-copy">Write from memory with one raised finger. A tracing reminder appears after 30 seconds.</p>
        </>}
        {sessionMode === 'practice' && <button className="primary freewrite-next" onClick={() => onNext({ symbol: randomPracticeSymbol(symbol), level: 4 })}>Try another<ChevronRight size={18}/></button>}
      </aside>
      <div className="studio">
        <div className="studio-head"><p><span className="pulse"/>{message}</p><div className="mode">{guidanceShown ? <><MousePointer2 size={16}/> Guided tracing</> : <><Sparkles size={16}/> Delayed intent smoothing</>}</div></div>
        <div className="camera-stage">
          <video ref={videoRef} playsInline muted/><canvas ref={canvasRef}/>
          {guidedComplete && <div className="celebrate"><span><Check/></span><div><h2>Reminder complete!</h2><p>Look at the {symbol} you made by following every stroke.</p></div><button className="primary" disabled={!guidedNext.current} onClick={() => guidedNext.current && onNext(guidedNext.current)}>{sessionMode === 'learning' ? 'Next letter' : 'Next random letter'}<b>{guidedNext.current?.symbol}</b><ChevronRight size={18}/></button></div>}
        </div>
        <div className="studio-actions"><button className="camera-button" onClick={startCamera} disabled={cameraOn || cameraStarting}><Camera/>{cameraOn ? 'Camera is on' : cameraStarting ? 'Starting Free Write…' : 'Turn on Free Write'}</button><p><LockKeyhole size={15}/> The model and camera stay on this device.</p></div>
      </div>
    </section>
  </main>
}

function Practice({ level, symbol, challengeId, sessionMode, masteredCount, goBack, onComplete, onNext }: { level: Level; symbol: string; challengeId: number; sessionMode: SessionMode; masteredCount: number; goBack: () => void; onComplete: (metrics: AttemptMetrics) => CompletionFeedback; onNext: (challenge: Challenge) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarker = useRef<HandLandmarker | null>(null), raf = useRef(0), trace = useRef<Point[]>([])
  const completedTraces = useRef<Point[][]>([]), traceState = useRef<'WAITING'|'TRACING'|'TRANSITION'>('WAITING')
  const userProgress = useRef(0), guideProgress = useRef(0), previousPoint = useRef<Point|null>(null)
  const smoothedPoint = useRef<Point|null>(null), strokeIndexRef = useRef(0)
  const shadeCanvas = useRef<HTMLCanvasElement|null>(null), transitionTimer = useRef<number|null>(null)
  const transitionStartedAt = useRef(performance.now())
  const lastProgressAt = useRef(performance.now()), lastMeaningfulProgress = useRef(0)
  const goHintShown = useRef(false), advancedHintShown = useRef(false)
  const attemptStartedAt = useRef<number|null>(null), pathSamples = useRef(0), insidePathSamples = useRef(0)
  const coveredBuckets = useRef<Array<Set<number>>>([]), hintsUsed = useRef(0), completionReported = useRef(false)
  const [data, setData] = useState<StrokeData | null>(null), [cameraOn, setCameraOn] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [message, setMessage] = useState(level===3?'Find the first stroke and begin when you are ready':'Place your finger on the purple Go spot'), [strokeIndex, setStrokeIndex] = useState(0)
  const [hintAge, setHintAge] = useState(0), [complete, setComplete] = useState(false), [transitioning, setTransitioning] = useState(false)
  const [feedback, setFeedback] = useState<CompletionFeedback|null>(null)
  const startedAt = useRef(performance.now())
  useEffect(() => { fetch(`/strokes_jsons/${strokeAssetName(symbol)}_dotted.strokes.json`).then(r => r.json()).then(value=>{if(transitionTimer.current!==null)window.clearTimeout(transitionTimer.current);transitionTimer.current=null;setData(value);trace.current=[];completedTraces.current=[];traceState.current='WAITING';userProgress.current=0;guideProgress.current=0;previousPoint.current=null;smoothedPoint.current=null;strokeIndexRef.current=0;lastMeaningfulProgress.current=0;goHintShown.current=false;advancedHintShown.current=false;attemptStartedAt.current=null;pathSamples.current=0;insidePathSamples.current=0;coveredBuckets.current=value.strokes.map(()=>new Set<number>());hintsUsed.current=0;completionReported.current=false;startedAt.current=performance.now();lastProgressAt.current=startedAt.current;setHintAge(0);setStrokeIndex(0);setComplete(false);setFeedback(null);setTransitioning(false);setMessage(level===3?'Find the first stroke and begin when you are ready':'Place your finger on the purple Go spot')}) }, [challengeId, level, symbol])
  useEffect(() => { const id = window.setInterval(() => setHintAge((performance.now() - startedAt.current) / 1000), 250); return () => clearInterval(id) }, [strokeIndex])
  const reset = useCallback(() => {
    const attemptInProgress = attemptStartedAt.current !== null || trace.current.length > 0 || completedTraces.current.length > 0
    if (sessionMode === 'learning' && !completionReported.current && attemptInProgress) onComplete({ symbol, level, durationSeconds: attemptStartedAt.current === null ? 0 : (performance.now() - attemptStartedAt.current) / 1000, pathAccuracy: 0, dotCoverage: 0, hintsUsed: hintsUsed.current, passed: false })
    if(transitionTimer.current!==null)window.clearTimeout(transitionTimer.current);transitionTimer.current=null;trace.current=[];completedTraces.current=[];traceState.current='WAITING';userProgress.current=0;guideProgress.current=0;previousPoint.current=null;smoothedPoint.current=null;strokeIndexRef.current=0;lastMeaningfulProgress.current=0;goHintShown.current=false;advancedHintShown.current=false;attemptStartedAt.current=null;pathSamples.current=0;insidePathSamples.current=0;coveredBuckets.current=data?.strokes.map(()=>new Set<number>())??[];hintsUsed.current=0;completionReported.current=false;setHintAge(0);setStrokeIndex(0);setComplete(false);setFeedback(null);setTransitioning(false);setMessage(level===3?'Find the first stroke and begin when you are ready':'Place your finger on the purple Go spot');startedAt.current=performance.now();lastProgressAt.current=startedAt.current
  }, [data, level, onComplete, sessionMode, symbol])

  const draw = useCallback((finger?: Point) => {
    const canvas=canvasRef.current, video=videoRef.current; if (!canvas || !data) return
    const box=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio || 1
    if (canvas.width !== Math.round(box.width*dpr) || canvas.height !== Math.round(box.height*dpr)) { canvas.width=Math.round(box.width*dpr); canvas.height=Math.round(box.height*dpr) }
    const ctx=canvas.getContext('2d')!; ctx.setTransform(dpr,0,0,dpr,0,0); const w=box.width,h=box.height; ctx.clearRect(0,0,w,h)
    const drawBase=()=>{if (cameraOn && video?.readyState === 4) { const vw=video.videoWidth||w,vh=video.videoHeight||h,sourceRatio=vw/vh,targetRatio=w/h;let sx=0,sy=0,sw=vw,sh=vh;if(sourceRatio>targetRatio){sw=vh*targetRatio;sx=(vw-sw)/2}else{sh=vw/targetRatio;sy=(vh-sh)/2}ctx.save();ctx.scale(-1,1);ctx.drawImage(video,sx,sy,sw,sh,-w,0,w,h);ctx.restore();ctx.fillStyle='rgba(25,18,54,.12)';ctx.fillRect(0,0,w,h) } else { const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'#f6f2ff');g.addColorStop(1,'#e8fbf6');ctx.fillStyle=g;ctx.fillRect(0,0,w,h) }}
    drawBase()
    const size=Math.min(w,h)*.86, ox=(w-size)/2, oy=(h-size)/2, point=(p:Point):Point=>[ox+p[0]*size,oy+p[1]*size]
    const stroke=data.strokes[Math.min(strokeIndex,data.strokes.length-1)]
    const screenStrokes=data.strokes.map(item=>item.points.map(point))
    const transitionNextIndex=level<=2&&traceState.current==='TRANSITION'&&strokeIndex+1<data.strokes.length?strokeIndex+1:null
    const transitionReveal=transitionNextIndex===null?1:Math.min(1,(performance.now()-transitionStartedAt.current)/500)
    const path=(pts:Point[],screen=false)=>{ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=screen?p:point(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)})}
    if(level===1){
      data.strokes.forEach((item,index)=>{path(item.points);const revealing=index===transitionNextIndex;ctx.strokeStyle=index<=strokeIndex?'rgba(255,255,255,.86)':revealing?`rgba(255,255,255,${.34+.52*transitionReveal})`:'rgba(255,255,255,.34)';ctx.lineWidth=9;ctx.setLineDash([2,18]);ctx.lineCap='round';ctx.stroke()});ctx.setLineDash([])
      const shade=shadeCanvas.current||(shadeCanvas.current=document.createElement('canvas'))
      if(shade.width!==canvas.width||shade.height!==canvas.height){shade.width=canvas.width;shade.height=canvas.height}
      const shadeContext=shade.getContext('2d')!;shadeContext.setTransform(dpr,0,0,dpr,0,0);shadeContext.clearRect(0,0,w,h);shadeContext.fillStyle='rgba(42,66,142,.48)';shadeContext.fillRect(0,0,w,h);shadeContext.globalCompositeOperation='destination-out';shadeContext.lineWidth=92*Math.max(.72,size/720);shadeContext.lineCap='round';shadeContext.lineJoin='round'
      screenStrokes.slice(0,strokeIndex+1).forEach(points=>{shadeContext.beginPath();points.forEach((p,i)=>i?shadeContext.lineTo(p[0],p[1]):shadeContext.moveTo(p[0],p[1]));shadeContext.stroke()})
      if(transitionNextIndex!==null){shadeContext.globalAlpha=transitionReveal;const nextPoints=screenStrokes[transitionNextIndex];shadeContext.beginPath();nextPoints.forEach((p,i)=>i?shadeContext.lineTo(p[0],p[1]):shadeContext.moveTo(p[0],p[1]));shadeContext.stroke();shadeContext.globalAlpha=1}
      shadeContext.globalCompositeOperation='source-over';ctx.drawImage(shade,0,0,w,h)
    }
    if (level!==1) { data.strokes.forEach((s,i)=>{path(s.points);ctx.strokeStyle=transitionNextIndex!==null?(i<=strokeIndex?'#56baa7':i===transitionNextIndex?`rgba(108,86,223,${.18+.37*transitionReveal})`:'rgba(108,86,223,.18)'):i<strokeIndex?'#56baa7':i===strokeIndex?'rgba(108,86,223,.55)':'rgba(108,86,223,.18)';ctx.lineWidth=10;ctx.setLineDash([2,18]);ctx.lineCap='round';ctx.stroke()});ctx.setLineDash([]) }
    completedTraces.current.forEach(points=>{if(points.length>1){path(points,true);ctx.strokeStyle='#ef6d9e';ctx.lineWidth=24;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}})
    if (trace.current.length>1) { path(trace.current,true);ctx.strokeStyle='#ef6d9e';ctx.lineWidth=24;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);ctx.stroke() }
    if (finger) { ctx.fillStyle='#ffe05b';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(finger[0],finger[1],11,0,Math.PI*2);ctx.fill();ctx.stroke() }
    const drawGo=(position:Point,color:string,opacity=1)=>{ctx.save();ctx.globalAlpha=opacity;ctx.shadowColor=color==='#30a992'?'rgba(48,169,146,.72)':'rgba(108,86,223,.72)';ctx.shadowBlur=15;ctx.fillStyle=color;ctx.strokeStyle='white';ctx.lineWidth=5;ctx.beginPath();ctx.arc(position[0],position[1],20,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='white';ctx.font='800 11px sans-serif';ctx.textAlign='center';ctx.fillText('GO',position[0],position[1]+4);ctx.restore()}
    if (!complete&&stroke) { const start=point(stroke.points[0]), end=point(stroke.points.at(-1)!), now=performance.now()
      if(level===3&&traceState.current==='WAITING'&&hintAge>=10&&!goHintShown.current){goHintShown.current=true;hintsUsed.current=Math.max(hintsUsed.current,1);setMessage('Hint: begin at the green Go spot')}
      if(level===3&&!advancedHintShown.current&&((traceState.current==='WAITING'&&hintAge>=20)||(traceState.current==='TRACING'&&now-lastProgressAt.current>=10000))){advancedHintShown.current=true;hintsUsed.current=Math.max(hintsUsed.current,2);setMessage('Need help? Follow the green guide to END')}
      const showStart=(level<=2&&traceState.current==='WAITING')||(level===3&&traceState.current==='WAITING'&&goHintShown.current)
      const showAdvanced=level===3&&advancedHintShown.current&&traceState.current!=='TRANSITION'
      if ((level<=2&&traceState.current==='TRACING') || showAdvanced) { ctx.fillStyle='#30a992';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(end[0],end[1],21,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.font='800 9px sans-serif';ctx.textAlign='center';ctx.fillText('END',end[0],end[1]+3) }
      if((level<=2&&traceState.current==='TRACING')||showAdvanced){
        const activePoints=screenStrokes[strokeIndex],metrics=polylineMetrics(activePoints),scale=Math.max(.72,size/720),first=activePoints[0],last=activePoints.at(-1)!,mostlyVertical=Math.abs(last[1]-first[1])>Math.abs(last[0]-first[0]),movingUp=mostlyVertical&&last[1]<first[1],movingDown=mostlyVertical&&last[1]>first[1],lead=(movingUp?44:movingDown?36:46)*(level===2?1.12:1)*scale
        guideProgress.current=Math.min(metrics.total,userProgress.current+lead)
        const guide=pointAtDistance(screenStrokes[strokeIndex],metrics.lengths,metrics.cumulative,guideProgress.current);ctx.shadowColor='#79e7ba';ctx.shadowBlur=18;ctx.fillStyle='#4ed3a0';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(guide[0],guide[1],13,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0
      }
      if (showStart) drawGo(start,level===3?'#30a992':'#6c56df')
    }
    if(transitionNextIndex!==null) drawGo(screenStrokes[transitionNextIndex][0],'#6c56df',transitionReveal)
  },[cameraOn,complete,data,hintAge,level,strokeIndex])

  const addPoint = useCallback((p: Point, pointing=true) => {
    if (!data || complete) return
    const box=canvasRef.current!.getBoundingClientRect(), size=Math.min(box.width,box.height)*.86, ox=(box.width-size)/2, oy=(box.height-size)/2
    if(!pointing){previousPoint.current=null;return}
    if(traceState.current==='TRANSITION') return
    const scale=Math.max(.72,size/720), activeIndex=strokeIndexRef.current, points=data.strokes[activeIndex].points.map(([x,y])=>[ox+x*size,oy+y*size] as Point)
    const metrics=polylineMetrics(points), start=points[0], end=points.at(-1)!
    const normalizedLength=polylineMetrics(data.strokes[activeIndex].points).total,bucketCount=Math.max(4,Math.ceil(normalizedLength/.025))
    const markCoverage=(progress:number)=>{const bucket=Math.min(bucketCount-1,Math.max(0,Math.floor(progress/metrics.total*bucketCount)));(coveredBuckets.current[activeIndex]??(coveredBuckets.current[activeIndex]=new Set<number>())).add(bucket)}
    if(traceState.current==='WAITING'){
      if(Math.hypot(p[0]-start[0],p[1]-start[1])<=36*scale){traceState.current='TRACING';attemptStartedAt.current??=performance.now();userProgress.current=0;guideProgress.current=0;lastMeaningfulProgress.current=0;lastProgressAt.current=performance.now();previousPoint.current=p;trace.current=[p];if(level===2)markCoverage(0);setMessage(level===3?`Stroke ${activeIndex+1} of ${data.strokes.length}: write it from memory`:`Stroke ${activeIndex+1} of ${data.strokes.length}: follow the green guide slowly`)}
      return
    }
    if(level===1){const corridor=nearestProgress(p,points,metrics.lengths,metrics.cumulative,0,metrics.total);pathSamples.current+=1;if(corridor.distance<=46*scale)insidePathSamples.current+=1}
    const nearest=nearestProgress(p,points,metrics.lengths,metrics.cumulative,Math.max(0,userProgress.current-20*scale),Math.min(metrics.total,userProgress.current+90*scale))
    if(level===2&&nearest.distance<=34*scale)markCoverage(nearest.progress)
    if(nearest.distance<=55*scale){
      if(nearest.progress>=lastMeaningfulProgress.current+4*scale){lastMeaningfulProgress.current=nearest.progress;lastProgressAt.current=performance.now()}
      userProgress.current=Math.max(userProgress.current,nearest.progress)
      if(previousPoint.current) trace.current.push(p)
      previousPoint.current=p
      if(userProgress.current>=metrics.total-12*scale&&Math.hypot(p[0]-end[0],p[1]-end[1])<=16*scale){
        trace.current.push(end);completedTraces.current.push([...trace.current]);trace.current=[];previousPoint.current=null;userProgress.current=0;guideProgress.current=0;lastMeaningfulProgress.current=0
        const next=activeIndex+1
        if(next===data.strokes.length){strokeIndexRef.current=next;setStrokeIndex(next);traceState.current='WAITING';if(!completionReported.current){completionReported.current=true;const totalBuckets=data.strokes.reduce((sum,item)=>sum+Math.max(4,Math.ceil(polylineMetrics(item.points).total/.025)),0),covered=coveredBuckets.current.reduce((sum,buckets)=>sum+buckets.size,0),result=onComplete({symbol,level,durationSeconds:(performance.now()-(attemptStartedAt.current??performance.now()))/1000,pathAccuracy:pathSamples.current?insidePathSamples.current/pathSamples.current:1,dotCoverage:totalBuckets?covered/totalBuckets:1,hintsUsed:hintsUsed.current,passed:true});setFeedback(result)}setComplete(true);setMessage(`Amazing! Look at the ${symbol} you created!`)} else {traceState.current='TRANSITION';transitionStartedAt.current=performance.now();setTransitioning(true);setMessage(`Wonderful stroke ${next}! Pause and look at what you made…`);transitionTimer.current=window.setTimeout(()=>{strokeIndexRef.current=next;setHintAge(0);setStrokeIndex(next);traceState.current='WAITING';goHintShown.current=false;advancedHintShown.current=false;setTransitioning(false);setMessage(level===3?`Ready? Find the start of stroke ${next+1}`:`Ready? Find Go for stroke ${next+1}`);startedAt.current=performance.now();lastProgressAt.current=startedAt.current;transitionTimer.current=null},1000)}
      }
    } else { previousPoint.current=null }
  },[complete,data,level,onComplete,symbol])

  const startCamera=async()=>{
    setCameraStarting(true)
    setMessage('Starting your camera…')
    let stream: MediaStream | null = null
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported by this browser.')
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false})
      videoRef.current!.srcObject=stream
      await videoRef.current!.play()
      setMessage('Camera ready—starting hand tracking…')
      const files=await FilesetResolver.forVisionTasks('/wasm')
      const options=(delegate:'GPU'|'CPU')=>({baseOptions:{modelAssetPath:'/hand_landmarker.task',delegate},runningMode:'VIDEO' as const,numHands:1})
      try {
        landmarker.current=await HandLandmarker.createFromOptions(files,options('GPU'))
      } catch (gpuError) {
        console.warn('GPU hand tracking was unavailable; retrying on CPU.',gpuError)
        landmarker.current=await HandLandmarker.createFromOptions(files,options('CPU'))
      }
      setCameraOn(true)
      setMessage('Camera ready! Hold up one pointing finger and start writing.')
    } catch (error) {
      console.error('SkyWrite camera startup failed.',error)
      stream?.getTracks().forEach(track=>track.stop())
      if (videoRef.current) videoRef.current.srcObject=null
      const name=error instanceof DOMException?error.name:''
      if (name==='NotAllowedError') setMessage('Camera permission is blocked. Allow camera access in your browser settings, then try again.')
      else if (name==='NotFoundError') setMessage('No camera was found. You can still write with a mouse or finger.')
      else setMessage('The camera opened, but hand tracking could not start. Try refreshing or use Chrome/Safari.')
    } finally { setCameraStarting(false) }
  }
  useEffect(()=>{
    let stopped=false, lastVideoTime=-1
    const loop=()=>{
      let finger:Point|undefined
      const video=videoRef.current
      if(cameraOn && landmarker.current && video?.readyState===4 && video.currentTime!==lastVideoTime){
        lastVideoTime=video.currentTime
        try {
          const result=landmarker.current.detectForVideo(video,performance.now()), hand=result.landmarks[0], tip=hand?.[8]
          if(tip && canvasRef.current){
            const b=canvasRef.current.getBoundingClientRect(),raw:Point=[(1-tip.x)*b.width,tip.y*b.height],previous=smoothedPoint.current
            if(previous){const distance=Math.hypot(raw[0]-previous[0],raw[1]-previous[1]),alpha=distance>30?.46:distance>10?.27:.13;smoothedPoint.current=distance<3?previous:[previous[0]+alpha*(raw[0]-previous[0]),previous[1]+alpha*(raw[1]-previous[1])]}
            else smoothedPoint.current=raw
            finger=smoothedPoint.current;addPoint(finger,isPointingHand(hand))
          }
          else {smoothedPoint.current=null;previousPoint.current=null}
        } catch (error) { console.error('SkyWrite hand tracking frame failed.',error) }
      }
      draw(finger)
      if(!stopped) raf.current=requestAnimationFrame(loop)
    }
    loop()
    return()=>{stopped=true;cancelAnimationFrame(raf.current)}
  },[addPoint,cameraOn,draw,level])
  useEffect(()=>()=>{
    if(transitionTimer.current!==null) window.clearTimeout(transitionTimer.current);
    (videoRef.current?.srcObject as MediaStream|null)?.getTracks().forEach((track:MediaStreamTrack)=>track.stop());
    landmarker.current?.close();
  },[])
  const pointer=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(e.buttons===1||e.pointerType==='touch'){const b=e.currentTarget.getBoundingClientRect();addPoint([e.clientX-b.left,e.clientY-b.top],true)}}
  const endPointer=()=>{previousPoint.current=null}
  return <main className="practice-shell"><header className="practice-nav"><button onClick={goBack}><ArrowLeft/> {sessionMode==='learning'?'End session':'Dashboard'}</button><div className="practice-title"><span>{sessionMode==='learning'?'Learning path':'Free practice'} · Level {level}</span><b>{symbol} · {levelInfo[level].title}</b></div><button onClick={reset}><RotateCcw/> Start over</button></header><section className="practice-layout"><aside aria-label={`Stroke order for ${symbol}`}><div className="session-badge">{sessionMode==='learning'?<><Trophy size={15}/>{masteredCount}/62 mastered</>:<><Star size={15}/>Practice only</>}</div><div className="quest-visuals"><div className="big-symbol">{symbol}</div><div className="finger-cue" role="img" aria-label="Point one finger">☝️</div></div><div className="step-list">{data?.strokes.map((s,i)=>{const done=i<strokeIndex||(transitioning&&i===strokeIndex),upNext=transitioning&&i===strokeIndex+1;return <div className={`stroke-step ${done?'done':upNext?'up-next':i===strokeIndex?'active':''}`} key={`${s.name}-${i}`}><span>{done?'✓':i+1}</span><StrokePreview points={s.points}/></div>})}</div></aside><div className="studio"><div className="studio-head"><p><span className="pulse"/>{message}</p><div className="mode"><MousePointer2 size={16}/> Mouse or touch</div></div><div className="camera-stage"><video ref={videoRef} playsInline muted/><canvas ref={canvasRef} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointer(e)}} onPointerMove={pointer} onPointerUp={endPointer} onPointerCancel={endPointer}/></div>{complete&&<div className={`celebrate ${feedback?.evaluation?.strong?'strong-result':''}`}><span>{feedback?.evaluation?.masteredNow?<Crown/>:<Check/>}</span><div><h2>{feedback?.headline??'Brilliant sky writing!'}</h2><p>{feedback?.detail??`Take a look at the ${symbol} your strokes created.`}</p></div><button className="primary" disabled={!feedback} onClick={()=>feedback&&onNext(feedback.next)}>{sessionMode==='learning'?'Next letter':'Next random letter'}<b>{feedback?.next.symbol}</b><ChevronRight size={18}/></button></div>}<div className="studio-actions"><button className="camera-button" onClick={startCamera} disabled={cameraOn||cameraStarting}><Camera/>{cameraOn?'Camera is on':cameraStarting?'Starting camera…':'Turn on air writing'}</button><p><LockKeyhole size={15}/> Your camera stays on this device.</p></div></div></section></main>
}
