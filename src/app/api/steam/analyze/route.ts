import { NextRequest } from 'next/server'

export const maxDuration = 300 // 5 minutes
export const dynamic = 'force-dynamic'

// ===== Types =====
interface CardInfo {
  name: string
  price: number
  priceText: string
  isFoil: boolean
  imageUrl: string
  hashName: string
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

// ===== Helper: Fetch with retry (exponential backoff) =====
async function fetchWithRetry(
  url: string,
  options: RequestInit & { signal?: AbortSignal } = {},
  maxRetries = 2,
  baseDelay = 1500
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(15000),
      })
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          let delay = baseDelay * Math.pow(2, attempt)
          console.log(`[Retry] ${response.status} for ${url.substring(0, 80)}...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }
      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`)
}

async function fetchPageHtml(url: string, timeout = 15000): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(timeout),
  }, 2, 1000)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.text()
}

// ===== Helper: Bulk Check games via Store API (50 per call) =====
async function bulkCheckGamesForCards(appIds: number[]) {
  const confirmed: number[] = []
  const others: number[] = []
  const batchSize = 50

  for (let i = 0; i < appIds.length; i += batchSize) {
    const batch = appIds.slice(i, i + batchSize)
    const url = `https://store.steampowered.com/api/appdetails?appids=${batch.join(',')}&filters=categories`
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!resp.ok) { batch.forEach(id => others.push(id)); continue }
      const data = await resp.json()
      batch.forEach(id => {
        if (data && data[id]?.success && data[id]?.data?.categories) {
          if (data[id].data.categories.some((c: any) => c.id === 29)) confirmed.push(id)
          else others.push(id)
        } else {
          others.push(id)
        }
      })
    } catch { batch.forEach(id => others.push(id)) }
  }
  return { confirmed, others }
}

function parseSteamUrl(url: string) {
  const idMatch = url.match(/steamcommunity\.com\/id\/([^/?\s]+)/)
  if (idMatch) return { type: 'id', value: idMatch[1] }
  const profileMatch = url.match(/steamcommunity\.com\/profiles\/(\d+)/)
  if (profileMatch) return { type: 'profiles', value: profileMatch[1] }
  if (/^\d{17}$/.test(url.trim())) return { type: 'profiles', value: url.trim() }
  return null
}

function cleanGameName(raw: string) {
  return raw.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim()
}

function parseProfileInfo(html: string): ProfileInfo | null {
  const profileMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
  if (!profileMatch) return null
  try {
    const data = JSON.parse(profileMatch[1])
    const avatar = html.match(/<link rel="image_src" href="([^"]+)"/)?.[1] || ''
    const gCount = html.match(/Games[^<]*<[^>]*>\s*<[^>]*>\s*(\d+)/)?.[1] || html.match(/(\d+)\s*games?\s*owned/i)?.[1] || '0'
    return { steamId: data.steamid, personaName: data.personaname, avatarUrl: avatar, profileUrl: data.url, gameCount: parseInt(gCount) }
  } catch { return null }
}

function parseBadgesPage(html: string) {
  const games: any[] = []
  const pattern = /gamecards\/(\d+)\//g
  let match
  const seen = new Set()
  while ((match = pattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    if (!appId || seen.has(appId)) continue
    seen.add(appId)
    const context = html.substring(Math.max(0, match.index - 500), match.index + 1000)
    let gName = context.match(/badge_title"[^>]*>\s*([\s\S]*?)\s*(?:&nbsp;|<\/div>)/i)?.[1]
      || context.match(/badge_row_type[^>]*>\s*([\s\S]*?)\s*<\/div>/i)?.[1]
      || `Game ${appId}`
    games.push({ appId, gameName: cleanGameName(gName) })
  }
  return games
}

function parseSteamGamesPage(html: string) {
  const rgMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!rgMatch) return []
  try {
    return JSON.parse(rgMatch[1]).map((g: any) => ({ appId: g.appid, gameName: cleanGameName(g.name) }))
  } catch { return [] }
}

async function fetchGamesFromXML(baseUrl: string) {
  try {
    const xmlUrl = baseUrl.endsWith('/') ? `${baseUrl}games?xml=1` : `${baseUrl}/games?xml=1`
    const html = await fetchPageHtml(xmlUrl)
    const games: any[] = []
    const pattern = /<game>\s*<appID>(\d+)<\/appID>\s*<name>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/name>/gs
    let match
    while ((match = pattern.exec(html)) !== null) {
      games.push({ appId: parseInt(match[1]), gameName: cleanGameName(match[2]) })
    }
    return games
  } catch { return [] }
}

async function fetchOwnedGamesViaAPI(steamId: string, apiKey: string) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&format=json`
  const resp = await fetch(url)
  if (!resp.ok) return []
  const data = await resp.json()
  return (data.response?.games || []).map((g: any) => ({ appId: g.appid, gameName: cleanGameName(g.name) }))
}

async function fetchCardPrices(appId: number, gameName: string) {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return { normalCards: [], foilCards: [], failed: true }
    const data = await resp.json()
    if (!data?.success) return { normalCards: [], foilCards: [], failed: true }

    const normal: any[] = []
    const foil: any[] = []
    data.results.forEach((item: any) => {
      const isFoil = (item.hash_name || '').includes('(Foil)')
      const card = {
        name: item.name, price: item.sell_price / 100, priceText: item.sell_price_text, isFoil,
        imageUrl: `https://community.akamai.steamstatic.com/economy/image/${item.asset_description?.icon_url_large || item.asset_description?.icon_url}/62fx62f`
      }
      if (isFoil) foil.push(card)
      else normal.push(card)
    })
    return { normalCards: normal, foilCards: foil, failed: false }
  } catch { return { normalCards: [], foilCards: [], failed: true } }
}

