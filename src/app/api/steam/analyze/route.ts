import { NextResponse } from 'next/server'

// ===== UTILS =====
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 20000) {
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

  // Tier 3: XML Library Page
  try {
    const xml = await (await fetchWithTimeout(`${baseUrl}/games/?xml=1`.replace(/\/+/g, '/'))).text()
    const appIds = [...xml.matchAll(/<appID>(\d+)<\/appID>/g)].map(m => parseInt(m[1]))
    const names = [...xml.matchAll(/<name><!\[CDATA\[(.*?)\]\]><\/name>/g)].map(m => m[1])
    appIds.forEach((id, i) => {
      if (!found.has(id)) found.set(id, { name: clean(names[i] || `App ${id}`) })
    })
  } catch { }

  return Array.from(found.entries()).map(([id, info]) => ({ appId: id, gameName: info.name }))
}

// ===== MARKET ENGINE (SUPER ROBUST RETRY) =====
async function getCardPrices(appId: number, retryCount = 0): Promise<any> {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=15&currency=1&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const resp = await fetchWithTimeout(url, { headers: { 'Referer': 'https://steamcommunity.com/market/' } })

    // IF Rate Limited, WAIT and RETRY (Don't skip!)
    if (resp.status === 429 || resp.status === 403 || resp.status >= 500) {
      if (retryCount < 4) {
        const wait = 8000 * (retryCount + 1)
        await delay(wait)
        return getCardPrices(appId, retryCount + 1)
      }
      return { _error: 'Banned' }
    }

    const data = await resp.json()
    if (!data?.success) {
      if (retryCount < 3) {
        await delay(4000)
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
    if (retryCount < 2) {
      await delay(3000)
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
      send({ type: 'status', message: 'Kütüphane verileri çekiliyor...' })

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

      // Step 1: Pre-verify via Badges Page for MAXIMUM reliability
      const badgeIds = new Set<number>()
      try {
        send({ type: 'status', message: 'Rozet sayfası analiz ediliyor...' })
        const badgeHtml = await (await fetchWithTimeout(`${baseUrl}/badges/`)).text()
        const matches = badgeHtml.matchAll(/gamecards\/(\d+)/g)
        for (const m of matches) badgeIds.add(parseInt(m[1]))
      } catch { }

      const gameSubset = filtered.slice(0, limit)

      for (const game of gameSubset) {
        processed++

        // Always check if in badge list, OR always check others slightly slower
        send({ type: 'status', message: `Analiz: ${game.gameName}` })

        // If it's a known "No Cards" game (not in badges), we can still check but very carefully
        // FOR NOW: Let's follow the user's request: check EVERY game but be ROBUST
        const prices = await getCardPrices(game.appId)

        if (prices) {
          if (prices._error === 'Banned') {
            // Stop the stream or notify user? Let's notify and break
            send({ type: 'status', message: '!!! STEAM PAZAR ENGELİ !!! 10DK BEKLEYİN.' })
            break
          }

          if (prices.normalCards?.length > 0 || prices.foilCards?.length > 0) {
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
        }

        send({
          type: 'progress',
          current: processed,
          total: filtered.length,
          found: library.length,
          cardGames: cardEligibleCount,
          totalPotentialDrops: totalPotentialDrops
        })

        await delay(1650) // Increased delay for safety
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
