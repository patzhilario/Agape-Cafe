const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders })
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: responseHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const { username, password } = await request.json()
    if (typeof username !== 'string' || typeof password !== 'string' || !password) {
      return json({ error: 'Enter your username and password.' }, 400)
    }
    const normalizedUsername = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_.]{2,29}$/.test(normalizedUsername)) {
      return json({ error: 'Invalid username or password.' }, 401)
    }

    const projectUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!projectUrl || !serviceKey || !publicKey) {
      return json({ error: 'Username login is unavailable. Use your email to log in.' }, 503)
    }

    const lookupUrl = new URL('/rest/v1/profiles', projectUrl)
    lookupUrl.search = new URLSearchParams({
      select: 'id',
      username: 'eq.' + normalizedUsername,
      limit: '1',
    }).toString()
    const lookup = await fetch(lookupUrl, {
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    })
    if (!lookup.ok) return json({ error: 'Login is temporarily unavailable.' }, 503)

    const profiles = await lookup.json()
    const profileId = profiles[0]?.id
    let email
    if (profileId) {
      // Resolve the current Auth email so a verified email change keeps username login working.
      const accountResponse = await fetch(new URL('/auth/v1/admin/users/' + profileId, projectUrl), {
        headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
      })
      if (!accountResponse.ok) return json({ error: 'Login is temporarily unavailable.' }, 503)
      const account = await accountResponse.json()
      email = (account.user || account).email
    }
    // Unknown usernames still go through Auth so password checks and Auth rate limits apply.
    const signIn = await fetch(new URL('/auth/v1/token?grant_type=password', projectUrl), {
      method: 'POST',
      headers: { apikey: publicKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || 'invalid-username@invalid.invalid', password }),
    })
    if (!signIn.ok || !email) {
      return json({ error: 'Invalid username or password. Verify your email before logging in.' }, signIn.status === 429 ? 429 : 401)
    }

    const session = await signIn.json()
    if (!session.access_token || !session.refresh_token || session.user?.id !== profileId || !session.user?.email_confirmed_at) {
      return json({ error: 'Verify your email before logging in.' }, 401)
    }
    return json({ access_token: session.access_token, refresh_token: session.refresh_token })
  } catch {
    return json({ error: 'Login could not be completed. Please try again.' }, 400)
  }
})
