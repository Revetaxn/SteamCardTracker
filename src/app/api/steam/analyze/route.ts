import { NextResponse } from 'next/server'

// ===== UTILS =====
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 15000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(id)
    return response
  } catch (e) {
    clearTimeout(id)
    throw e
  }
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

// ===== DISCOVERY ENGINE =====
async function discoverGames(baseUrl: string, apiKey?: string, steamId64?: string) {
  const found = new Map<number, { name: string }>()
  const clean = (s: string) => s.replace(/Steam Card Beta/i, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()

  // Tier 1: Web API
  if (apiKey && steamId64 && apiKey !== 'undefined') {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId64}&include_appinfo=1&format=json`
      const data = await (await fetchWithTimeout(url)).json()
      data.response?.games?.forEach((g: any) => {
        if (!found.has(g.appid)) found.set(g.appid, { name: clean(g.name || `App ${g.appid}`) })
      })
    } catch { }
  }

  if (found.size < 10) {
    // Tier 2: HTML Library Page
    try {
      const html = await (await fetchWithTimeout(`${baseUrl}/games/?tab=all`.replace(/\/+/g, '/'))).text()
      const rgMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
      if (rgMatch) {
        const gList = JSON.parse(rgMatch[1])
        gList.forEach((g: any) => {
          if (!found.has(g.appid)) found.set(g.appid, { name: clean(g.name) })
        })
      }
    } catch { }
  }

  if (found.size === 0) {
    // Tier 3: XML Library Page
    try {
      const xml = await (await fetchWithTimeout(`${baseUrl}/games/?xml=1`.replace(/\/+/g, '/'))).text()
      const appIds = [...xml.matchAll(/<appID>(\d+)<\/appID>/g)].map(m => parseInt(m[1]))
      const names = [...xml.matchAll(/<name><!\[CDATA\[(.*?)\]\]><\/name>/g)].map(m => m[1])
      appIds.forEach((id, i) => {
        if (!found.has(id)) found.set(id, { name: clean(names[i] || `App ${id}`) })
      })
    } catch { }
  }

  return Array.from(found.entries()).map(([id, info]) => ({ appId: id, gameName: info.name }))
}

// ===== BULK CATEGORY CHECK (SAVES MARKET CALLS) =====
async function getEligibleAppIds(appIds: number[]): Promise<Set<number>> {
  const eligible = new Set<number>()
  if (appIds.length === 0) return eligible

  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appIds.join(',')}&filters=categories`
    const resp = await fetchWithTimeout(url)
    const data = await resp.json()

    appIds.forEach(id => {
      const app = data[id.toString()]
      if (app?.success && app.data?.categories) {
        const hasCards = app.data.categories.some((c: any) => c.id === 29) // 29 = Trading Cards
        if (hasCards) eligible.add(id)
      }
    })
  } catch (e) {
    console.error('Bulk check failed:', e)
    // If bulk fails, we fallback to conservative: assume eligible to be checked by market 
    // BUT we want to avoid ban, so maybe only return those already found?
  }
  return eligible
}

// ===== MARKET ENGINE (WITH RETRY & RATE LIMIT DETECTION) =====
async function getCardPrices(appId: number, retryCount = 0): Promise<any> {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=15&currency=1&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const resp = await fetchWithTimeout(url, { headers: { 'Referer': 'https://steamcommunity.com/market/' } })

    if (resp.status === 429 || resp.status === 403) {
      if (retryCount < 2) {
        await delay(5000 * (retryCount + 1))
        return getCardPrices(appId, retryCount + 1)
      }
      return { _error: 'Rate Limit' }
    }

    const data = await resp.json()
    if (!data?.success) {
      if (retryCount < 2) {
        await delay(3000)
        return getCardPrices(appId, retryCount + 1)
      }
      return null
    }

    if (!data.results || data.results.length === 0) return null

    const normalCards: any[] = []
    const foilCards: any[] = []

    data.results.forEach((item: any) => {
      const tags = (item.asset_description?.tags || []).map((t: any) => t.internal_name)
      const isFoil = tags.includes('cardborder_1') || (item.hash_name || '').toLowerCase().includes('foil')

      const card = {
        name: item.name,
        price: item.sell_price / 100,
        priceText: item.sell_price_text || `$${(item.sell_price / 100).toFixed(2)}`,
        isFoil,
        imageUrl: `https://community.akamai.steamstatic.com/economy/image/${item.asset_description?.icon_url_large || item.asset_description?.icon_url}/62fx62f`
      }
      if (isFoil) foilCards.push(card)
      else normalCards.push(card)
    })

    return { normalCards, foilCards }
  } catch {
    if (retryCount < 1) {
      await delay(2000)
      return getCardPrices(appId, retryCount + 1)
    }
    return null
  }
}

