# Clinical question search — example app

A minimal Next.js 16 app that demonstrates Simplex's `/get_clinical_questions`
endpoint and the `<DecisionTreeRenderer />` component.

You enter a pharmacy claim tuple (BIN, PCN, State, Drug, ICD-10, optional
Member ID). The server resolves it to the payer's clinical question tree and
the UI walks you through the questions with a live "Likely approved / likely
denied" verdict and inline policy citations.

## Run it

```bash
cp .env.example .env.local
# paste your SIMPLEX_API_KEY into .env.local
npm install
npm run dev
```

Open http://localhost:3000.

Submit the form with a pharmacy claim tuple and the page renders whatever
decision tree the backend resolves it to, with the live verdict banner and
policy citations.

## What's in here

```
src/
├── app/
│   ├── page.tsx                     form + results
│   ├── layout.tsx
│   ├── globals.css                  Tailwind + form-input defaults
│   └── api/clinical-questions/
│       └── route.ts                 proxy to /get_clinical_questions
└── components/
    └── decision-tree-renderer.tsx   the reusable component
```

## `<DecisionTreeRenderer />`

The star of the show. One self-contained file (`src/components/decision-tree-renderer.tsx`),
React + Tailwind only, no other runtime deps. Drop it into any Next.js / React
app and pass a decision-tree JSON in.

```tsx
import {
  DecisionTreeRenderer,
  type DecisionTreeDoc,
} from './decision-tree-renderer';

<DecisionTreeRenderer
  tree={treeJson}                       // required
  initialAnswers={{ indication: 'wm_adult' }}
  onAnswersChange={(next) => console.log(next)}
  showSource={true}                     // policy source strip (default true)
  showAnswers={true}                    // live-state panel (default true)
  className="..."
/>
```

It ports the semantics of `pa_resolver_lib`'s reference
`tools/decision_tree_renderer.html`:

- **Visibility engine** — `eq`, `in`, `answered`, `not_answered`, `gte`, `lte`,
  `between`. Coerces `"yes"` / `true` and `"no"` / `false` so trees that
  encode boolean comparisons still drive radio inputs that store strings.
- **Threshold evaluator** — `>=`, `<=`, `>`, `<`, `==`, `between` plus the
  `gte`/`lte`/`gt`/`lt`/`eq` aliases the real trees use. Renders an inline
  green/red status (`expects >= 10 years`) next to number fields.
- **Verdict computation** — walks visible required nodes and classifies each
  as pass / fail / pending, then aggregates:
  - **Likely approved** (green) — every required node passes.
  - **Likely denied** (red) — at least one required node fails; the banner
    lists the failing criteria each with its own `p.N` citation link.
  - **Pending** — nothing shown yet.
- **Citations** — compact `p.N` badges that deep-link to the source policy
  PDF (via `citation_url` or `source_url`) with a native-title tooltip
  showing the verbatim quote.

The disclaimer at the bottom of the verdict banner — *"Heuristic —
evaluates visible required nodes only. Not a coverage decision."* — is
important. The verdict is a UI affordance, not a plan determination.

## API route

`src/app/api/clinical-questions/route.ts` is a thin server-side proxy so the
`SIMPLEX_API_KEY` never ships to the browser. It accepts a POST with JSON
body from the client and forwards as a GET with query params and an
`x-api-key` header per the backend's OpenAPI spec.

Required env:

| Key | Purpose |
|---|---|
| `SIMPLEX_API_KEY` | Your Simplex API key. |
| `SIMPLEX_API_URL` | Optional override for the backend base URL. |

## License

See upstream Simplex product for terms.
