'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Link2,
  Menu,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

const evidence = [
  {
    label: 'Official source',
    title: 'Ministry of Education publishes academic calendar for 2026',
    publisher: 'Ministry of Education',
    date: 'September 20, 2026',
    relation: 'Contradicts',
    note: 'The official calendar lists a five-day academic schedule. No permanent four-day change is mentioned.',
    url: 'moe.gov.example/calendar-2026',
  },
  {
    label: 'Reputable news',
    title: 'Universities retain current academic week amid schedule review',
    publisher: 'The National Ledger',
    date: 'September 22, 2026',
    relation: 'Contradicts',
    note: 'Reporting cites university registrars who say no permanent policy has been announced.',
    url: 'nationalledger.example/education/schedule-review',
  },
  {
    label: 'University notice',
    title: 'Notice regarding class schedules for the autumn term',
    publisher: 'Kathmandu Valley University',
    date: 'September 24, 2026',
    relation: 'Neutral',
    note: 'The notice confirms the autumn term dates but does not support the claim about a four-day week.',
    url: 'kvu.example/notices/autumn-term',
  },
]

const history = [
  ['Government announces four-day academic week', 'URL', 'Likely false', '2 min ago'],
  ['Video claims earthquake happened today', 'Video', 'Misleading', 'Yesterday'],
  ['New visa policy for foreign tourists', 'Text', 'Unverified', 'Sep 22'],
]

type Mode = 'text' | 'image' | 'video' | 'url'

