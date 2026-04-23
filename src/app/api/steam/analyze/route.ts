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
  const found = new Map<number, string>()
  const clean = (s: string) => s.replace(/Steam Card Beta/i, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()

  // Tier 1: Web API (Gold Standard if Key exists)
  if (apiKey && steamId64 && apiKey !== 'undefined') {
    try {
      const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId64}&include_appinfo=1&format=json`
      const data = await (await fetchWithTimeout(url)).json()
      data.response?.games?.forEach((g: any) => found.set(g.appid, clean(g.name || `App ${g.appid}`)))
    } catch { }
  }

  // Tier 2: HTML Library Page (rgGames approach)
  try {
    const html = await (await fetchWithTimeout(`${baseUrl}/games/?tab=all`.replace(/\/+/g, '/'))).text()
    const rgMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (rgMatch) {
      const gList = JSON.parse(rgMatch[1])
      gList.forEach((g: any) => found.set(g.appid, clean(g.name)))
    }
  } catch { }

  // Tier 3: XML Library Page
  try {
    const xml = await (await fetchWithTimeout(`${baseUrl}/games/?xml=1`.replace(/\/+/g, '/'))).text()
    const appIds = [...xml.matchAll(/<appID>(\d+)<\/appID>/g)].map(m => parseInt(m[1]))
    const names = [...xml.matchAll(/<name><!\[CDATA\[(.*?)\]\]><\/name>/g)].map(m => m[1])
    appIds.forEach((id, i) => found.set(id, clean(names[i] || `App ${id}`)))
  } catch { }

  // Tier 4: Infinite Badge/Card Scraper
  for (let p = 1; p <= 15; p++) {
    try {
      const html = await (await fetchWithTimeout(`${baseUrl}/badges/?p=${p}`.replace(/\/+/g, '/'))).text()
      const rows = html.matchAll(/badge_row([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g)
      let foundOnPage = 0
      for (const row of rows) {
        const appIdMatch = row[1].match(/gamecards\/(\d+)/)
        const nameMatch = row[1].match(/badge_title">([\s\S]*?)&nbsp;/)
        if (appIdMatch) {
          found.set(parseInt(appIdMatch[1]), clean(nameMatch ? nameMatch[1] : `App ${appIdMatch[1]}`))
          foundOnPage++
        }
      }
      if (foundOnPage === 0) break
    } catch { break }
  }

  return Array.from(found.entries()).map(([id, name]) => ({ appId: id, gameName: name }))
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
  } catch { return null }
}

// ===== MAIN ROUTE =====
export async function POST(req: Request) {
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()
  const send = (data: any) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  const body = await req.json()
  const { url: profileUrl, apiKey, excludeIds = [], limit = 100 } = body

  // Process Logic
  const run = async () => {
    try {
      send({ type: 'status', message: 'Kullanıcı doğrulanıyor...' })

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

      send({ type: 'status', message: 'Kütüphane taranıyor (Tier 4 Discovery)...' })
      let candidates = await discoverGames(baseUrl, apiKey, stemId64)

      // Filter candidates
      const filtered = candidates.filter(c => !excludeIds.includes(c.appId))
      send({ type: 'progress', current: 0, total: Math.min(filtered.length, limit), found: candidates.length })
      send({ type: 'complete', data: { profile: { steamId: stemId64, personaName: 'Steam User', avatarUrl: '', profileUrl: baseUrl, gameCount: candidates.length } } })

      let processed = 0
      for (const game of filtered) {
        if (processed >= limit) break

        send({ type: 'status', message: `Analiz ediliyor: ${game.gameName}` })
        const prices = await getCardPrices(game.appId)

        if (prices && prices.normalCards.length > 0) {
          const normalVal = (prices.normalCards.reduce((s, c) => s + c.price, 0) / prices.normalCards.length) * Math.ceil(prices.normalCards.length / 2)
          const foilVal = prices.foilCards.length > 0 ? (prices.foilCards.reduce((s, c) => s + c.price, 0) / prices.foilCards.length) : 0

          send({
            type: 'game',
            data: {
              appId: game.appId, gameName: game.gameName,
              gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
              normalCards: prices.normalCards,
              foilCards: prices.foilCards,
              highestCardPrice: Math.max(...prices.normalCards.map(c => c.price)),
              totalNormalCards: prices.normalCards.length,
              droppableCardsValue: normalVal,
              foilCardsValue: foilVal,
              hasCardDrops: true
            }
          })
        }

        processed++
        send({ type: 'progress', current: processed, total: Math.min(filtered.length, limit), found: candidates.length })
        await delay(1300) // Precise Steam Bypass
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
