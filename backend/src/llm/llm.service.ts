import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';

// ── Templated fallbacks (ported from pipeline/bedrock_client.py). Any Groq error —
//    or a missing GROQ_API_KEY — returns one of these so an AI outage never 500s the API. ──
const FALLBACK = {
  explain: (p: any) =>
    `Satellite change-detection flagged this ${p.area_sqm ?? 'unknown'} sqm ${p.detection_type ?? 'structure'} ` +
    `in Ward ${p.ward_id} (${p.ward_name ?? ''}) at ${Math.round(p.confidence ?? 0)}% confidence. ` +
    `Built-up (NDBI) change and footprint growth suggest recent construction not yet on the assessment roll; ` +
    `a field visit is recommended to confirm. Indicative annual tax: ` +
    `${p.detection_type === 'new_build' ? 'Rs 12–40 per sqm/year by use' : 'Rs 18–25 per sqm/year on the added area'}.`,
  brief: (s: any) => {
    const t = s.city_totals ?? {};
    return `Daily brief (fallback — AI unavailable). City-wide: ${t.total_detected ?? 0} properties detected, ` +
      `${t.total_unassessed ?? 0} unassessed new builds, ${t.total_underassessed ?? 0} change-of-use, ` +
      `est. additional revenue Rs ${t.est_revenue_cr ?? 0} crore. Prioritise the wards with the highest ` +
      `unassessed counts in the table below and deploy field teams there first.`;
  },
  alert: (w: any, severity: string) =>
    `Ward ${w.ward_id} (${w.ward_name ?? ''}) recorded ${w.new_count ?? 0} new detections this run vs a ` +
    `baseline of ${w.monthly_baseline ?? 0}. Recommended action: schedule a ${severity} priority field ` +
    `verification sweep for this ward.`,
  chat: () =>
    `The assistant is temporarily unavailable. For ward data use the dashboard filters, or retry shortly.`,
};

