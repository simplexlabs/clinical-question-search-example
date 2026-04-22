'use client';

// =============================================================================
// <DecisionTreeRenderer tree={...} />
//
// Self-contained NextJS component that renders a citation-native clinical
// decision tree (see pa_resolver_lib's normalized/decision_trees/*.json) and
// a live "likely approved / likely denied" verdict as the user answers.
//
// Ported from pa_resolver_lib/tools/decision_tree_renderer.html so the two
// stay semantically equivalent. Prop API:
//
//   <DecisionTreeRenderer
//     tree={treeJson}                         // required: decision tree doc
//     initialAnswers={{ indication: 'wm_adult' }}
//     onAnswersChange={(next) => console.log(next)}
//     showSource={true}                       // policy source strip
//     showAnswers={true}                      // live-state panel
//   />
//
// Dependencies: Tailwind CSS. No other runtime imports beyond React.
// =============================================================================

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// -----------------------------------------------------------------------------
// Schema types — mirror pa_resolver_lib/research/*/normalized/decision_trees/*.json
// -----------------------------------------------------------------------------

export type Visibility = {
  depends_on: string;
  op: 'eq' | 'in' | 'answered' | 'not_answered' | 'gte' | 'lte' | 'between';
  value?: unknown;
  values?: unknown[];
};

export type Threshold =
  | number
  | {
      operator:
        | '>=' | '<=' | '>' | '<' | '==' | '='
        | 'gte' | 'lte' | 'gt' | 'lt' | 'eq'
        | 'between';
      value: number | [number, number];
      units?: string;
    };

export type Validation = {
  min?: number;
  max?: number;
  units?: string;
};

export type Citation = {
  source_id?: string;
  source_url?: string;
  citation_url?: string;
  page?: number;
  verbatim_quote?: string;
};

export type Option = {
  value: string;
  label: string;
  terminal?: boolean;
  fail?: boolean;
  outcome?: string;
};

export type Question = {
  id: string;
  prompt?: string;
  input_type?: 'boolean' | 'select' | 'choice' | 'number' | 'date' | 'text';
  required?: boolean;
  options?: Option[];
  units?: string;
  validation?: Validation;
  threshold?: Threshold;
  visibility?: Visibility;
  children?: Question[];
  citation?: Citation;
  member_context_path?: string;
};

export type SourcePolicy = {
  source_id?: string;
  source_url?: string;
  source_url_v2?: string;
  effective_date?: string;
};

export type DecisionTreeDoc = {
  decision_tree_id?: string;
  schema_version?: number;
  drug?: string | string[];
  version?: string;
  source_policy?: SourcePolicy;
  applicable_lobs?: string[];
  root: Question;
};

export type Answers = Record<string, string>;

// Tree-level source URL — propagated via context so citation badges can
// deep-link to a PDF page even when the citation itself has no URL.
const DocSourceUrlContext = createContext<string>('');

// Compose a deep-link for a citation. Precedence:
//   1. citation.citation_url (already pinned to a page, use as-is)
//   2. citation.source_url, else tree-level source_policy.source_url, then
//      append "#page=N" if the citation has a page and the URL has no fragment.
function citeUrl(cite: Citation | undefined, docSourceUrl: string): string {
  if (!cite) return '';
  if (cite.citation_url) return cite.citation_url;
  const base = cite.source_url || docSourceUrl || '';
  if (!base) return '';
  if (cite.page != null && !base.includes('#')) {
    return `${base}#page=${cite.page}`;
  }
  return base;
}

export type Verdict =
  | { state: 'approved'; failures: []; pendingCount: 0 }
  | { state: 'denied'; failures: Array<{ q: Question; reason?: string }>; pendingCount: number }
  | { state: 'pending'; failures: []; pendingCount: number };

// -----------------------------------------------------------------------------
// Visibility engine (supports eq / in / answered / not_answered / gte / lte /
// between). Coerces "yes"/true and "no"/false so trees that store boolean
// comparisons can still drive radio inputs that carry string values.
// -----------------------------------------------------------------------------

