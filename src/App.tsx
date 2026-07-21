import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, ChevronRight, Hand, LockKeyhole, MousePointer2, RotateCcw, Sparkles, Star, Trophy } from 'lucide-react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Level, Point, StrokeData } from './types'

const symbols = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789']
const levelInfo = {
  1: { title: 'Follow the trail', detail: 'A safe path, start points, and a friendly guide', color: '#6c56df' },
  2: { title: 'Follow the guide', detail: 'Keep up with the glowing guide dot', color: '#e56f9e' },
  3: { title: 'Sky writer', detail: 'Write from memory—hints appear if you need them', color: '#30a992' },
} satisfies Record<Level, { title: string; detail: string; color: string }>
type Progress = Record<string, number>

export function App() {
  const [route, setRoute] = useState<'dashboard' | 'practice'>('dashboard')
  const [level, setLevel] = useState<Level>(1)
  const [symbol, setSymbol] = useState('A')
  const [progress, setProgress] = useState<Progress>(() => JSON.parse(localStorage.getItem('skywrite-progress') || '{}'))
  useEffect(() => localStorage.setItem('skywrite-progress', JSON.stringify(progress)), [progress])
  const start = (nextLevel: Level, nextSymbol = symbol) => { setLevel(nextLevel); setSymbol(nextSymbol); setRoute('practice') }
  const complete = () => setProgress(p => ({ ...p, [`${level}-${symbol}`]: 1 }))
  return route === 'dashboard'
    ? <Dashboard progress={progress} symbol={symbol} setSymbol={setSymbol} start={start} />
    : <Practice level={level} symbol={symbol} goBack={() => setRoute('dashboard')} onComplete={complete} />
}

function Dashboard({ progress, symbol, setSymbol, start }: { progress: Progress; symbol: string; setSymbol: (s: string) => void; start: (l: Level, s?: string) => void }) {
  const finished = Object.keys(progress).length
  return <main className="shell">
    <nav className="topbar"><a className="brand" href="#"><span className="brand-mark"><Sparkles size={22}/></span><span>SkyWrite</span></a><div className="streak"><span>🔥</span><b>3 day streak</b></div><button className="avatar" aria-label="Profile">EM</button></nav>
    <section className="hero"><div><p className="eyebrow">TODAY'S SKY QUEST</p><h1>Ready to write<br/><em>something amazing?</em></h1><p>Point your finger, follow the stars, and make letters come alive.</p><button className="primary" onClick={() => start(1)}><Hand size={20}/> Start with {symbol}<ChevronRight size={20}/></button></div><div className="hero-art" aria-hidden="true"><span className="orbit o1">★</span><span className="orbit o2">✦</span><span className="orbit o3">●</span><div className="letter-card">{symbol}<span className="trace-dot d1"/><span className="trace-dot d2"/><span className="trace-dot d3"/></div></div></section>
    <section className="stats"><div><span className="stat-icon purple"><Trophy/></span><p><b>{finished}</b><small>Skills completed</small></p></div><div><span className="stat-icon pink"><Star/></span><p><b>{finished * 3 + 12}</b><small>Stars collected</small></p></div><div><span className="stat-icon green">Aa</span><p><b>36</b><small>Letters & numbers</small></p></div></section>
    <section className="content"><div className="section-head"><div><p className="eyebrow">CHOOSE YOUR CHALLENGE</p><h2>Learning levels</h2></div><span className="tiny-note">Go at your own pace</span></div>
      <div className="level-grid">{([1,2,3] as Level[]).map((l, i) => <button className="level-card" style={{'--accent': levelInfo[l].color} as React.CSSProperties} key={l} onClick={() => start(l)}><span className="level-number">{l}</span><div className="level-visual">{i === 0 ? 'A···' : i === 1 ? 'A  ●' : 'A  ✦'}</div><h3>{levelInfo[l].title}</h3><p>{levelInfo[l].detail}</p><span className="card-link">Play level {l}<ChevronRight size={18}/></span></button>)}</div>
      <div className="section-head alphabet-head"><div><p className="eyebrow">PICK A CHARACTER</p><h2>Letter & number garden</h2></div></div>
      <div className="symbol-grid">{symbols.map(s => <button key={s} className={symbol === s ? 'selected' : ''} onClick={() => setSymbol(s)}>{s}{progress[`1-${s}`] && <span>★</span>}</button>)}</div>
    </section><footer>Made with wonder for growing writers <span>✦</span></footer>
  </main>
}

