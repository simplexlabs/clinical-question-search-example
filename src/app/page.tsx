'use client';

import { type ReactNode, FormEvent, useMemo, useState } from 'react';
import {
  DecisionTreeRenderer,
  type DecisionTreeDoc,
} from '@/components/decision-tree-renderer';
import caremarkWegovy from '@/data/caremark_wegovy.json';

const EXAMPLE_TREE = caremarkWegovy as unknown as DecisionTreeDoc;

type ClinicalQuestionsResponse = {
  matched?: boolean;
  coverage_status?: string;
  lob_id?: string;
  rationale?: string;
  routing?: {
    pbm_name?: string;
    line_of_business?: string;
    plan_name_or_group?: string;
    confidence?: number | string;
  };
  decision_tree?: DecisionTreeDoc;
};

export default function ClinicalQuestionSearchPage() {
  const [bin, setBin] = useState('');
  const [state, setState] = useState('');
  const [drugName, setDrugName] = useState('');
  const [icdCode, setIcdCode] = useState('');
  const [pcn, setPcn] = useState('');
  const [memberId, setMemberId] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ClinicalQuestionsResponse | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const payload: Record<string, string> = {
        bin: bin.trim(),
        state: state.trim(),
        drug_name: drugName.trim(),
        icd_code: icdCode.trim(),
        pcn: pcn.trim(),
      };
      if (memberId.trim()) payload.member_id = memberId.trim();

      const res = await fetch('/api/clinical-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.message || data?.error || 'Request failed.');
        return;
      }
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  };

  const treeToRender: DecisionTreeDoc = useMemo(() => {
    if (response?.decision_tree?.root) return response.decision_tree;
    return EXAMPLE_TREE;
  }, [response]);
  const usingFallback = !response?.decision_tree?.root;

  return (
    <main className="min-h-dvh bg-white text-zinc-900">
      <div className="border-b border-zinc-200">
        <div className="max-w-xl mx-auto px-6 pt-16 pb-10">
          <span className="block mb-4 font-mono text-[11px] uppercase tracking-[0.2em] text-[#6366F1] font-medium">
            Simplex Prior Auth SDK
          </span>
          <h1 className="text-4xl md:text-[42px] font-semibold tracking-tight leading-[1.15] mb-3 text-balance">
            Clinical question search
          </h1>
          <p className="text-[15px] leading-[1.7] text-zinc-600 text-pretty">
            Resolve a pharmacy claim tuple to the payer&apos;s clinical question set. Answer the
            questions to see a live &quot;likely approved / likely denied&quot; verdict with
            policy citations.
          </p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-10">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Field label="BIN" required>
            <input
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              placeholder="003858"
              required
              autoFocus
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </Field>
          <Field label="State" required>
            <input
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              placeholder="CA"
              maxLength={2}
              required
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </Field>
          <Field label="Drug name" required>
            <select
              value={drugName}
              onChange={(e) => setDrugName(e.target.value)}
              required
              className="h-10 w-full rounded-md border px-3 text-sm"
            >
              <option value="" disabled>
                Select a drug…
              </option>
              <option value="wegovy">Wegovy</option>
              <option value="mounjaro">Mounjaro</option>
              <option value="zepbound">Zepbound</option>
              <option value="ozempic">Ozempic</option>
            </select>
          </Field>
          <Field label="ICD-10 code" required>
            <input
              value={icdCode}
              onChange={(e) => setIcdCode(e.target.value)}
              placeholder="E66.01"
              required
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </Field>
          <Field label="PCN" required>
            <input
              value={pcn}
              onChange={(e) => setPcn(e.target.value)}
              placeholder="A4"
              required
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </Field>
          <Field label="Member ID">
            <input
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              placeholder="4XS1234567"
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </Field>

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="h-10 w-full rounded-md bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-60 transition-colors inline-flex items-center justify-center"
            >
              {loading ? (
                <>
                  <span className="mr-2 inline-block size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Resolving…
                </>
              ) : (
                'Get clinical questions'
              )}
            </button>
            {error && (
              <span role="alert" className="text-[13px] text-red-600">
                {error}
              </span>
            )}
          </div>
        </form>

        <div className="mt-10">
          {response && <RoutingSummary response={response} />}

          <div className="mt-8 mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[13px] font-mono uppercase tracking-[0.18em] text-zinc-500">
              Questions
            </h2>
            {usingFallback && (
              <span className="text-[11px] font-mono uppercase tracking-[0.15em] text-zinc-400">
                Example tree
              </span>
            )}
          </div>

          <DecisionTreeRenderer
            key={treeToRender.decision_tree_id || 'fallback'}
            tree={treeToRender}
          />

          {response && (
            <details className="mt-10 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-mono uppercase tracking-[0.18em] text-zinc-500">
                Raw response
              </summary>
              <pre className="mt-3 max-h-[420px] overflow-auto rounded bg-white border border-zinc-200 p-3 text-[12px] leading-[1.5] text-zinc-700">
                {JSON.stringify(response, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-zinc-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function RoutingSummary({ response }: { response: ClinicalQuestionsResponse }) {
  const r = response.routing || {};
  const rows: Array<[string, string | undefined]> = [
    ['Matched', response.matched === undefined ? undefined : String(response.matched)],
    ['Coverage', response.coverage_status],
    ['LOB', r.line_of_business],
    ['PBM', r.pbm_name],
    ['Plan / group', r.plan_name_or_group],
    [
      'Confidence',
      r.confidence === undefined
        ? undefined
        : typeof r.confidence === 'number'
        ? r.confidence.toFixed(2)
        : String(r.confidence),
    ],
  ];

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 mb-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
        {rows
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {k}
              </span>
              <span className="text-[14px] text-zinc-800 tabular-nums">{v}</span>
            </div>
          ))}
      </div>
      {response.rationale && (
        <p className="mt-4 text-[13px] leading-[1.6] text-zinc-600 text-pretty">
          {response.rationale}
        </p>
      )}
    </div>
  );
}
