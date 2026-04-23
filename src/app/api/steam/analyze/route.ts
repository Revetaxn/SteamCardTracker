import { NextRequest } from 'next/server'

/**
 * STEAM CARD TRACKER - CORE SCANNING ENGINE (REWRITTEN FROM SCRATCH)
 * Handles: Library Discovery, Card Game Filtering, and Rate-Limited Market Price Fetching.
 */

export const maxDuration = 300 // 5 Minute timeout for Vercel/Next.js
export const dynamic = 'force-dynamic'

// ===== TYPES =====
interface CardInfo {
  name: string
  price: number
  priceText: string
  isFoil: boolean
  imageUrl: string
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

// ===== UTILS: FETCHING & RETRY =====
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 15000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...options.headers,
      }
    })
    return response
  } finally {
    clearTimeout(id)
  }
}

// ===== 1. DISCOVERY ENGINE =====

async function getProfileInfo(baseUrl: string): Promise<ProfileInfo | null> {
  try {
    const html = await (await fetchWithTimeout(baseUrl)).text()
    const dataMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
    if (!dataMatch) return null

    const data = JSON.parse(dataMatch[1])
    const countMatch = html.match(/Games[^<]*<[^>]*>\s*<[^>]*>\s*(\d+)/)?.[1] || html.match(/(\d+)\s*games?\s*owned/i)?.[1] || '0'
    const avatar = html.match(/<link rel="image_src" href="([^"]+)"/)?.[1] || ''

    return {
      steamId: data.steamid,
      personaName: data.personaname,
      avatarUrl: avatar,
      profileUrl: data.url,
      gameCount: parseInt(countMatch)
    }
  } catch { return null }
}

async function discoverGames(baseUrl: string, steamId: string, apiKey?: string) {
  const found = new Map<number, string>() // appId -> name

  const clean = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim()

  // A. XML SCAN (Most reliable for all AppIDs)
  try {
    const xmlUrl = `${baseUrl}/games?xml=1`.replace(/\/+/g, '/')
    const xml = await (await fetchWithTimeout(xmlUrl)).text()
    const matches = xml.matchAll(/<game>\s*<appID>(\d+)<\/appID>\s*<name>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/name>/gs)
    for (const m of matches) found.set(parseInt(m[1]), clean(m[2]))
  } catch { }

  // B. WEB API SCAN (If key provided)
  if (apiKey && apiKey !== 'undefined') {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&format=json`
      const data = await (await fetchWithTimeout(url)).json()
      const games = data.response?.games || []
      games.forEach((g: any) => found.set(g.appid, clean(g.name)))
    } catch { }
  }

  // C. HTML GAMES PAGE SCAN (Fallback)
  try {
    const html = await (await fetchWithTimeout(`${baseUrl}/games/?tab=all`.replace(/\/+/g, '/'))).text()
    const rgMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (rgMatch) {
      const gList = JSON.parse(rgMatch[1])
      gList.forEach((g: any) => found.set(g.appid, clean(g.name)))
    }
  } catch { }

  return found
}

async function discoverBadges(baseUrl: string) {
  const cardGames = new Map<number, string>()
  const clean = (s: string) => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim()

  for (let p = 1; p <= 50; p++) {
    try {
      const url = `${baseUrl}/badges/?p=${p}`.replace(/\/+/g, '/')
      const html = await (await fetchWithTimeout(url)).text()
      const matches = [...html.matchAll(/gamecards\/(\d+)\//g)]
      if (matches.length === 0) break

      let pageAdded = 0
      matches.forEach(m => {
        const appId = parseInt(m[1])
        if (!cardGames.has(appId)) {
          const context = html.substring(m.index! - 500, m.index! + 1000)
          const name = context.match(/badge_title"[^>]*>\s*([\s\S]*?)\s*(?:&nbsp;|<\/div>)/i)?.[1] || `Game ${appId}`
          cardGames.set(appId, clean(name))
          pageAdded++
        }
      })
      if (pageAdded === 0 && p > 1) break
    } catch { break }
  }
  return cardGames
}

// ===== 2. FILTERING ENGINE =====

async function filterCardEligible(appIds: number[]) {
  const confirmed: number[] = []
  const batchSize = 50

  for (let i = 0; i < appIds.length; i += batchSize) {
    const batch = appIds.slice(i, i + batchSize)
    const url = `https://store.steampowered.com/api/appdetails?appids=${batch.join(',')}&filters=categories`
    try {
      const data = await (await fetchWithTimeout(url)).json()
      batch.forEach(id => {
        if (data[id]?.success && data[id]?.data?.categories?.some((c: any) => c.id === 29)) {
          confirmed.push(id)
        }
      })
    } catch { }
  }
  return confirmed
}

// ===== 3. MARKET ENGINE =====