// ===== Main POST Handler =====
export async function POST(request: NextRequest) {
  try {
    const { url, apiKey, excludeIds = [], limit = 100 } = await request.json()
    const parsed = parseSteamUrl(url)
    if (!parsed) return new Response(JSON.stringify({ error: 'invalid url' }), { status: 400 })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { } }

        try {
          send({ type: 'status', message: 'Profil kütüphanesi taranıyor...' })
          const baseUrl = parsed.type === 'id' ? `https://steamcommunity.com/id/${parsed.value}/` : `https://steamcommunity.com/profiles/${parsed.value}/`
          const pInfo = parseProfileInfo(await fetchPageHtml(baseUrl))
          if (!pInfo) { send({ type: 'error', message: 'Profil gizli veya hatalı.' }); return controller.close() }

          // Discovery Phase (Restored full Omni-Discovery)
          send({ type: 'status', message: 'Kütüphane listesi alınıyor...' })
          const [apiG, xmlG, scrapeG] = await Promise.all([
            (apiKey?.trim() && apiKey !== 'undefined') ? fetchOwnedGamesViaAPI(pInfo.steamId, apiKey.trim()).catch(() => []) : Promise.resolve([]),
            fetchGamesFromXML(baseUrl).catch(() => []),
            fetchPageHtml(`${baseUrl}games/?tab=all`).then(html => parseSteamGamesPage(html)).catch(() => [])
          ])

          send({ type: 'status', message: 'Rozetler taranıyor...' })
          const badgeG: any[] = []
          for (let p = 1; p <= 50; p++) {
            const pHtml = await fetchPageHtml(`${baseUrl}badges/?p=${p}`).catch(() => '')
            if (!pHtml) break
            const pG = parseBadgesPage(pHtml)
            if (pG.length === 0) break
            let added = 0
            pG.forEach(g => { if (!badgeG.some(e => e.appId === g.appId)) { badgeG.push(g); added++ } })
            if (added === 0 && p > 1) break
          }

          const lib = new Map()
          apiG.forEach((g: any) => lib.set(g.appId, g.gameName))
          xmlG.forEach((g: any) => lib.set(g.appId, g.gameName))
          scrapeG.forEach((g: any) => lib.set(g.appId, g.gameName))
          badgeG.forEach((g: any) => lib.set(g.appId, g.gameName))

          const rawIds = Array.from(lib.keys())
          console.log(`[Discovery] Unique Library: ${rawIds.length}`)

          send({ type: 'status', message: `${rawIds.length} oyun filtreleniyor...` })
          const { confirmed, others } = await bulkCheckGamesForCards(rawIds)

          // OMNI-CANDIDATES
          const scanMap = new Map()
          // 1. Badge games (100% cards)
          badgeG.forEach(g => scanMap.set(g.appId, g.gameName))
          // 2. Store confirmed
          confirmed.forEach(id => { if (!scanMap.has(id)) scanMap.set(id, lib.get(id) || `Game ${id}`) })
          // 3. Fallback others (top 50)
          others.slice(0, 50).forEach(id => { if (!scanMap.has(id)) scanMap.set(id, lib.get(id) || `Game ${id}`) })

          const excludeSet = new Set(excludeIds)
          const candidates = Array.from(scanMap.keys())
            .filter(id => !excludeSet.has(id))
            .map(id => ({ appId: id, gameName: scanMap.get(id) }))

          console.log(`[Discovery] Full Candidates: ${candidates.length} (Excluded: ${excludeIds.length})`)
          send({ type: 'status', message: `${candidates.length} kartlı oyun taranacak...` })

          if (candidates.length === 0) {
            send({ type: 'complete', data: { profile: pInfo, games: [], hasMore: false } })
            return controller.close()
          }

          const gameCards: any[] = []
          for (let i = 0; i < candidates.length; i++) {
            if (i >= limit) break

            const game = candidates[i]
            if (i > 0) await new Promise(r => setTimeout(r, 1300))

            const { normalCards, foilCards, failed } = await fetchCardPrices(game.appId, game.gameName)
            if (!failed && normalCards.length > 0) {
              const res = {
                appId: game.appId, gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                normalCards, foilCards,
                highestCardPrice: normalCards[0].price,
                totalNormalCards: normalCards.length,
                droppableCardsValue: (normalCards.reduce((s, c) => s + c.price, 0) / normalCards.length) * Math.ceil(normalCards.length / 2),
                hasCardDrops: true
              }
              gameCards.push(res); send({ type: 'game', data: res })
            }
            send({ type: 'progress', current: i + 1 + excludeIds.length, total: candidates.length + excludeIds.length, found: gameCards.length, message: `${i + 1 + excludeIds.length}/${candidates.length + excludeIds.length}` })
          }

          gameCards.sort((a, b) => b.droppableCardsValue - a.droppableCardsValue)
          send({ type: 'complete', data: { profile: pInfo, games: gameCards, hasMore: candidates.length > limit } })
          controller.close()
        } catch (err) { console.error(err); send({ type: 'error', message: 'Hata oluştu.' }); controller.close() }
      }
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' } })
  } catch (e) { return new Response(JSON.stringify({ error: 'internal error' }), { status: 500 }) }
}