// ===== MAIN ROUTE =====
export async function POST(req: Request) {
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const send = (data: any) => {
    try { writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { }
  }

  const body = await req.json()
  const { url: profileUrl, apiKey, excludeIds = [], limit = 100 } = body
  const excludedSet = new Set(excludeIds.map((id: any) => parseInt(id)))

  const run = async () => {
    try {
      send({ type: 'status', message: 'Kütüphane taranıyor...' })

      let stemId64 = ''
      let baseUrl = ''

      if (profileUrl.includes('/profiles/')) {
        stemId64 = profileUrl.match(/\/profiles\/(\d+)/)?.[1] || ''
        baseUrl = `https://steamcommunity.com/profiles/${stemId64}`
      } else {
        const vanity = profileUrl.match(/\/id\/([^\/]+)/)?.[1] || profileUrl
        const resolveUrl = `https://steamcommunity.com/id/${vanity}/?xml=1`
        const xml = await (await fetchWithTimeout(resolveUrl)).text()
        stemId64 = xml.match(/<steamID64>(\d+)<\/steamID64>/)?.[1] || ''
        baseUrl = `https://steamcommunity.com/id/${vanity}`
      }

      if (!stemId64) throw new Error('Geçersiz Profil URL')

      const library = await discoverGames(baseUrl, apiKey, stemId64)
      const filtered = library.filter(g => !excludedSet.has(g.appId))

      send({
        type: 'discovery',
        count: library.length,
        profile: { steamId: stemId64, personaName: 'Steam User', profileUrl: baseUrl }
      })

      send({ type: 'progress', current: 0, total: filtered.length, found: library.length, cardGames: 0, totalPotentialDrops: 0 })

      let processed = 0
      let cardEligibleCount = 0
      let totalPotentialDrops = 0

      // Step 1: Pre-verify IDs in batches of 20 to avoid Market bans
      const gameSubset = filtered.slice(0, limit)
      const subAppIds = gameSubset.map(g => g.appId)

      send({ type: 'status', message: 'Kartlı oyunlar doğrulanıyor (Store API)...' })
      const hotList = new Set<number>()
      for (let i = 0; i < subAppIds.length; i += 20) {
        const batch = subAppIds.slice(i, i + 20)
        const eligible = await getEligibleAppIds(batch)
        eligible.forEach(id => hotList.add(id))
        await delay(500) // Politeness for Store API
      }

      // Step 2: Only Hit Market for HotList
      for (const game of gameSubset) {
        processed++

        if (hotList.has(game.appId)) {
          send({ type: 'status', message: `Pazar Analizi: ${game.gameName}` })
          const prices = await getCardPrices(game.appId)

          if (prices && !prices._error) {
            cardEligibleCount++
            const normalAvg = prices.normalCards.length > 0 ? (prices.normalCards.reduce((s, c) => s + c.price, 0) / prices.normalCards.length) : 0
            const foilAvg = prices.foilCards.length > 0 ? (prices.foilCards.reduce((s, c) => s + c.price, 0) / prices.foilCards.length) : 0

            const totalCardsInSet = Math.max(prices.normalCards.length, 8)
            const droppableCount = Math.ceil(totalCardsInSet / 2)
            totalPotentialDrops += droppableCount

            send({
              type: 'game',
              data: {
                appId: game.appId,
                gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                normalCards: prices.normalCards,
                foilCards: prices.foilCards,
                highestCardPrice: Math.max(...[...prices.normalCards, ...prices.foilCards].map(c => c.price)),
                totalNormalCards: totalCardsInSet,
                droppableCardsValue: normalAvg * droppableCount,
                foilCardsValue: foilAvg,
                hasCardDrops: true
              }
            })
          }
          await delay(1300) // Politeness for Market API
        }

        send({
          type: 'progress',
          current: processed,
          total: filtered.length,
          found: library.length,
          cardGames: cardEligibleCount,
          totalPotentialDrops: totalPotentialDrops
        })
      }

      send({ type: 'complete' })

    } catch (e: any) {
      send({ type: 'error', message: e.message })
    } finally {
      writer.close()
    }
  }

  run()
  return new NextResponse(stream.readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  })
}