function valuesMatch(answer: unknown, expected: unknown): boolean {
  if (answer === expected) return true;
  if (expected === true && answer === 'yes') return true;
  if (expected === false && answer === 'no') return true;
  if (typeof answer === 'string' && typeof expected !== 'string') {
    return answer === String(expected);
  }
  return false;
}

function visibleSelf(q: Question, answers: Answers): boolean {
  const v = q.visibility;
  if (!v) return true;
  const parent = answers[v.depends_on];
  const has = parent !== undefined && parent !== '' && parent !== null;
  if (v.op === 'answered') return has;
  if (v.op === 'not_answered') return !has;
  if (!has) return false;
  if (v.op === 'eq') return valuesMatch(parent, v.value);
  if (v.op === 'in') {
    const list = (v.values ?? (Array.isArray(v.value) ? (v.value as unknown[]) : [])) as unknown[];
    return list.some((x) => valuesMatch(parent, x));
  }
  const num = Number(parent);
  if (Number.isNaN(num)) return false;
  if (v.op === 'gte') return num >= Number(v.value);
  if (v.op === 'lte') return num <= Number(v.value);
  if (v.op === 'between' && Array.isArray(v.value)) {
    const [lo, hi] = v.value as [number, number];
    return num >= Number(lo) && num <= Number(hi);
  }
  return false;
}

function isVisible(q: Question, answers: Answers, parents: Record<string, Question | null>): boolean {
  if (!visibleSelf(q, answers)) return false;
  let cur = parents[q.id];
  while (cur) {
    if (!visibleSelf(cur, answers)) return false;
    cur = parents[cur.id];
  }
  return true;
}

// -----------------------------------------------------------------------------
// Threshold evaluator.
// -----------------------------------------------------------------------------

type NormalizedThreshold = {
  operator: '>=' | '<=' | '>' | '<' | '==' | 'between';
  value: number | [number, number];
  units?: string;
};

function normalizeThreshold(raw: Threshold | undefined): NormalizedThreshold | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return { operator: '>=', value: raw };
  const aliases: Record<string, NormalizedThreshold['operator']> = {
    gte: '>=',
    lte: '<=',
    gt: '>',
    lt: '<',
    eq: '==',
    '=': '==',
    '>=': '>=',
    '<=': '<=',
    '>': '>',
    '<': '<',
    '==': '==',
    between: 'between',
  };
  const op = aliases[raw.operator] ?? '>=';
  return { operator: op, value: raw.value, units: raw.units };
}

function formatThreshold(t: NormalizedThreshold): string {
  const units = t.units ? ' ' + t.units : '';
  if (t.operator === 'between' && Array.isArray(t.value)) {
    return `expects ${t.value[0]}–${t.value[1]}${units}`;
  }
  return `expects ${t.operator} ${t.value as number}${units}`;
}

function thresholdStatus(
  q: Question,
  answers: Answers
): { state: 'ok' | 'fail' | 'unknown'; text: string } | null {
  const t = normalizeThreshold(q.threshold);
  if (!t) return null;
  const val = answers[q.id];
  if (val === undefined || val === '' || val === null) return { state: 'unknown', text: formatThreshold(t) };
  const num = Number(val);
  if (Number.isNaN(num)) return { state: 'unknown', text: formatThreshold(t) };
  let ok: boolean | null = null;
  switch (t.operator) {
    case '>=': ok = num >= (t.value as number); break;
    case '<=': ok = num <= (t.value as number); break;
    case '>':  ok = num >  (t.value as number); break;
    case '<':  ok = num <  (t.value as number); break;
    case '==': ok = num === Number(t.value); break;
    case 'between': {
      const [lo, hi] = t.value as [number, number];
      ok = num >= lo && num <= hi;
      break;
    }
  }
  return { state: ok === null ? 'unknown' : ok ? 'ok' : 'fail', text: formatThreshold(t) };
}