function Logo() {
  return (
    <a href="#top" className="flex items-center gap-3" aria-label="SatyaCheck home">
      <span className="grid size-9 place-items-center rounded-xl bg-[#17324d] text-white shadow-sm">
        <ShieldCheck className="size-5" strokeWidth={2.2} />
      </span>
      <span className="text-[17px] font-semibold tracking-[-0.03em] text-[#17324d]">SatyaCheck</span>
    </a>
  )
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-[#dfe5e7]/80 bg-[#f7f8f6]/90 backdrop-blur-md">
      <div className="mx-auto flex h-[74px] max-w-6xl items-center justify-between px-5 lg:px-8">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm text-[#61717a] md:flex">
          <a className="transition-colors hover:text-[#17324d]" href="#how-it-works">How it works</a>
          <a className="transition-colors hover:text-[#17324d]" href="#transparency">Our approach</a>
          <a className="transition-colors hover:text-[#17324d]" href="#example">Example report</a>
        </nav>
        <div className="flex items-center gap-2">
          <a href="#history" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#61717a] hover:bg-white md:block">History</a>
          <a href="#verify"><Button className="rounded-lg bg-[#17324d] px-4 text-sm text-white hover:bg-[#254a6b]">Check a claim <ArrowRight data-icon="inline-end" /></Button></a>
          <button className="ml-1 rounded-lg p-2 text-[#61717a] md:hidden" aria-label="Open navigation"><Menu /></button>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="top" className="border-b border-[#dfe5e7] bg-[#f7f8f6]">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:px-8 lg:pb-24 lg:pt-24">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#c9ddd7] bg-[#edf5f2] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[#2b7165]"><span className="size-1.5 rounded-full bg-[#3c9b88]" /> Evidence first</div>
          <h1 className="max-w-xl text-balance text-5xl font-semibold leading-[1.04] tracking-[-0.055em] text-[#17324d] sm:text-6xl">Check the claim.<br /><span className="text-[#3c8d80]">See the evidence.</span></h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[#61717a]">SatyaCheck helps you understand what online content is actually supported by reliable sources — not just what an algorithm predicts.</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#verify"><Button className="h-12 rounded-lg bg-[#17324d] px-5 text-sm text-white hover:bg-[#254a6b]">Verify content <ArrowRight data-icon="inline-end" /></Button></a>
            <a href="#how-it-works"><Button variant="outline" className="h-12 rounded-lg border-[#cad5d9] bg-transparent px-5 text-sm text-[#17324d] hover:bg-white">See how it works</Button></a>
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs text-[#809097]"><ShieldCheck className="size-3.5" /> Transparent by design · Uncertainty is always shown</p>
        </div>
        <div className="relative lg:pl-8">
          <div className="rounded-2xl border border-[#d9e2e1] bg-white p-5 shadow-[0_20px_60px_rgba(23,50,77,.09)] sm:p-6">
            <div className="flex items-start justify-between border-b border-[#edf0ef] pb-5"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#809097]"><FileCheck2 className="size-4 text-[#3c8d80]" /> Example report</div><h2 className="mt-3 text-lg font-semibold text-[#17324d]">Four-day academic week announced</h2></div><span className="rounded-full bg-[#fff3d8] px-2.5 py-1 text-[11px] font-semibold text-[#9a6a16]">Demo data</span></div>
            <div className="flex items-center gap-4 border-b border-[#edf0ef] py-5"><div className="grid size-14 place-items-center rounded-full border-[5px] border-[#e5c76f] text-sm font-bold text-[#94691b]">42%</div><div><p className="text-sm font-semibold text-[#17324d]">Likely false</p><p className="mt-1 text-xs leading-5 text-[#809097]">Evidence contradicts the claim</p></div></div>
            <div className="space-y-3 pt-5"><div className="flex items-center justify-between text-xs"><span className="text-[#809097]">Sources reviewed</span><span className="font-semibold text-[#17324d]">3 sources</span></div><div className="flex items-center justify-between text-xs"><span className="text-[#809097]">Official sources</span><span className="font-semibold text-[#2b7165]">1 found</span></div><div className="flex items-center justify-between text-xs"><span className="text-[#809097]">Uncertainty</span><span className="font-semibold text-[#94691b]">Shown</span></div></div>
          </div>
          <div className="absolute -bottom-5 -left-2 hidden items-center gap-2 rounded-xl border border-[#d9e2e1] bg-white px-4 py-3 text-xs text-[#61717a] shadow-lg sm:flex"><span className="grid size-6 place-items-center rounded-full bg-[#edf5f2] text-[#3c8d80]"><Check className="size-3.5" /></span> Every conclusion has a source</div>
        </div>
      </div>
    </section>
  )
}

function VerifyWorkspace() {
  const [mode, setMode] = useState<Mode>('text')
  const [text, setText] = useState('')
  const modes = [
    ['text', FileText, 'Text', 'Paste a claim or article'],
    ['image', ImageIcon, 'Image', 'OCR visible text'],
    ['video', Video, 'Video', 'Transcript + key frames'],
    ['url', Link2, 'URL', 'Fetch an article safely'],
  ] as const
  return <section id="verify" className="bg-[#17324d] px-5 py-20 lg:px-8"><div className="mx-auto max-w-6xl"><div className="mb-10 max-w-xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8ecabf]">Start a verification</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">What would you like to check?</h2><p className="mt-3 leading-7 text-[#b8c8d1]">Choose an input type. We&apos;ll extract claims, find relevant sources, and show the reasoning behind the result.</p></div><div className="grid overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-[.8fr_1.2fr]"><div className="border-b border-[#e7ecec] bg-[#f4f7f6] p-4 lg:border-b-0 lg:border-r lg:p-6"><div className="grid grid-cols-2 gap-2 lg:grid-cols-1">{modes.map(([key, Icon, label, desc]) => <button key={key} onClick={() => setMode(key)} className={`flex items-center gap-3 rounded-xl p-3 text-left transition ${mode === key ? 'bg-[#17324d] text-white shadow-md' : 'text-[#61717a] hover:bg-white'}`}><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${mode === key ? 'bg-[#315776]' : 'bg-white'}`}><Icon className="size-4" /></span><span><span className="block text-sm font-semibold">{label}</span><span className={`hidden text-xs lg:block ${mode === key ? 'text-[#b8c8d1]' : 'text-[#8a999f]'}`}>{desc}</span></span></button>)}</div><div className="mt-8 hidden rounded-xl border border-[#d8e5e2] bg-[#edf5f2] p-4 lg:block"><div className="flex gap-2 text-[#2b7165]"><ShieldCheck className="size-4 shrink-0" /><p className="text-xs leading-5">Your content is handled with care. Uploaded files are not permanently stored in this demo.</p></div></div></div><div className="p-5 sm:p-8"><div className="mb-7 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#809097]">{mode === 'text' ? 'Text input' : `${mode} input`}</p><h3 className="mt-2 text-xl font-semibold text-[#17324d]">{mode === 'text' ? 'Paste something worth checking' : `Add a ${mode} to inspect`}</h3></div><CircleHelp className="size-5 text-[#a2afb3]" /></div>{mode === 'text' ? <><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste news, claim, social media post, or article text…" className="min-h-40 w-full resize-none rounded-xl border border-[#d8e0e2] bg-[#fbfcfb] p-4 text-sm leading-6 text-[#17324d] outline-none placeholder:text-[#9aa7ab] focus:border-[#4e9689] focus:ring-2 focus:ring-[#c9e4de]" /><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-[#8b999e]">{text.length}/5,000 characters</span><Button onClick={() => document.getElementById('example')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-lg bg-[#3c8d80] px-5 text-white hover:bg-[#32776c]">Verify claim <ArrowRight data-icon="inline-end" /></Button></div></> : <div className="rounded-xl border border-dashed border-[#cbd9d8] bg-[#fbfcfb] px-6 py-14 text-center"><div className="mx-auto grid size-12 place-items-center rounded-xl bg-[#edf5f2] text-[#3c8d80]"><Upload className="size-5" /></div><p className="mt-4 text-sm font-semibold text-[#17324d]">Drop your {mode} here</p><p className="mt-2 text-xs text-[#8b999e]">or choose a file from your device</p><Button variant="outline" className="mt-5 rounded-lg border-[#cad5d9] text-[#17324d]">Choose file</Button><p className="mt-5 text-[11px] text-[#9aa7ab]">{mode === 'image' ? 'JPG, PNG, WEBP up to 10 MB' : mode === 'video' ? 'MP4, MOV, WEBM up to 100 MB' : 'HTTPS article URLs only'}</p></div>}</div></div></div></section>
}

function EvidenceCard({ item }: { item: typeof evidence[number] }) { return <div className="rounded-xl border border-[#e1e8e7] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#edf5f2] px-2.5 py-1 text-[11px] font-semibold text-[#2b7165]">{item.label}</span><span className="text-[11px] text-[#9aa7ab]">{item.date}</span></div><h4 className="mt-3 text-sm font-semibold leading-6 text-[#17324d]">{item.title}</h4></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.relation === 'Contradicts' ? 'bg-[#fff0ee] text-[#b4574d]' : 'bg-[#f2f4f3] text-[#6d7c81]'}`}>{item.relation}</span></div><p className="mt-3 text-xs leading-5 text-[#61717a]">{item.note}</p><div className="mt-4 flex items-center justify-between border-t border-[#edf0ef] pt-3 text-[11px] text-[#8b999e]"><span>{item.publisher}</span><a href="#" className="font-medium text-[#3c8d80] hover:underline">Open source <ArrowRight className="ml-1 inline size-3" /></a></div></div> }

function ExampleReport() { const [open, setOpen] = useState(true); return <section id="example" className="bg-[#f7f8f6] px-5 py-20 lg:px-8"><div className="mx-auto max-w-6xl"><div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3c8d80]">Clearly labeled demo data</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#17324d] sm:text-4xl">A report you can audit</h2></div><p className="max-w-sm text-sm leading-6 text-[#809097]">A verdict is only useful when you can see the claims, sources, and uncertainty behind it.</p></div><div className="grid gap-5 lg:grid-cols-[.78fr_1.22fr]"><div className="rounded-2xl border border-[#dce5e3] bg-white p-6"><div className="flex items-center justify-between"><span className="rounded-full bg-[#fff3d8] px-3 py-1.5 text-xs font-semibold text-[#9a6a16]">Demo report</span><span className="text-xs text-[#9aa7ab]">2 minutes ago</span></div><p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-[#809097]">Overall verdict</p><h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#94691b]">Likely false</h3><p className="mt-3 text-sm leading-6 text-[#61717a]">The available evidence contradicts the central claim. The official schedule describes a different academic week.</p><div className="mt-7 grid grid-cols-2 gap-3">{[['Claims analyzed','3'],['Evidence strength','High'],['Supporting sources','0'],['Contradicting','2']].map(([label,value]) => <div key={label} className="rounded-xl bg-[#f4f7f6] p-3"><p className="text-[11px] text-[#809097]">{label}</p><p className="mt-1 text-sm font-semibold text-[#17324d]">{value}</p></div>)}</div><div className="mt-7 rounded-xl border border-[#e8eceb] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[#17324d]"><Sparkles className="size-3.5 text-[#3c8d80]" /> AI & authenticity analysis</div><p className="mt-2 text-xs leading-5 text-[#809097]">Not applicable to text input. Factual verification and media authenticity are separate assessments.</p></div></div><div className="rounded-2xl border border-[#dce5e3] bg-white p-6"><div className="flex items-center justify-between border-b border-[#edf0ef] pb-5"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#809097]">Claim-by-claim report</p><h3 className="mt-2 text-lg font-semibold text-[#17324d]">What the evidence says</h3></div><span className="text-xs text-[#809097]">3 claims</span></div><div className="divide-y divide-[#edf0ef]">{[['1','Government announced a four-day academic week.','Likely false'],['2','All universities will permanently adopt the schedule.','Unverified'],['3','The change begins next month.','Unverified']].map(([num,claim,status], index) => <div key={num} className="py-5"><button onClick={() => setOpen(index === 0 ? !open : false)} className="flex w-full items-start gap-3 text-left"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#fff3d8] text-xs font-semibold text-[#94691b]">{num}</span><span className="flex-1"><span className="block text-sm font-medium leading-6 text-[#17324d]">{claim}</span><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${status === 'Likely false' ? 'bg-[#fff0ee] text-[#b4574d]' : 'bg-[#f2f4f3] text-[#6d7c81]'}`}>{status}</span></span><ChevronDown className={`mt-1 size-4 text-[#9aa7ab] transition-transform ${index === 0 && open ? 'rotate-180' : ''}`} /></button>{index === 0 && open && <div className="ml-10 mt-4 space-y-3 border-l-2 border-[#e5c76f] pl-4"><p className="text-xs leading-5 text-[#61717a]">The official academic calendar lists a five-day schedule. No permanent four-day policy was found in the available sources.</p>{evidence.slice(0,2).map((item) => <EvidenceCard key={item.title} item={item} />)}</div>}</div>)}</div></div></div></div></section> }