async function getCardPrices(appId: number) {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const data = await (await fetchWithTimeout(url, { headers: { 'Referer': 'https://steamcommunity.com/market/' } })).json()
    if (!data?.success || !data.results) return null

    const normalCards: CardInfo[] = []
    const foilCards: CardInfo[] = []

    data.results.forEach((item: any) => {
      const isFoil = (item.hash_name || '').includes('(Foil)')
      const card = {
        name: item.name,
        price: item.sell_price / 100,
        priceText: item.sell_price_text,
        isFoil,
        imageUrl: `https://community.akamai.steamstatic.com/economy/image/${item.asset_description?.icon_url_large || item.asset_description?.icon_url}/62fx62f`
      }
      if (isFoil) foilCards.push(card)
      else normalCards.push(card)
    })

    return { normalCards, foilCards }
  } catch { return null }
}

// ===== MAIN HANDLER =====

export async function POST(request: NextRequest) {
  try {
    const { url, apiKey, excludeIds = [], limit = 100 } = await request.json()

    // Parse URL
    let type: 'id' | 'profiles' = 'profiles'
    let value = ''
    if (url.includes('/id/')) { type = 'id'; value = url.match(/\/id\/([^/?\s]+)/)?.[1] || '' }
    else if (url.includes('/profiles/')) { type = 'profiles'; value = url.match(/\/profiles\/(\d+)/)?.[1] || '' }
    else if (/^\d{17}$/.test(url.trim())) { value = url.trim() }

    if (!value) return new Response(JSON.stringify({ error: 'Invalid Steam URL' }), { status: 400 })
    const baseUrl = `https://steamcommunity.com/${type}/${value}`

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { } }

        try {
          // 1. Get Profile
          send({ type: 'status', message: 'Profil kütüphanesi saptanıyor...' })
          const pInfo = await getProfileInfo(baseUrl)
          if (!pInfo) { send({ type: 'error', message: 'Profil gizli veya bulunamadı.' }); return controller.close() }

          // 2. Discover ALL games
          send({ type: 'status', message: 'Kütüphane taranıyor...' })
          const [fullLibrary, badgeGames] = await Promise.all([
            discoverGames(baseUrl, pInfo.steamId, apiKey),
            discoverBadges(baseUrl)
          ])

          // 3. Filter for candidates
          send({ type: 'status', message: 'Filtreler uygulanıyor...' })
          const uniqueIds = Array.from(fullLibrary.keys())
          const storeConfirmed = await filterCardEligible(uniqueIds)

          const scanMap = new Map<number, string>()
          // Priority: Badge Games > Store Confirmed
          badgeGames.forEach((name, id) => scanMap.set(id, name))
          storeConfirmed.forEach(id => { if (!scanMap.has(id)) scanMap.set(id, fullLibrary.get(id) || `Game ${id}`) })

          // Exclude already scanned
          const excludeSet = new Set(excludeIds)
          const candidates = Array.from(scanMap.keys())
            .filter(id => !excludeSet.has(id))
            .map(id => ({ appId: id, gameName: scanMap.get(id)! }))

          console.log(`[Discovery] Unique:${fullLibrary.size} | Candidates:${scanMap.size} | New:${candidates.length}`)

          if (candidates.length === 0) {
            send({ type: 'complete', data: { profile: pInfo, games: [], hasMore: false } })
            return controller.close()
          }

          // 4. Market Scan Loop
          send({ type: 'status', message: `${candidates.length} yeni oyun için fiyatlar çekiliyor...` })
          const gameCards: any[] = []

          for (let i = 0; i < candidates.length; i++) {
            if (i >= limit) break // Respect batch limit

            const game = candidates[i]
            if (i > 0) await new Promise(r => setTimeout(r, 1400)) // Safe IP limit interval

            const prices = await getCardPrices(game.appId)
            if (prices && prices.normalCards.length > 0) {
              const res = {
                appId: game.appId, gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                normalCards: prices.normalCards,
                foilCards: prices.foilCards,
                highestCardPrice: Math.max(...prices.normalCards.map(c => c.price)),
                totalNormalCards: prices.normalCards.length,
                droppableCardsValue: (prices.normalCards.reduce((s, c) => s + c.price, 0) / prices.normalCards.length) * Math.ceil(prices.normalCards.length / 2),
                hasCardDrops: true
              }
              gameCards.push(res)
              send({ type: 'game', data: res })
            }

            // Progress update
            send({
              type: 'progress',
              current: i + 1 + excludeIds.length,
              total: candidates.length + excludeIds.length,
              found: gameCards.length,
              message: `${i + 1 + excludeIds.length}/${candidates.length + excludeIds.length}`
            })
          }

          gameCards.sort((a, b) => b.droppableCardsValue - a.droppableCardsValue)
          send({ type: 'complete', data: { profile: pInfo, games: gameCards, hasMore: candidates.length > limit } })
          controller.close()

        } catch (err) {
          console.error(err)
          send({ type: 'error', message: 'Tarama sırasında bir hata oluştu.' })
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 })
  }
}
