import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, Camera, ChevronRight, Hand, LockKeyhole, MousePointer2, RotateCcw, Sparkles, Star, Trophy } from 'lucide-react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { Level, Point, StrokeData } from './types'

const symbols = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'abcdefghijklmnopqrstuvwxyz', ...'0123456789']
const strokeAssetName = (symbol: string) => /[a-z]/.test(symbol) ? `lower_${symbol}` : symbol
const levelInfo = {
  1: { title: 'Follow the trail', detail: 'A safe path, start points, and a friendly guide', color: '#6c56df' },
  2: { title: 'Follow the guide', detail: 'Keep up with the glowing guide dot', color: '#e56f9e' },
  3: { title: 'Sky writer', detail: 'Write from memory—hints appear if you need them', color: '#30a992' },
} satisfies Record<Level, { title: string; detail: string; color: string }>
type Progress = Record<string, number>

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

function StrokePreview({ points }: { points: Point[] }) {
  const markerId=useId().replace(/:/g,'')
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys)
  const width=Math.max(maxX-minX,.001),height=Math.max(maxY-minY,.001),scale=Math.min(76/width,42/height)
  const offsetX=8+(76-width*scale)/2-minX*scale,offsetY=8+(42-height*scale)/2-minY*scale
  const preview=points.map(([x,y])=>[x*scale+offsetX,y*scale+offsetY] as Point)
  const path=preview.map(([x,y],index)=>`${index?'L':'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  return <svg className="stroke-preview" viewBox="0 0 92 58" aria-hidden="true">
    <defs><marker id={markerId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"/></marker></defs>
    <path className="stroke-preview-path" d={path} markerEnd={`url(#${markerId})`}/>
    <circle className="stroke-preview-start" cx={preview[0][0]} cy={preview[0][1]} r="4"/>
  </svg>
}

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
    <section className="stats"><div><span className="stat-icon purple"><Trophy/></span><p><b>{finished}</b><small>Skills completed</small></p></div><div><span className="stat-icon pink"><Star/></span><p><b>{finished * 3 + 12}</b><small>Stars collected</small></p></div><div><span className="stat-icon green">Aa</span><p><b>{symbols.length}</b><small>Letters & numbers</small></p></div></section>
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
  const completedTraces = useRef<Point[][]>([]), traceState = useRef<'WAITING'|'TRACING'|'TRANSITION'>('WAITING')
  const userProgress = useRef(0), guideProgress = useRef(0), previousPoint = useRef<Point|null>(null)
  const smoothedPoint = useRef<Point|null>(null), strokeIndexRef = useRef(0)
  const shadeCanvas = useRef<HTMLCanvasElement|null>(null), transitionTimer = useRef<number|null>(null)
  const lastProgressAt = useRef(performance.now()), lastMeaningfulProgress = useRef(0)
  const goHintShown = useRef(false), advancedHintShown = useRef(false)
  const [data, setData] = useState<StrokeData | null>(null), [cameraOn, setCameraOn] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [message, setMessage] = useState(level===3?'Find the first stroke and begin when you are ready':'Place your finger on the purple Go spot'), [strokeIndex, setStrokeIndex] = useState(0)
  const [hintAge, setHintAge] = useState(0), [complete, setComplete] = useState(false), [transitioning, setTransitioning] = useState(false)
  const startedAt = useRef(performance.now())
  useEffect(() => { fetch(`/strokes_jsons/${strokeAssetName(symbol)}_dotted.strokes.json`).then(r => r.json()).then(value=>{if(transitionTimer.current!==null)window.clearTimeout(transitionTimer.current);transitionTimer.current=null;setData(value);trace.current=[];completedTraces.current=[];traceState.current='WAITING';userProgress.current=0;guideProgress.current=0;previousPoint.current=null;strokeIndexRef.current=0;lastMeaningfulProgress.current=0;goHintShown.current=false;advancedHintShown.current=false;startedAt.current=performance.now();lastProgressAt.current=startedAt.current;setHintAge(0);setStrokeIndex(0);setTransitioning(false)}) }, [symbol])
  useEffect(() => { const id = window.setInterval(() => setHintAge((performance.now() - startedAt.current) / 1000), 250); return () => clearInterval(id) }, [strokeIndex])
  const reset = useCallback(() => { if(transitionTimer.current!==null)window.clearTimeout(transitionTimer.current);transitionTimer.current=null;trace.current=[];completedTraces.current=[];traceState.current='WAITING';userProgress.current=0;guideProgress.current=0;previousPoint.current=null;smoothedPoint.current=null;strokeIndexRef.current=0;lastMeaningfulProgress.current=0;goHintShown.current=false;advancedHintShown.current=false;setHintAge(0);setStrokeIndex(0);setComplete(false);setTransitioning(false);setMessage(level===3?'Find the first stroke and begin when you are ready':'Place your finger on the purple Go spot');startedAt.current=performance.now();lastProgressAt.current=startedAt.current }, [level])

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
    const path=(pts:Point[],screen=false)=>{ctx.beginPath();pts.forEach((p,i)=>{const [x,y]=screen?p:point(p);i?ctx.lineTo(x,y):ctx.moveTo(x,y)})}
    if(level===1){
      data.strokes.forEach((item,index)=>{path(item.points);ctx.strokeStyle=index<=strokeIndex?'rgba(255,255,255,.86)':'rgba(255,255,255,.34)';ctx.lineWidth=9;ctx.setLineDash([2,18]);ctx.lineCap='round';ctx.stroke()});ctx.setLineDash([])
      const shade=shadeCanvas.current||(shadeCanvas.current=document.createElement('canvas'))
      if(shade.width!==canvas.width||shade.height!==canvas.height){shade.width=canvas.width;shade.height=canvas.height}
      const shadeContext=shade.getContext('2d')!;shadeContext.setTransform(dpr,0,0,dpr,0,0);shadeContext.clearRect(0,0,w,h);shadeContext.fillStyle='rgba(42,66,142,.48)';shadeContext.fillRect(0,0,w,h);shadeContext.globalCompositeOperation='destination-out';shadeContext.lineWidth=92*Math.max(.72,size/720);shadeContext.lineCap='round';shadeContext.lineJoin='round'
      screenStrokes.slice(0,strokeIndex+1).forEach(points=>{shadeContext.beginPath();points.forEach((p,i)=>i?shadeContext.lineTo(p[0],p[1]):shadeContext.moveTo(p[0],p[1]));shadeContext.stroke()})
      shadeContext.globalCompositeOperation='source-over';ctx.drawImage(shade,0,0,w,h)
    }
    if (level!==1) { data.strokes.forEach((s,i)=>{path(s.points);ctx.strokeStyle=i<strokeIndex?'#56baa7':i===strokeIndex?'rgba(108,86,223,.55)':'rgba(108,86,223,.18)';ctx.lineWidth=10;ctx.setLineDash([2,18]);ctx.lineCap='round';ctx.stroke()});ctx.setLineDash([]) }
    completedTraces.current.forEach(points=>{if(points.length>1){path(points,true);ctx.strokeStyle='#ef6d9e';ctx.lineWidth=24;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}})
    if (trace.current.length>1) { path(trace.current,true);ctx.strokeStyle='#ef6d9e';ctx.lineWidth=24;ctx.lineCap='round';ctx.lineJoin='round';ctx.setLineDash([]);ctx.stroke() }
    if (!complete&&stroke) { const start=point(stroke.points[0]), end=point(stroke.points.at(-1)!), now=performance.now()
      if(level===3&&traceState.current==='WAITING'&&hintAge>=10&&!goHintShown.current){goHintShown.current=true;setMessage('Hint: begin at the green Go spot')}
      if(level===3&&!advancedHintShown.current&&((traceState.current==='WAITING'&&hintAge>=20)||(traceState.current==='TRACING'&&now-lastProgressAt.current>=10000))){advancedHintShown.current=true;setMessage('Need help? Follow the green guide to END')}
      const showStart=(level<=2&&traceState.current==='WAITING')||(level===3&&traceState.current==='WAITING'&&goHintShown.current)
      const showAdvanced=level===3&&advancedHintShown.current&&traceState.current!=='TRANSITION'
      if (showStart) { ctx.fillStyle=level===3?'#30a992':'#6c56df';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(start[0],start[1],20,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.font='800 11px sans-serif';ctx.textAlign='center';ctx.fillText('GO',start[0],start[1]+4) }
      if ((level<=2&&traceState.current==='TRACING') || showAdvanced) { ctx.fillStyle='#30a992';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(end[0],end[1],21,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.font='800 9px sans-serif';ctx.textAlign='center';ctx.fillText('END',end[0],end[1]+3) }
      if((level<=2&&traceState.current==='TRACING')||showAdvanced){
        const activePoints=screenStrokes[strokeIndex],metrics=polylineMetrics(activePoints),scale=Math.max(.72,size/720),first=activePoints[0],last=activePoints.at(-1)!,mostlyVertical=Math.abs(last[1]-first[1])>Math.abs(last[0]-first[0]),movingUp=mostlyVertical&&last[1]<first[1],movingDown=mostlyVertical&&last[1]>first[1],lead=(movingUp?44:movingDown?36:46)*(level===2?1.12:1)*scale
        guideProgress.current=Math.min(metrics.total,userProgress.current+lead)
        const guide=pointAtDistance(screenStrokes[strokeIndex],metrics.lengths,metrics.cumulative,guideProgress.current);ctx.shadowColor='#79e7ba';ctx.shadowBlur=18;ctx.fillStyle='#4ed3a0';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(guide[0],guide[1],13,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.shadowBlur=0
      }
    }
    if (finger) { ctx.fillStyle='#ffe05b';ctx.strokeStyle='white';ctx.lineWidth=4;ctx.beginPath();ctx.arc(finger[0],finger[1],11,0,Math.PI*2);ctx.fill();ctx.stroke() }
  },[cameraOn,complete,data,hintAge,level,strokeIndex])

  const addPoint = useCallback((p: Point, pointing=true) => {
    if (!data || complete) return
    const box=canvasRef.current!.getBoundingClientRect(), size=Math.min(box.width,box.height)*.86, ox=(box.width-size)/2, oy=(box.height-size)/2
    if(!pointing){previousPoint.current=null;return}
    if(traceState.current==='TRANSITION') return
    const scale=Math.max(.72,size/720), activeIndex=strokeIndexRef.current, points=data.strokes[activeIndex].points.map(([x,y])=>[ox+x*size,oy+y*size] as Point)
    const metrics=polylineMetrics(points), start=points[0], end=points.at(-1)!
    if(traceState.current==='WAITING'){
      if(Math.hypot(p[0]-start[0],p[1]-start[1])<=36*scale){traceState.current='TRACING';userProgress.current=0;guideProgress.current=0;lastMeaningfulProgress.current=0;lastProgressAt.current=performance.now();previousPoint.current=p;trace.current=[p];setMessage(level===3?`Stroke ${activeIndex+1} of ${data.strokes.length}: write it from memory`:`Stroke ${activeIndex+1} of ${data.strokes.length}: follow the green guide slowly`)}
      return
    }
    const nearest=nearestProgress(p,points,metrics.lengths,metrics.cumulative,Math.max(0,userProgress.current-20*scale),Math.min(metrics.total,userProgress.current+90*scale))
    if(nearest.distance<=55*scale){
      if(nearest.progress>=lastMeaningfulProgress.current+4*scale){lastMeaningfulProgress.current=nearest.progress;lastProgressAt.current=performance.now()}
      userProgress.current=Math.max(userProgress.current,nearest.progress)
      if(previousPoint.current) trace.current.push(p)
      previousPoint.current=p
      if(userProgress.current>=metrics.total-12*scale&&Math.hypot(p[0]-end[0],p[1]-end[1])<=16*scale){
        trace.current.push(end);completedTraces.current.push([...trace.current]);trace.current=[];previousPoint.current=null;userProgress.current=0;guideProgress.current=0;lastMeaningfulProgress.current=0
        const next=activeIndex+1
        if(next===data.strokes.length){strokeIndexRef.current=next;setStrokeIndex(next);traceState.current='WAITING';setComplete(true);setMessage(`Amazing! Look at the ${symbol} you created!`);onComplete()} else {traceState.current='TRANSITION';setTransitioning(true);setMessage(`Wonderful stroke ${next}! Pause and look at what you made…`);transitionTimer.current=window.setTimeout(()=>{strokeIndexRef.current=next;setHintAge(0);setStrokeIndex(next);traceState.current='WAITING';goHintShown.current=false;advancedHintShown.current=false;setTransitioning(false);setMessage(level===3?`Ready? Find the start of stroke ${next+1}`:`Ready? Find Go for stroke ${next+1}`);startedAt.current=performance.now();lastProgressAt.current=startedAt.current;transitionTimer.current=null},1000)}
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
  return <main className="practice-shell"><header className="practice-nav"><button onClick={goBack}><ArrowLeft/> Dashboard</button><div className="practice-title"><span>Level {level}</span><b>{levelInfo[level].title}</b></div><button onClick={reset}><RotateCcw/> Start over</button></header><section className="practice-layout"><aside aria-label={`Stroke order for ${symbol}`}><div className="quest-visuals"><div className="big-symbol">{symbol}</div><div className="finger-cue" role="img" aria-label="Point one finger">☝️</div></div><div className="step-list">{data?.strokes.map((s,i)=>{const done=i<strokeIndex||(transitioning&&i===strokeIndex);return <div className={`stroke-step ${done?'done':i===strokeIndex?'active':''}`} key={`${s.name}-${i}`}><span>{done?'✓':i+1}</span><StrokePreview points={s.points}/></div>})}</div></aside><div className="studio"><div className="studio-head"><p><span className="pulse"/>{message}</p><div className="mode"><MousePointer2 size={16}/> Mouse or touch</div></div><div className="camera-stage"><video ref={videoRef} playsInline muted/><canvas ref={canvasRef} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointer(e)}} onPointerMove={pointer} onPointerUp={endPointer} onPointerCancel={endPointer}/></div>{complete&&<div className="celebrate"><span>★</span><div><h2>Brilliant sky writing!</h2><p>Take a look at the {symbol} your strokes created.</p></div><button className="primary" onClick={goBack}>Collect your stars <Star size={18}/></button></div>}<div className="studio-actions"><button className="camera-button" onClick={startCamera} disabled={cameraOn||cameraStarting}><Camera/>{cameraOn?'Camera is on':cameraStarting?'Starting camera…':'Turn on air writing'}</button><p><LockKeyhole size={15}/> Your camera stays on this device.</p></div></div></section></main>
}
