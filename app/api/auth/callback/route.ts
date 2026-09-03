import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kteobfyferrukqeolofj.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';


/**
 * 2026-09-04: OPEN REDIRECT FIXED ON THE BRANCH THAT ACTUALLY DEPLOYS.
 *
 *   return NextResponse.redirect(new URL(redirectTo, requestUrl.origin));
 *
 * `new URL(x, base)` ignores the base entirely when x is absolute, so
 * ?redirect_to=https://attacker.example sent the freshly-authenticated visitor
 * straight there. Javari Verify found it live on ops.craudiovizai.com and the
 * redirect was reproduced by hand before this change.
 *
 * WHY IT SURVIVED THE FIRST SWEEP. Four repositories were patched on 3 September
 * and this one was not, because Vercel deploys this project from
 * `production-locked` while `main` and `production` both exist and neither is
 * what serves the site. A fix on the wrong branch is not a fix, and nothing about
 * the running system says which branch it came from.
 *
 * The guard answers yes or no and never cleans. A validator that tries to
 * sanitise a hostile string keeps losing to the next encoding trick.
 */
function safeRedirectPath(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '/';
  if (raw.includes('\\')) return '/';
  return raw;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const redirectTo = safeRedirectPath(requestUrl.searchParams.get('redirect_to'));

  if (code) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('Auth callback error:', error);
      return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error.message)}`, requestUrl.origin));
    }
  }

  return NextResponse.redirect(new URL(redirectTo, requestUrl.origin));
}
