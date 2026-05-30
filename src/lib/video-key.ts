// Canonical dedup key for a video URL. Different URL forms of the SAME video
// (youtu.be vs watch?v=, with/without &list=/&t=, www vs non-www, param order,
// trailing slash) all collapse to one key so we never queue the same video twice.
//
// NOTE: keep this in sync with electron/services/video-key.ts (the renderer and
// main processes are compiled as separate projects, like types.ts/contracts.ts).

// Pure tracking/junk params that never identify content. NOTE: 'list'/'index'
// are deliberately excluded — for a single video (watch?v=X&list=Y) the YouTube
// branch already returns youtube:X before the fallback, while on a /playlist
// page 'list' IS the identifier, so stripping it would merge distinct playlists.
const JUNK_PARAMS = new Set([
  't', 'start', 'end', 'feature', 'si', 'pp', 'ab_channel',
  'spm', 'is_from_webapp', 'sender_device', 'web', '_r', '_t', 'igshid', 'igsh',
  'rdid', 'share_url', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign',
])

function segments(pathname: string): string[] {
  return pathname.replace(/\/+$/, '').split('/').filter(Boolean)
}

export function canonicalizeVideoKey(rawUrl: string): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return ''
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed.toLowerCase()
  }

  const rawHost = parsed.hostname.toLowerCase()
  const host = rawHost.replace(/^(www|m|mobile)\./, '')
  const seg = segments(parsed.pathname)

  // ---- YouTube ----
  if (host === 'youtu.be') {
    if (seg[0]) return `youtube:${seg[0]}`
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    const v = parsed.searchParams.get('v')
    if (v) return `youtube:${v}`
    if (['shorts', 'embed', 'live', 'v'].includes(seg[0]) && seg[1]) {
      return `youtube:${seg[1]}`
    }
  }

  // ---- TikTok ----
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const vIdx = seg.indexOf('video')
    if (vIdx >= 0 && seg[vIdx + 1]) return `tiktok:${seg[vIdx + 1]}`
    const pIdx = seg.indexOf('photo')
    if (pIdx >= 0 && seg[pIdx + 1]) return `tiktok:${seg[pIdx + 1]}`
    // Short links (vm./vt.tiktok.com/<code>) can't be resolved without a request.
    if ((rawHost.startsWith('vm.') || rawHost.startsWith('vt.')) && seg[0]) {
      return `tiktok-short:${seg[0]}`
    }
  }

  // ---- Instagram ----
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') {
    const kinds = ['reel', 'reels', 'p', 'tv']
    for (let i = 0; i < seg.length; i++) {
      if (kinds.includes(seg[i]) && seg[i + 1]) {
        return `instagram:${seg[i + 1]}`
      }
    }
  }

  // ---- Facebook ----
  if (host === 'fb.watch') {
    if (seg[0]) return `facebook-short:${seg[0]}`
  }
  if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
    const v = parsed.searchParams.get('v')
    if (v) return `facebook:${v}`
    const videosIdx = seg.indexOf('videos')
    if (videosIdx >= 0 && seg[videosIdx + 1]) return `facebook:${seg[videosIdx + 1]}`
    const reelIdx = seg.indexOf('reel')
    if (reelIdx >= 0 && seg[reelIdx + 1]) return `facebook:${seg[reelIdx + 1]}`
  }

  // ---- Fallback: drop junk params, sort the rest, drop hash, normalise host ----
  const params = [...parsed.searchParams.entries()]
    .filter(([key]) => !JUNK_PARAMS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : ''
  return `${host}/${seg.join('/')}${query}`
}
