'use client'
import type { EvidenceReport as ReportData } from '@/lib/core/evidence-report'

export function EvidenceReport({ report }: { report: ReportData }) {
  const sourceMap = new Map(report.sources.map(s => [s.id, s]))
  const citations = (ids: string[]) => ids.map(id => {
    const source = sourceMap.get(id)
    return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#2b7165] underline">[{id}] {source.publisher}</a> : null
  })
  return <div className="mt-5 space-y-5 text-sm leading-6 text-[#17324d]">
    <div className="rounded-xl border border-[#d8e5e2] bg-[#edf5f2] p-4">
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-[#2b7165]">Check complete</p>
      <p className="mt-1 font-semibold">Your claims were checked against available evidence.</p>
      <p className="mt-1 text-xs text-[#61717a]">Each claim below has its own result: supported, contradicted, mixed, unsupported, or insufficient evidence.</p>
    </div>
    <p><strong>Coverage:</strong> {report.coverage.assessed} of {report.coverage.total} extracted statements researched. {report.coverage.description}</p>
    {report.claims.length === 0 && <p>Insufficient evidence — no checkable claim was extracted. Review the input or paste the specific claim.</p>}
    {report.claims.map((claim, index) => <details key={claim.claimId} open={report.claims.length === 1 || index === 0} className="rounded-xl border border-[#d8e5e2] bg-white p-4">
      <summary className="cursor-pointer font-semibold"><span className="inline-flex rounded-full bg-[#fff3d8] px-2.5 py-1 text-xs">{claim.verdict}</span>{claim.evidenceStrength !== null ? ` — ${claim.evidenceStrength}/100 evidence strength` : ' — Evidence strength not scored'}<span className="mt-2 block font-normal">Claim checked: {claim.claim}</span></summary>
      <div className="mt-4 space-y-4">
        <section><h5 className="font-semibold">What the evidence supports or contradicts</h5>{claim.findings.length ? claim.findings.map((finding, i) => <p key={i} className="mt-2">{finding.text} {citations(finding.evidenceIds)}</p>) : <p>No inspected excerpt establishes this claim. Available snippets and contextual sources are listed below.</p>}</section>
        <section><h5 className="font-semibold">What needs context</h5>{claim.context.length ? claim.context.map((line, i) => <p key={i}>{line} {citations([line.split(':')[0]])}</p>) : <p>No additional context was established by the retrieved sources. This does not establish completeness.</p>}</section>
        <section><h5 className="font-semibold">Why this assessment</h5><p>The verdict reflects the inspected evidence for this exact claim. Evidence strength measures the quality and completeness of that evidence, not the probability that the claim is true.</p>{claim.evidenceStrength === null && <p className="mt-2 rounded-lg bg-[#f4f7f6] p-3 text-xs">No numeric score is shown because the available evidence was not strong enough to score this claim fairly.</p>}{claim.verdict === 'Unsupported' && <p>Unsupported means a source found a lack of substantiation; it does not mean false.</p>}</section>
        <details><summary className="cursor-pointer font-semibold">Evidence-strength breakdown</summary><ul className="mt-2 space-y-3">{claim.components.map(c => <li key={c.name}><strong className="capitalize">{c.name}: {claim.evidenceStrength === null ? 'Not scored' : `${c.points}/${c.maximum}`}</strong><p>{c.explanation} {citations(c.evidenceIds)}</p></li>)}</ul><p className="mt-2">Score caps below apply after summing components. These are provisional product rules, not scientifically validated probabilities.</p></details>
        <section><h5 className="font-semibold">Limitations</h5><ul className="list-disc pl-5">{claim.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul></section>
      </div>
    </details>)}
    <details className="rounded-xl bg-white p-4"><summary className="cursor-pointer font-semibold">Sources ({report.sources.length})</summary><ol className="mt-3 space-y-4">{report.sources.map(s => <li key={s.id} className="border-t border-[#e1e8e7] pt-3">
      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#2b7165] underline">{s.title}</a>
      <p>{s.id} · {s.publisher} · {s.relation} · {s.sourceGroup ?? 'Origin unknown'}</p>
      <p className="break-all text-xs">{s.url}</p>
      <p className="text-xs">Published: {s.publishedAt ? new Date(s.publishedAt).toLocaleString() : 'Unknown'} · Retrieved: {s.retrievedAt ? new Date(s.retrievedAt).toLocaleString() : 'Unknown'}</p>
      <p className="text-xs">{s.evidenceBasis === 'article_content' ? 'Article content inspected' : 'Limited: search snippet only'} · Context match: {s.contextMatch ?? 'Unknown'} · Independent reporting: {s.independentReporting ? 'Identified in retrieved content; grouping remains provisional' : 'Not established'}</p>
      {s.quoteVerified && s.quote && <blockquote className="mt-2 border-l-2 border-[#c8d8d5] pl-3">“{s.quote}”</blockquote>}
      {s.reasoning && <p>{s.reasoning}</p>}
      {s.qualityBasis && <p>Reporting-method excerpt: “{s.qualityBasis}”</p>}
    </li>)}</ol></details>
    <section><h5 className="font-semibold">Processing and access limitations</h5><ul className="list-disc pl-5">{report.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul></section>
    <p className="text-xs">Checked: {new Date(report.checkedAt).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>
  </div>
}