@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);
  // Groq retires models; override with GROQ_MODEL. gpt-oss models reason before answering, and
  // those tokens count against max_tokens, so they run at low effort with extra headroom.
  private readonly model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  private readonly reasoning = this.model.startsWith('openai/gpt-oss');

  // Lazy — build the client only on first use, and only when a key is set. This keeps the
  // API booting (and CI green) with no GROQ_API_KEY: every method below wraps chat() in
  // try/catch and returns a templated FALLBACK, so a missing key degrades AI output to
  // templates instead of crashing at module load.
  private _groq?: Groq;
  private get groq(): Groq {
    if (!process.env.GROQ_API_KEY)
      throw new Error('GROQ_API_KEY not set — using templated fallback');
    return (this._groq ??= new Groq({ apiKey: process.env.GROQ_API_KEY }));   // server-side only
  }

  private async chat(prompt: string, maxTokens = 400, temperature = 0.5): Promise<string> {
    const r = await this.groq.chat.completions.create({
      model: this.model, temperature,
      max_tokens: this.reasoning ? maxTokens + 1024 : maxTokens,
      ...(this.reasoning ? { reasoning_effort: 'low' } : {}),   // not in groq-sdk 0.7 types; sent as-is
      messages: [{ role: 'user', content: prompt }],
    } as any);
    return r.choices[0].message.content!.trim();
  }

  // ── Spot 1: Property Explainer (prompt text unchanged from pipeline/bedrock_client.py) ──
  async explainProperty(p: any): Promise<string> {
    const c = p.confidence ?? 0;
    const verdict = c >= 80 ? 'High confidence — likely a real unassessed structure'
                  : c >= 60 ? 'Moderate confidence — field visit recommended to confirm'
                  : 'Low confidence — manual check needed before assessment';
    const b = p.confidence_breakdown ?? {};
    const taxHint = p.detection_type === 'new_build'
      ? 'Residential new build: Rs 12–18 per sqm/year. Commercial: Rs 25–40 per sqm/year.'
      : 'Change of use / expansion: Rs 18–25 per sqm/year on the additional area only.';
    try {
      return await this.chat(
`You are a GVMC Revenue assistant helping field officers in Visakhapatnam.

A property has been flagged by satellite detection. In exactly 3 sentences:
1. Describe what the satellite signals suggest about this property and when it was likely built.
2. Explain the strongest evidence signals (NDBI change, area, NDVI drop).
3. Give an estimated annual property tax in Rs based on area and type.

Confidence verdict: ${verdict}
Tax guidance: ${taxHint}

Property data:
- Ward: ${p.ward_name} (Ward ${p.ward_id})
- Area: ${p.area_sqm} sqm
- Detection type: ${p.detection_type}
- Overall confidence: ${c}%
- NDBI change (built-up signal): ${b.ndbi_delta} (threshold 0.15)
- Area footprint delta: ${b.area_delta} sqm
- OSM status: ${b.osm_status}
- NDVI drop (vegetation cleared): ${b.ndvi_drop}
- In assessment DB: ${b.db_match}
- Detected at: ${p.detected_at}

Write in plain English. Be specific. Do not use bullet points.`, 300);
    } catch (e) { this.log.warn(`explainProperty fallback: ${e}`); return FALLBACK.explain(p); }
  }

  // ── Spot 2: Commissioner Daily Brief ──
  async generateCommissionerBrief(s: any): Promise<string> {
    const t = s.city_totals ?? {};
    const wardsSummary = (s.top_wards ?? []).slice(0, 10).map((w: any) =>
      `- Ward ${w.ward_id} (${w.ward_name}): ${w.new_builds} new builds, ${w.change_of_use} change-of-use, `
      + `FP rate ${Math.round(w.false_positive_rate * 100)}%, est. Rs ${(+w.est_revenue_lakhs).toFixed(1)}L`).join('\n');
    try {
      return await this.chat(
`You are an AI assistant generating a daily brief for the GVMC Commissioner in Visakhapatnam.

Write a 3-paragraph brief:
Paragraph 1: City-wide summary of today's satellite detection results.
Paragraph 2: Highlight the top 3 wards needing urgent attention and why.
Paragraph 3: Staff deployment recommendation — which wards to prioritize and why.

Be specific about ward names, numbers, and rupee amounts. Use a formal but clear tone.

City-wide totals (as of ${t.data_as_of}):
- Total properties detected: ${t.total_detected}
- Unassessed (new builds): ${t.total_unassessed}
- Underassessed (change of use): ${t.total_underassessed}
- Estimated additional revenue: Rs ${t.est_revenue_cr} crore

Ward breakdown:
${wardsSummary}`, 500);
    } catch (e) { this.log.warn(`brief fallback: ${e}`); return FALLBACK.brief(s); }
  }

  // ── Spot 3: AI Alert Generator ──
  async generateWardAlert(w: any): Promise<{ text: string; severity: string; score: number }> {
    const spike = w.spike_pct ?? 0, avgConf = w.avg_confidence ?? 0, fp = w.historical_fp_rate ?? 0;
    let score = 0;
    if (spike > 200) score += 40; else if (spike > 100) score += 20;
    if (avgConf > 80) score += 30; else if (avgConf > 60) score += 15;
    if (fp < 0.10) score += 20;
    if ((w.type_split?.change_of_use ?? 0) > 5) score += 10;
    const severity = score >= 71 ? 'HIGH' : score >= 41 ? 'MEDIUM' : 'LOW';
    const ts = w.type_split ?? {};
    let text: string;
    try {
      text = await this.chat(
`You are an AI system generating a concise alert for GVMC Revenue supervisors.

Write a 2-sentence alert for this ward. First sentence: state the detection spike and pattern.
Second sentence: state the recommended action and urgency level (${severity}).

Ward: ${w.ward_name} (Ward ${w.ward_id})
New detections this run: ${w.new_count}
Monthly baseline: ${w.monthly_baseline}
Spike above baseline: ${spike.toFixed(0)}%
New builds: ${ts.new_build ?? 0} | Change of use: ${ts.change_of_use ?? 0}
Average detection confidence: ${avgConf.toFixed(1)}%
Historical false-positive rate: ${Math.round(fp * 100)}%
Largest property: ${w.largest_property_sqm} sqm
Severity: ${severity}

Do not use bullet points. Keep it under 60 words total.`, 150);
    } catch (e) { this.log.warn(`alert fallback: ${e}`); text = FALLBACK.alert(w, severity); }
    return { text, severity, score };
  }

  // ── Officer chatbot: single-shot (no ReAct tool loop — see change of action.md gotcha #2) ──
  async chatReply(message: string, ctx: { wards: { id: string; name: string }[] }): Promise<string> {
    const wardRef = ctx.wards.map(w => `- Ward ${w.id} = ${w.name}`).join('\n');
    try {
      return await this.chat(
`You are an AI assistant for GVMC field revenue officers. Answer concisely.
Ward reference:
${wardRef}

Officer question: ${message}`, 400);
    } catch (e) { this.log.warn(`chatReply fallback: ${e}`); return FALLBACK.chat(); }
  }

  // ── B.5: Schema mapper (Agent D) ──
  async suggestFieldMapping(a: DatasetSample, b: DatasetSample): Promise<FieldMapping[]> {
    try {
      const raw = await this.chat(
`You are a data-integration assistant for the NAKSHA land-records programme.
Given two datasets' column headers and sample rows, propose a field-to-field mapping.
For each mapping output an object: {"field_a","field_b","confidence"(0-1),"rationale"(one line)}.
Return a JSON array only, no prose.

Dataset A columns: ${JSON.stringify(a.columns)}
Dataset A sample rows: ${JSON.stringify(a.sampleRows.slice(0, 3))}
Dataset B columns: ${JSON.stringify(b.columns)}
Dataset B sample rows: ${JSON.stringify(b.sampleRows.slice(0, 3))}`, 700, 0.2);
      return JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)) as FieldMapping[];
    } catch (e) {
      this.log.warn(`suggestFieldMapping fallback (exact-name match): ${e}`);
      // deterministic fallback: map columns that share a (case-insensitive) name
      const bl = b.columns.map(c => c.toLowerCase());
      return a.columns
        .filter(c => bl.includes(c.toLowerCase()))
        .map(c => ({ field_a: c, field_b: b.columns[bl.indexOf(c.toLowerCase())],
                     confidence: 0.5, rationale: 'exact column-name match (LLM unavailable)' }));
    }
  }
}

export interface DatasetSample { columns: string[]; sampleRows: Record<string, unknown>[]; }
export interface FieldMapping { field_a: string; field_b: string; confidence: number; rationale: string; }