function HowItWorks() { return <section id="how-it-works" className="border-b border-[#dfe5e7] bg-white px-5 py-20 lg:px-8"><div className="mx-auto max-w-6xl"><div className="max-w-xl"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3c8d80]">The verification pipeline</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#17324d] sm:text-4xl">From content to context</h2><p className="mt-4 leading-7 text-[#61717a]">We separate extraction, evidence gathering, and analysis so the path to a result stays understandable.</p></div><div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{[['01','Extract claims','We break articles, screenshots, and transcripts into individual claims that can be checked.'],['02','Find evidence','We search for primary, official, academic, and reputable news sources.'],['03','Compare context','Evidence is labeled as supporting, contradicting, neutral, or irrelevant.'],['04','Explain uncertainty','You get a verdict with sources, limitations, and the reasoning behind it.']].map(([num,title,desc]) => <div key={num} className="relative"><span className="text-xs font-semibold text-[#3c8d80]">{num}</span><h3 className="mt-4 text-lg font-semibold text-[#17324d]">{title}</h3><p className="mt-3 text-sm leading-6 text-[#809097]">{desc}</p></div>)}</div></div></section> }

function History() { return <section id="history" className="bg-[#edf2f0] px-5 py-20 lg:px-8"><div className="mx-auto max-w-6xl"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#3c8d80]">Your workspace</p><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#17324d]">Recent checks</h2></div><a href="#verify" className="flex items-center gap-2 text-sm font-semibold text-[#3c8d80]">Start another check <ArrowRight className="size-4" /></a></div><div className="mt-8 overflow-hidden rounded-2xl border border-[#d8e3df] bg-white"><div className="hidden grid-cols-[1fr_100px_140px_100px] gap-4 border-b border-[#edf0ef] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9aa7ab] sm:grid"><span>Content</span><span>Type</span><span>Verdict</span><span>Date</span></div>{history.map(([title,type,status,date]) => <div key={title} className="grid gap-3 border-b border-[#edf0ef] px-5 py-4 last:border-0 sm:grid-cols-[1fr_100px_140px_100px] sm:items-center sm:gap-4"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-[#f1f5f3] text-[#3c8d80]"><FileText className="size-4" /></span><span className="text-sm font-medium text-[#17324d]">{title}</span></div><span className="text-xs text-[#809097]">{type}</span><span className="w-fit rounded-full bg-[#fff3d8] px-2.5 py-1 text-[11px] font-semibold text-[#94691b]">{status}</span><span className="text-xs text-[#9aa7ab]">{date}</span></div>)}</div></div></section> }

function Footer() { return <footer id="transparency" className="bg-[#17324d] px-5 py-12 text-[#b8c8d1] lg:px-8"><div className="mx-auto flex max-w-6xl flex-col justify-between gap-8 sm:flex-row"><div><div className="flex items-center gap-3 text-white"><span className="grid size-8 place-items-center rounded-lg bg-[#315776]"><ShieldCheck className="size-4" /></span><span className="font-semibold">SatyaCheck</span></div><p className="mt-4 max-w-xs text-sm leading-6">Evidence-based verification for a noisier internet.</p></div><div className="max-w-sm text-sm leading-6"><p className="font-semibold text-white">A note on certainty</p><p className="mt-2">SatyaCheck does not determine absolute truth. Results reflect the quality and availability of evidence at the time of review.</p></div></div><div className="mx-auto mt-10 flex max-w-6xl items-center justify-between border-t border-[#315776] pt-5 text-xs text-[#8299a7]"><span>© 2026 SatyaCheck</span><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Privacy-aware by design</span></div></footer> }

export default function SatyaCheckApp() { return <div className="min-h-screen bg-[#f7f8f6] font-sans"><Header /><main><Hero /><VerifyWorkspace /><ExampleReport /><HowItWorks /><History /></main><Footer /></div> }

export { X, Play, Search, Clock3, ChevronRight }