function Practice({ level, symbol, goBack, onComplete }: { level: Level; symbol: string; goBack: () => void; onComplete: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null)
  const landmarker = useRef<HandLandmarker | null>(null), raf = useRef(0), trace = useRef<Point[]>([])
  const [data, setData] = useState<StrokeData | null>(null), [cameraOn, setCameraOn] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [message, setMessage] = useState('Place your finger on the purple start dot'), [strokeIndex, setStrokeIndex] = useState(0)
  const [hintAge, setHintAge] = useState(0), [complete, setComplete] = useState(false)
  const startedAt = useRef(performance.now())
  useEffect(() => { fetch(`/strokes_jsons/${symbol}_dotted.strokes.json`).then(r => r.json()).then(setData) }, [symbol])
  useEffect(() => { const id = window.setInterval(() => setHintAge((performance.now() - startedAt.current) / 1000), 250); return () => clearInterval(id) }, [strokeIndex])
  const reset = useCallback(() => { trace.current=[]; setStrokeIndex(0); setComplete(false); setMessage('Place your finger on the purple start dot'); startedAt.current=performance.now() }, [])

  const draw = useCallback((finger?: Point) => {
    const canvas=canvasRef.current, video=videoRef.current; if (!canvas || !data) return
    const box=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio || 1
    if (canvas.width !== Math.round(box.width*dpr) || canvas.height !== Math.round(box.height*dpr)) { canvas.width=Math.round(box.width*dpr); canvas.height=Math.round(box.height*dpr) }
    const ctx=canvas.getContext('2d')!; ctx.setTransform(dpr,0,0,dpr,0,0); const w=box.width,h=box.height; ctx.clearRect(0,0,w,h)
    if (cameraOn && video?.readyState === 4) { ctx.save(); ctx.scale(-1,1); ctx.drawImage(video,-w,0,w,h); ctx.restore(); ctx.fillStyle='rgba(25,18,54,.2)'; ctx.fillRect(0,0,w,h) }
    else { const g=ctx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#f6f2ff');g.addColorStop(1,'#e8fbf6');ctx.fillStyle=g;ctx.fillRect(0,0,w,h) }
    const size=Math.min(w,h)*.86, ox=(w-size)/2, oy=(h-size)/2, point=(p:Point):Point=>[ox+p[0]*size,oy+p[1]*size]
    const stroke=data.strokes[Math.min(strokeIndex,data.strokes.length-1)]
    const path=(pts:Point[])=>{ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=point(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)})}
    if (level===1) { ctx.fillStyle='rgba(96,80,190,.12)';ctx.fillRect(0,0,w,h);ctx.save();ctx.globalCompositeOperation='destination-out';data.strokes.slice(0,strokeIndex+1).forEach(s=>{path(s.points);ctx.lineWidth=84;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()});ctx.restore() }
    const showPath=level===1 || (level===3 && hintAge>=15)
    if (showPath) { data.strokes.forEach((s,i)=>{path(s.points);ctx.strokeStyle=i<strokeIndex?'#56baa7':i===strokeIndex?'rgba(108,86,223,.55)':'rgba(108,86,223,.18)';ctx.lineWidth=10;ctx.setLineDash([2,18]);ctx.lineCap='round';ctx.stroke()});ctx.setLineDash([]) }
    if (stroke) { const start=point(stroke.points[0]), end=point(stroke.points.at(-1)!)
      if (level===1 || (level===3 && hintAge>=5)) { ctx.fillStyle='#6c56df';ctx.beginPath();ctx.arc(start[0],start[1],13,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='700 11px sans-serif';ctx.textAlign='center';ctx.fillText('GO',start[0],start[1]+4) }
      if (level===1 || (level===3 && hintAge>=15)) { ctx.strokeStyle='#30a992';ctx.lineWidth=4;ctx.beginPath();ctx.arc(end[0],end[1],14,0,Math.PI*2);ctx.stroke() }
      if (level<=2 || (level===3 && hintAge>=15)) { const guide=point(stroke.points[Math.floor((Date.now()/180)%stroke.points.length)]);ctx.shadowColor='#ffcf55';ctx.shadowBlur=16;ctx.fillStyle='#ffcf55';ctx.beginPath();ctx.arc(guide[0],guide[1],10,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0 }
    }
    if (trace.current.length>1) { path(trace.current.map(([x,y])=>[(x-ox)/size,(y-oy)/size]));ctx.strokeStyle='#ef6d9e';ctx.lineWidth=18;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);ctx.stroke() }
    if (finger) { ctx.fillStyle='#ffe05b';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(finger[0],finger[1],11,0,Math.PI*2);ctx.fill();ctx.stroke() }
  },[cameraOn,data,hintAge,level,strokeIndex])

  const addPoint = useCallback((p: Point) => {
    if (!data || complete) return; trace.current.push(p)
    const box=canvasRef.current!.getBoundingClientRect(), size=Math.min(box.width,box.height)*.86, ox=(box.width-size)/2, oy=(box.height-size)/2
    const target=data.strokes[strokeIndex], end=target.points.at(-1)!, ep:Point=[ox+end[0]*size,oy+end[1]*size]
    if (Math.hypot(p[0]-ep[0],p[1]-ep[1])<42 && trace.current.length>8) { trace.current=[]; if (strokeIndex===data.strokes.length-1) {setComplete(true);setMessage(`Amazing! You wrote ${symbol}!`);onComplete()} else {setStrokeIndex(i=>i+1);setMessage('Great! Find the next purple start dot');startedAt.current=performance.now()} }
  },[complete,data,onComplete,strokeIndex,symbol])

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
          const result=landmarker.current.detectForVideo(video,performance.now()), tip=result.landmarks[0]?.[8]
          if(tip && canvasRef.current){const b=canvasRef.current.getBoundingClientRect();finger=[(1-tip.x)*b.width,tip.y*b.height];addPoint(finger)}
        } catch (error) { console.error('SkyWrite hand tracking frame failed.',error) }
      }
      draw(finger)
      if(!stopped) raf.current=requestAnimationFrame(loop)
    }
    loop()
    return()=>{stopped=true;cancelAnimationFrame(raf.current)}
  },[addPoint,cameraOn,draw])
  useEffect(()=>()=>{
    (videoRef.current?.srcObject as MediaStream|null)?.getTracks().forEach(track=>track.stop())
    landmarker.current?.close()
  },[])
  const pointer=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(e.buttons===1||e.pointerType==='touch'){const b=e.currentTarget.getBoundingClientRect();addPoint([e.clientX-b.left,e.clientY-b.top])}}
  return <main className="practice-shell"><header className="practice-nav"><button onClick={goBack}><ArrowLeft/> Dashboard</button><div className="practice-title"><span>Level {level}</span><b>{levelInfo[level].title}</b></div><button onClick={reset}><RotateCcw/> Start over</button></header><section className="practice-layout"><aside><p className="eyebrow">YOUR QUEST</p><div className="big-symbol">{symbol}</div><h2>Write the {/[0-9]/.test(symbol)?'number':'letter'} {symbol}</h2><p>{levelInfo[level].detail}</p><div className="step-list">{data?.strokes.map((s,i)=><div className={i<strokeIndex?'done':i===strokeIndex?'active':''} key={s.name}><span>{i<strokeIndex?'✓':i+1}</span><p><b>{s.name}</b><small>{i<strokeIndex?'Complete':i===strokeIndex?'Your turn':'Up next'}</small></p></div>)}</div></aside><div className="studio"><div className="studio-head"><p><span className="pulse"/>{message}</p><div className="mode"><MousePointer2 size={16}/> Mouse or touch</div></div><div className="camera-stage"><video ref={videoRef} playsInline muted/><canvas ref={canvasRef} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointer(e)}} onPointerMove={pointer}/>{complete&&<div className="celebrate"><span>★</span><h2>Brilliant sky writing!</h2><p>You completed {symbol} on Level {level}.</p><button className="primary" onClick={goBack}>Collect your stars <Star size={18}/></button></div>}</div><div className="studio-actions"><button className="camera-button" onClick={startCamera} disabled={cameraOn||cameraStarting}><Camera/>{cameraOn?'Camera is on':cameraStarting?'Starting camera…':'Turn on air writing'}</button><p><LockKeyhole size={15}/> Your camera stays on this device.</p></div></div></section></main>
}