// -----------------------------------------------------------------------------
// Verdict: walk visible required nodes, classify pass / fail / pending.
// -----------------------------------------------------------------------------

const FAIL_SELECT_VALUES = new Set([
  'none', 'neither', 'not_applicable', 'na', 'n/a',
  'none_of_the_above', 'none_apply', 'not_listed',
]);

function evalNode(q: Question, answers: Answers): { status: 'pass' | 'fail' | 'pending'; reason?: string } {
  const val = answers[q.id];
  const unanswered = val === undefined || val === '' || val === null;
  if (unanswered) return { status: 'pending' };

  if (q.input_type === 'boolean') {
    return { status: val === 'yes' ? 'pass' : 'fail', reason: `answered "${val}"` };
  }
  if (q.input_type === 'number') {
    const t = normalizeThreshold(q.threshold);
    if (!t) return { status: 'pass' };
    const st = thresholdStatus(q, answers);
    if (!st || st.state === 'unknown') return { status: 'pending' };
    return { status: st.state === 'ok' ? 'pass' : 'fail', reason: `${val} ${st.text}` };
  }
  if (q.input_type === 'select' || q.input_type === 'choice') {
    const opt = (q.options || []).find((o) => o.value === val);
    const flagged = opt && (opt.terminal === true || opt.fail === true || opt.outcome === 'deny');
    const sentinel = FAIL_SELECT_VALUES.has(String(val).toLowerCase());
    if (flagged || sentinel) return { status: 'fail', reason: `selected "${opt?.label || val}"` };
    return { status: 'pass' };
  }
  return { status: 'pass' };
}

function computeVerdict(
  byId: Record<string, Question>,
  parents: Record<string, Question | null>,
  answers: Answers
): Verdict {
  const failures: Array<{ q: Question; reason?: string }> = [];
  let pendingCount = 0;
  let considered = 0;
  for (const id of Object.keys(byId)) {
    const q = byId[id];
    if (!isVisible(q, answers, parents)) continue;
    if (!q.required) continue;
    considered += 1;
    const r = evalNode(q, answers);
    if (r.status === 'fail') failures.push({ q, reason: r.reason });
    else if (r.status === 'pending') pendingCount += 1;
  }
  if (considered === 0) return { state: 'pending', failures: [], pendingCount: 0 };
  if (failures.length > 0) return { state: 'denied', failures, pendingCount };
  if (pendingCount > 0) return { state: 'pending', failures: [], pendingCount };
  return { state: 'approved', failures: [], pendingCount: 0 };
}

function indexTree(root: Question) {
  const byId: Record<string, Question> = {};
  const parents: Record<string, Question | null> = {};
  const walk = (n: Question, parent: Question | null) => {
    byId[n.id] = n;
    parents[n.id] = parent;
    if (n.children) for (const c of n.children) walk(c, n);
  };
  walk(root, null);
  return { byId, parents };
}

// -----------------------------------------------------------------------------
// Component.
// -----------------------------------------------------------------------------

export type DecisionTreeRendererProps = {
  tree: DecisionTreeDoc;
  initialAnswers?: Answers;
  onAnswersChange?: (answers: Answers) => void;
  showSource?: boolean;
  showAnswers?: boolean;
  className?: string;
};

