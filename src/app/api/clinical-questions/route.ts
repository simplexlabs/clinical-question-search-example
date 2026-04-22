import { NextRequest, NextResponse } from 'next/server';

// Thin proxy to Simplex's /get_clinical_questions. The route is here so the
// SIMPLEX_API_KEY never leaves the server — the browser POSTs JSON to this
// route, which translates to an upstream GET with query params and an
// x-api-key header, per the backend's OpenAPI spec.
//
// Required env:
//   SIMPLEX_API_KEY   — your Simplex API key
//   SIMPLEX_API_URL   — backend base URL (defaults to the dev API server)

const DEFAULT_API_URL =
  'https://simplex-dev--api-server-and-container-service-fastapi-app.modal.run';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return forward(body);
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  return forward(params);
}

async function forward(input: Record<string, unknown>) {
  const apiKey = process.env.SIMPLEX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'SIMPLEX_API_KEY is not set on the server.' },
      { status: 500 }
    );
  }

  const base = process.env.SIMPLEX_API_URL || DEFAULT_API_URL;

  const allowed = ['bin', 'state', 'drug_name', 'icd_code', 'pcn', 'group_id', 'member_id'];
  const qs = new URLSearchParams();
  for (const key of allowed) {
    const v = input[key];
    if (typeof v === 'string' && v.trim() !== '') qs.set(key, v.trim());
  }

  const url = `${base}/get_clinical_questions?${qs.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-key': apiKey },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    return NextResponse.json(
      {
        error: 'Failed to fetch clinical questions.',
        message:
          typeof detail === 'string'
            ? detail
            : detail != null
            ? JSON.stringify(detail)
            : (data as { error?: string; message?: string })?.message ||
              (data as { error?: string; message?: string })?.error ||
              'Unknown error.',
        details: data,
      },
      { status: response.status }
    );
  }

  return NextResponse.json(data);
}
