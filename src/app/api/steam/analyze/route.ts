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
  const found = new Map<number, { name: string, hasCards: boolean, totalCards?: number }>()
  const clean = (s: string) => s.replace(/Steam Card Beta/i, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()

  // Tier 1: Web API
  if (apiKey && steamId64 && apiKey !== 'undefined') {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId64}&include_appinfo=1&format=json`
      const data = await (await fetchWithTimeout(url)).json()
      data.response?.games?.forEach((g: any) => {
        if (!found.has(g.appid)) found.set(g.appid, { name: clean(g.name || `App ${g.appid}`), hasCards: false })
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
        if (!found.has(g.appid)) found.set(g.appid, { name: clean(g.name), hasCards: false })
      })
    }
  } catch { }

  // Tier 3: XML Library Page
  try {
    const xml = await (await fetchWithTimeout(`${baseUrl}/games/?xml=1`.replace(/\/+/g, '/'))).text()
    const appIds = [...xml.matchAll(/<appID>(\d+)<\/appID>/g)].map(m => parseInt(m[1]))
    const names = [...xml.matchAll(/<name><!\[CDATA\[(.*?)\]\]><\/name>/g)].map(m => m[1])
    appIds.forEach((id, i) => {
      if (!found.has(id)) found.set(id, { name: clean(names[i] || `App ${id}`), hasCards: false })
    })
  } catch { }

  // Tier 4: Infinite Badge/Card Scraper (THE SOURCE OF TRUTH FOR CARD DROPS)
  for (let p = 1; p <= 30; p++) {
    try {
      const html = await (await fetchWithTimeout(`${baseUrl}/badges/?p=${p}`.replace(/\/+/g, '/'))).text()
      const rows = html.matchAll(/badge_row([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/sg)
      let foundOnPage = 0
      for (const row of rows) {
        const appIdMatch = row[1].match(/gamecards\/(\d+)/)
        const nameMatch = row[1].match(/badge_title">([\s\S]*?)(?:&nbsp;|<\/div>)/)
        const cardSetMatch = row[1].match(/(\d+)\s*(?:\/|of)\s*(\d+)\s*(?:Kart|cards)/i)

        if (appIdMatch) {
          const appId = parseInt(appIdMatch[1])
          const name = clean(nameMatch ? nameMatch[1].replace(/<[^>]+>/g, '').trim() : `App ${appId}`)
          const totalCardsInSet = cardSetMatch ? parseInt(cardSetMatch[2]) : 0

          found.set(appId, {
            name,
            hasCards: true,
            totalCards: totalCardsInSet
          })
          foundOnPage++
        }
      }
      if (foundOnPage === 0) break
    } catch { break }
  }

  // Derive final stats from the UNIQUE map entries
  let cardEligibleCount = 0
  let totalPotentialDrops = 0
  for (const entry of found.values()) {
    if (entry.hasCards) {
      cardEligibleCount++
      if (entry.totalCards) {
        totalPotentialDrops += Math.ceil(entry.totalCards / 2)
      }
    }
  }

  return {
    games: Array.from(found.entries()).map(([id, info]) => ({
      appId: id,
      gameName: info.name,
      hasCards: info.hasCards,
      totalCards: info.totalCards
    })),
    cardEligibleCount,
    totalPotentialDrops
  }
}

// ===== MARKET ENGINE =====
async function getCardPrices(appId: number) {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&currency=1&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const data = await (await fetchWithTimeout(url, { headers: { 'Referer': 'https://steamcommunity.com/market/' } })).json()
    if (!data?.success || !data.results) return null

    const normalCards: any[] = []
    const foilCards: any[] = []

    data.results.forEach((item: any) => {
      const tags = (item.asset_description?.tags || []).map((t: any) => t.internal_name)
      const isFoil = tags.includes('cardborder_1') ||
        (item.hash_name || '').toLowerCase().includes('foil') ||
        (item.name || '').toLowerCase().includes('(foil)')

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
  } catch { return null }
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
      send({ type: 'status', message: 'Keşif başlatılıyor...' })

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

      const discovery = await discoverGames(baseUrl, apiKey, stemId64)

      // The crucial filter: we only market-scan the card-eligible ones
      const filtered = discovery.games.filter(c => !excludedSet.has(c.appId) && c.hasCards)

      send({
        type: 'progress',
        current: 0,
        total: filtered.length,
        found: discovery.games.length,
        cardGames: discovery.cardEligibleCount,
        totalPotentialDrops: discovery.totalPotentialDrops
      })

      send({ type: 'complete', data: { profile: { steamId: stemId64, personaName: 'Steam User', avatarUrl: '', profileUrl: baseUrl, gameCount: discovery.games.length } } })

      let processed = 0
      for (const game of filtered) {
        if (processed >= limit) break

        send({ type: 'status', message: `Pazar Analizi: ${game.gameName}` })
        const prices = await getCardPrices(game.appId)

        if (prices && (prices.normalCards.length > 0 || prices.foilCards.length > 0)) {
          const normalAvg = prices.normalCards.length > 0 ? (prices.normalCards.reduce((s, c) => s + c.price, 0) / prices.normalCards.length) : 0
          const foilAvg = prices.foilCards.length > 0 ? (prices.foilCards.reduce((s, c) => s + c.price, 0) / prices.foilCards.length) : 0

          const totalCardsInSet = game.totalCards || prices.normalCards.length || 8
          const droppableCount = Math.ceil(totalCardsInSet / 2)

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

        processed++
        send({
          type: 'progress',
          current: processed,
          total: filtered.length,
          found: discovery.games.length,
          cardGames: discovery.cardEligibleCount,
          totalPotentialDrops: discovery.totalPotentialDrops
        })
        await delay(1300)
      }

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