export function DecisionTreeRenderer({
  tree,
  initialAnswers,
  onAnswersChange,
  showSource = true,
  showAnswers = true,
  className = '',
}: DecisionTreeRendererProps) {
  const { byId, parents } = useMemo(() => indexTree(tree.root), [tree.root]);
  const [answers, setAnswers] = useState<Answers>(initialAnswers || {});

  useEffect(() => {
    onAnswersChange?.(answers);
  }, [answers, onAnswersChange]);

  // Reset when a different tree is loaded.
  useEffect(() => {
    setAnswers(initialAnswers || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.decision_tree_id]);

  const setAnswer = (id: string, val: string) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (val === '' || val === null || val === undefined) delete next[id];
      else next[id] = val;
      return next;
    });
  };

  const verdict = useMemo(() => computeVerdict(byId, parents, answers), [byId, parents, answers]);

  const docSourceUrl =
    tree.source_policy?.source_url || tree.source_policy?.source_url_v2 || '';

  return (
    <DocSourceUrlContext.Provider value={docSourceUrl}>
      <div className={className}>
        {showSource && <PolicySourceStrip tree={tree} />}

        <div className={showSource ? 'mt-6' : ''}>
          <VerdictBanner verdict={verdict} />
        </div>

        <div className="rounded-md border border-zinc-200 bg-white p-1">
          <QuestionNode
            q={tree.root}
            answers={answers}
            parents={parents}
            setAnswer={setAnswer}
          />
        </div>

        {showAnswers && (
          <details className="mt-4 rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-mono uppercase tracking-[0.18em] text-zinc-500">
              Current answers
            </summary>
            <pre className="mt-3 max-h-[260px] overflow-auto rounded bg-white border border-zinc-200 p-3 text-[12px] leading-[1.5] text-zinc-700">
              {JSON.stringify(answers, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </DocSourceUrlContext.Provider>
  );
}

// -----------------------------------------------------------------------------
// Sub-components.
// -----------------------------------------------------------------------------

function PolicySourceStrip({ tree }: { tree: DecisionTreeDoc }) {
  const sp = tree.source_policy || {};
  const rows: Array<[string, React.ReactNode]> = [];
  if (tree.decision_tree_id) {
    rows.push([
      'Decision tree',
      <code key="id" className="font-mono text-[12.5px] text-zinc-800">{tree.decision_tree_id}</code>,
    ]);
  }
  if (tree.drug) {
    const drugLabel = Array.isArray(tree.drug) ? tree.drug.join(', ') : tree.drug;
    rows.push(['Drug', <span key="drug" className="capitalize">{drugLabel}</span>]);
  }
  if (sp.source_id) {
    rows.push([
      'Policy',
      <code key="pol" className="font-mono text-[12.5px] text-zinc-800">{sp.source_id}</code>,
    ]);
  }
  if (sp.effective_date) {
    rows.push(['Effective', <span key="eff" className="tabular-nums">{sp.effective_date}</span>]);
  }
  if (sp.source_url) {
    rows.push([
      'Source',
      <a
        key="url"
        href={sp.source_url}
        target="_blank"
        rel="noreferrer noopener"
        className="text-zinc-900 underline underline-offset-2 decoration-zinc-300 hover:decoration-zinc-900 break-all"
      >
        {sp.source_url}
      </a>,
    ]);
  }

  if (rows.length === 0 && !tree.applicable_lobs?.length) return null;

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-col gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {label}
            </span>
            <span className="text-[14px] text-zinc-800">{value}</span>
          </div>
        ))}
        {tree.applicable_lobs && tree.applicable_lobs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Applicable LOBs
            </span>
            <div className="flex flex-wrap gap-1.5">
              {tree.applicable_lobs.map((lob) => (
                <span
                  key={lob}
                  className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white border border-zinc-200 text-zinc-700"
                >
                  {lob}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  if (verdict.state === 'pending') return null;

  const isApproved = verdict.state === 'approved';
  const tone = isApproved
    ? 'border-green-200 bg-green-50 text-green-900'
    : 'border-red-200 bg-red-50 text-red-900';
  const headline = isApproved
    ? 'Likely approved — all required criteria met'
    : `Likely denied — ${verdict.failures.length} failing ${
        verdict.failures.length === 1 ? 'criterion' : 'criteria'
      }`;

  return (
    <div role="status" className={`mb-4 rounded-md border px-4 py-3 ${tone}`}>
      <div className="text-[14px] font-semibold">{headline}</div>
      {!isApproved && verdict.failures.length > 0 && (
        <ul className="mt-2 ml-4 list-disc text-[13px] leading-[1.55] space-y-1">
          {verdict.failures.map((f, i) => (
            <li key={f.q.id + i} className="text-pretty">
              <span>{(f.q.prompt || f.q.id).trim()}</span>
              {f.reason && <span className="text-zinc-600"> — {f.reason}</span>}
              {f.q.citation && <CitationBadge citation={f.q.citation} className="ml-1.5" />}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 text-[11px] text-zinc-600">
        Heuristic — evaluates visible required nodes only. Not a coverage decision.
      </div>
    </div>
  );
}

function QuestionNode({
  q,
  answers,
  parents,
  setAnswer,
}: {
  q: Question;
  answers: Answers;
  parents: Record<string, Question | null>;
  setAnswer: (id: string, val: string) => void;
}) {
  if (!isVisible(q, answers, parents)) return null;

  const value = answers[q.id] ?? '';
  const type = q.input_type || 'text';
  const units = q.validation?.units || q.units;
  const th = thresholdStatus(q, answers);

  return (
    <div className="border-l-2 border-zinc-200 pl-3.5 py-1.5 my-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[14px] font-medium text-zinc-900 text-pretty">
          {q.prompt || '(no prompt)'}
        </span>
        {q.required && <span className="text-red-500 text-[14px]">*</span>}
        <span className="font-mono text-[11px] text-zinc-400">{q.id}</span>
        {q.citation && <CitationBadge citation={q.citation} />}
        {q.member_context_path && (
          <span
            className="font-mono text-[10.5px] px-1.5 rounded bg-green-100 text-green-800"
            title={`Can be auto-filled from member context field ${q.member_context_path}`}
          >
            ctx: {q.member_context_path}
          </span>
        )}
      </div>

      <div className="mt-1.5">
        {type === 'boolean' ? (
          <div className="inline-flex gap-4 items-center">
            {['yes', 'no'].map((v) => (
              <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name={q.id}
                  value={v}
                  checked={value === v}
                  onChange={() => setAnswer(q.id, v)}
                />
                <span className="text-[13px] text-zinc-700">{v}</span>
              </label>
            ))}
          </div>
        ) : type === 'select' || type === 'choice' ? (
          <select
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            className="h-9 min-w-[280px] max-w-full rounded-md border px-2.5 text-[13px]"
          >
            <option value="">— select —</option>
            {(q.options || []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : type === 'number' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              step="any"
              min={q.validation?.min}
              max={q.validation?.max}
              value={value}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              className="h-9 w-[180px] rounded-md border px-2.5 text-[13px] tabular-nums"
            />
            {units && <span className="text-[12px] text-zinc-500">{units}</span>}
            {th && (
              <span
                className={`font-mono text-[11.5px] ${
                  th.state === 'ok'
                    ? 'text-green-700'
                    : th.state === 'fail'
                    ? 'text-red-700'
                    : 'text-zinc-500'
                }`}
              >
                {th.text}
              </span>
            )}
          </div>
        ) : type === 'date' ? (
          <input
            type="date"
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            className="h-9 rounded-md border px-2.5 text-[13px]"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            className="h-9 min-w-[280px] max-w-full rounded-md border px-2.5 text-[13px]"
          />
        )}
      </div>

      {q.children?.length ? (
        <div className="mt-1">
          {q.children.map((c) => (
            <QuestionNode
              key={c.id}
              q={c}
              answers={answers}
              parents={parents}
              setAnswer={setAnswer}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CitationBadge({
  citation,
  className = '',
}: {
  citation: Citation;
  className?: string;
}) {
  const docSourceUrl = useContext(DocSourceUrlContext);
  const label = citation.page != null ? `p.${citation.page}` : 'cite';
  const href = citeUrl(citation, docSourceUrl) || '#';
  const tooltip = [
    citation.source_id &&
      `${citation.source_id}${citation.page != null ? ` · page ${citation.page}` : ''}`,
    citation.verbatim_quote && `"${citation.verbatim_quote}"`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={tooltip}
      className={`inline-block font-mono text-[10.5px] leading-none px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 hover:bg-blue-100 no-underline ${className}`}
    >
      {label}
    </a>
  );
}
