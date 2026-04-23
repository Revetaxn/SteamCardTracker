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

interface GameCardInfo {
  appId: number
  gameName: string
  gameIconUrl: string
  normalCards: CardInfo[]
  foilCards: CardInfo[]
  highestCardPrice: number
  highestCardName: string
  totalNormalCardsValue: number
  totalNormalCards: number
  totalFoilCards: number
  cardDropsTotal: number
  droppableCardsValue: number
  avgCardPrice: number
  hasCardDrops: boolean
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

// ===== Helper: Fetch with retry (exponential backoff, handles 429 & 5xx) =====
async function fetchWithRetry(
  url: string,
  options: RequestInit & { signal?: AbortSignal } = {},
  maxRetries = 3,
  baseDelay = 1500
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(20000),
      })

      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const retryAfter = response.headers.get('Retry-After')
          let delay = baseDelay * Math.pow(2, attempt)
          if (retryAfter) {
            const retrySeconds = parseInt(retryAfter)
            if (!isNaN(retrySeconds)) {
              delay = Math.max(delay, retrySeconds * 1000)
            }
          }
          console.log(`[Retry] ${response.status} for ${url.substring(0, 80)}... waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }

      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.log(`[Retry] Network error for ${url.substring(0, 80)}... waiting ${delay}ms (attempt ${attempt + 1}/${maxRetries}): ${lastError.message}`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError || new Error(`Failed to fetch ${url} after ${maxRetries} retries`)
}

// ===== Helper: Fetch page HTML using direct HTTP request with retry =====
async function fetchPageHtml(url: string, timeout = 20000): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
    },
    signal: AbortSignal.timeout(timeout),
  }, 2, 1000)

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }

  return await response.text()
}

// ===== Helper: Parse Steam URL =====
function parseSteamUrl(url: string): { type: 'id' | 'profiles'; value: string } | null {
  const idMatch = url.match(/steamcommunity\.com\/id\/([^/?\s]+)/)
  if (idMatch) return { type: 'id', value: idMatch[1] }
  const profileMatch = url.match(/steamcommunity\.com\/profiles\/(\d+)/)
  if (profileMatch) return { type: 'profiles', value: profileMatch[1] }
  if (/^\d{17}$/.test(url.trim())) return { type: 'profiles', value: url.trim() }
  return null
}

// ===== Helper: Clean HTML entities from game names =====
function cleanGameName(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/View details/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ===== Helper: Resolve vanity URL to SteamID64 =====
async function resolveVanityUrl(vanityName: string): Promise<string | null> {
  try {
    const url = `https://steamcommunity.com/id/${vanityName}/`
    const html = await fetchPageHtml(url)
    const profileDataMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
    if (profileDataMatch) {
      const profileData = JSON.parse(profileDataMatch[1])
      return profileData.steamid || null
    }
    const steamIdMatch = html.match(/steamid":"(\d{17})"/) || html.match(/"steamid":"(\d+)"/)
    if (steamIdMatch) return steamIdMatch[1]
    return null
  } catch {
    return null
  }
}

// ===== Helper: Parse profile info from Steam profile page =====
function parseProfileInfo(html: string): ProfileInfo | null {
  const profileDataMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
  if (!profileDataMatch) return null

  try {
    const profileData = JSON.parse(profileDataMatch[1])
    const steamId = profileData.steamid || ''
    const personaName = profileData.personaname || ''
    const profileUrl = profileData.url || ''

    const avatarMatch =
      html.match(/<link rel="image_src" href="([^"]+)"/) ||
      html.match(/<meta property="og:image" content="([^"]+)"/)
    const avatarUrl = avatarMatch
      ? avatarMatch[1].replace('_full.jpg', '_medium.jpg')
      : ''

    const gameCountMatch =
      html.match(/Games[^<]*<[^>]*>\s*<[^>]*>\s*(\d+)/) ||
      html.match(/(\d+)\s*games?\s*owned/i)
    const gameCount = gameCountMatch ? parseInt(gameCountMatch[1]) : 0

    return { steamId, personaName, avatarUrl, profileUrl, gameCount }
  } catch {
    return null
  }
}

// ===== Helper: Parse badges page for games with trading cards =====
function parseBadgesPage(
  html: string
): { appId: number; gameName: string; hasCardDrops: boolean; cardDropsRemaining: number }[] {
  const games: { appId: number; gameName: string; hasCardDrops: boolean; cardDropsRemaining: number }[] = []
  const gamecardPattern = /gamecards\/(\d+)\//g
  let match
  const seenAppIds = new Set<number>()

  while ((match = gamecardPattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    if (!appId || seenAppIds.has(appId)) continue
    seenAppIds.add(appId)

    const startPos = Math.max(0, match.index - 500)
    const endPos = Math.min(html.length, match.index + 2000)
    const context = html.substring(startPos, endPos)

    let gameName = ''
    const titleMatch = context.match(/badge_title"[^>]*>\s*([\s\S]*?)\s*(?:&nbsp;|<\/div>)/i)
    if (titleMatch) {
      gameName = cleanGameName(titleMatch[1])
    } else {
      const secondaryTitleMatch = context.match(/badge_row_type[^>]*>\s*([\s\S]*?)\s*<\/div>/i)
      if (secondaryTitleMatch) {
        gameName = cleanGameName(secondaryTitleMatch[1]).replace(/Trading Card Badge/i, '').trim()
      }
    }

    if (!gameName) gameName = `Game ${appId}`
    const dropsMatch = context.match(/(\d+)\s+card\s+drops?\s+remain/i)
    const cardDropsRemaining = dropsMatch ? parseInt(dropsMatch[1]) : 0
    games.push({ appId, gameName, hasCardDrops: cardDropsRemaining > 0, cardDropsRemaining })
  }
  return games
}

// ===== Helper: Parse total page count from badges pagination =====
function parseBadgesPageCount(html: string): number {
  let maxPage = 1
  const pageMatches = html.matchAll(/[\?&]p=(\d+)/g)
  for (const m of pageMatches) {
    const p = parseInt(m[1])
    if (p > maxPage && p < 1000) maxPage = p
  }
  const pagerMatch = html.match(/class="badge_page_link">(\d+)<\/a>/g)
  if (pagerMatch) {
    for (const m of pagerMatch) {
      const pMatch = m.match(/>(\d+)</)
      if (pMatch) {
        const p = parseInt(pMatch[1])
        if (p > maxPage) maxPage = p
      }
    }
  }
  return maxPage
}

// ===== Helper: Parse Steam games page (rgGames JS variable) =====
function parseSteamGamesPage(html: string): { appId: number; gameName: string; playtime: number }[] {
  const games: { appId: number; gameName: string; playtime: number }[] = []
  const rgGamesMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (rgGamesMatch) {
    try {
      const gamesData = JSON.parse(rgGamesMatch[1])
      for (const g of gamesData) {
        if (g.appid && g.name) {
          games.push({
            appId: g.appid,
            gameName: cleanGameName(g.name),
            playtime: g.playtime_forever || 0,
          })
        }
      }
    } catch { }
  }
  return games
}

// ===== Helper: Parse Steam XML games endpoint =====
function parseSteamXMLGames(html: string): { appId: number; gameName: string; playtime: number }[] {
  const games: { appId: number; gameName: string; playtime: number }[] = []
  const gamePattern = /<appID>(\d+)<\/appID>[\s\S]*?<name><!\[CDATA\[([^\]]*)\]\]><\/name>/g
  let match
  while ((match = gamePattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    const gameName = cleanGameName(match[2])
    if (appId && gameName) {
      const blockEnd = html.indexOf('</game>', match.index)
      const block = blockEnd > 0 ? html.substring(match.index, blockEnd) : ''
      const hoursMatch = block.match(/<hoursOnRecord>([^<]+)<\/hoursOnRecord>/)
      const playtime = hoursMatch ? Math.round(parseFloat(hoursMatch[1].replace(',', '.')) * 60) : 0
      games.push({ appId, gameName, playtime })
    }
  }
  if (games.length === 0) {
    const simplePattern = /<appID>(\d+)<\/appID>[\s\S]*?<name>([^<]+)<\/name>/g
    while ((match = simplePattern.exec(html)) !== null) {
      const appId = parseInt(match[1])
      const gameName = cleanGameName(match[2])
      if (appId && gameName) {
        games.push({ appId, gameName, playtime: 0 })
      }
    }
  }
  return games
}

// ===== Helper: Fetch games directly from Steam API (no key needed) =====
async function fetchGamesFromSteamAPI(steamId: string): Promise<{ appId: number; gameName: string; playtime: number }[]> {
  try {
    const url = `https://steamcommunity.com/profiles/${steamId}/games/?tab=all`
    const html = await fetchPageHtml(url)
    const jsonGames = parseSteamGamesPage(html)
    if (jsonGames.length > 0) return jsonGames
    const xmlGames = parseSteamXMLGames(html)
    if (xmlGames.length > 0) return xmlGames
    return []
  } catch {
    return []
  }
}

// ===== Helper: Fetch ALL owned games via Steam Web API (requires API key) =====
async function fetchOwnedGamesViaAPI(steamId: string, apiKey: string): Promise<{ appId: number; gameName: string; playtime: number }[]> {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Steam API error: ${response.status}`)
  const data = await response.json()
  const games = data?.response?.games || []
  return games.map((g: any) => ({
    appId: g.appid,
    gameName: cleanGameName(g.name),
    playtime: g.playtime_forever || 0,
  }))
}

// ===== Helper: Fetch card prices from Steam Market API =====
async function fetchCardPrices(appId: number, gameName: string): Promise<{ normalCards: CardInfo[]; foilCards: CardInfo[]; failed: boolean }> {
  try {
    const marketUrl = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const response = await fetchWithRetry(marketUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    }, 2, 1000)
    if (!response.ok) return { normalCards: [], foilCards: [], failed: true }
    const data = await response.json()
    if (!data || data.success === false) return { normalCards: [], foilCards: [], failed: true }

    const normalCards: CardInfo[] = []
    const foilCards: CardInfo[] = []
    const results = data.results || []

    const processItem = (item: any) => {
      const hashName = item.hash_name || ''
      const name = item.name || ''
      const sellPrice = item.sell_price || 0
      const isFoil = hashName.includes('(Foil)') || name.includes('(Foil)')
      if (name && sellPrice > 0) {
        const card = {
          name,
          price: sellPrice / 100,
          priceText: item.sell_price_text || '',
          isFoil,
          imageUrl: `https://community.akamai.steamstatic.com/economy/image/${item.asset_description?.icon_url_large || item.asset_description?.icon_url}/62fx62f`,
          hashName
        }
        if (isFoil) foilCards.push(card)
        else normalCards.push(card)
      }
    }

    results.forEach(processItem)
    if (data.total_count > 100) {
      await new Promise(resolve => setTimeout(resolve, 500))
      const secondPageUrl = marketUrl.replace('start=0', 'start=100')
      const secResp = await fetch(secondPageUrl, { signal: AbortSignal.timeout(15000) })
      if (secResp.ok) {
        const secData = await secResp.json()
        if (secData.results) secData.results.forEach(processItem)
      }
    }
    normalCards.sort((a, b) => b.price - a.price)
    foilCards.sort((a, b) => b.price - a.price)
    return { normalCards, foilCards, failed: false }
  } catch {
    return { normalCards: [], foilCards: [], failed: true }
  }
}

// ===== Main POST Handler =====
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { url, apiKey } = body
  const parsedUrl = parseSteamUrl(url)
  if (!parsedUrl) return new Response(JSON.stringify({ error: 'invalid url' }), { status: 400 })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch { }
      }

      try {
        send({ type: 'status', message: 'Profil bilgileri alınıyor...' })
        const profilePageUrl = parsedUrl.type === 'id' ? `https://steamcommunity.com/id/${parsedUrl.value}/` : `https://steamcommunity.com/profiles/${parsedUrl.value}/`
        const profileHtml = await fetchPageHtml(profilePageUrl)
        const profileInfo = parseProfileInfo(profileHtml)
        if (!profileInfo) {
          send({ type: 'error', message: 'Profil bilgileri okunamadı.' })
          return controller.close()
        }

        let apiOwnedGames: any[] = []
        if (apiKey?.trim()) {
          send({ type: 'status', message: 'Kütüphane çekiliyor...' })
          try { apiOwnedGames = await fetchOwnedGamesViaAPI(profileInfo.steamId, apiKey.trim()) } catch { }
        }

        send({ type: 'status', message: 'Kartlı oyunlar tespit ediliyor...' })
        const badgesUrl = profilePageUrl + 'badges/'
        let cardEligibleGames: any[] = []
        try {
          const bHtml = await fetchPageHtml(badgesUrl)
          cardEligibleGames = parseBadgesPage(bHtml)
          const maxP = parseBadgesPageCount(bHtml)
          for (let p = 2; p <= Math.min(maxP, 50); p++) {
            const pHtml = await fetchPageHtml(badgesUrl + '?p=' + p)
            const pGames = parseBadgesPage(pHtml)
            if (pGames.length === 0) break
            pGames.forEach(pg => { if (!cardEligibleGames.some(eg => eg.appId === pg.appId)) cardEligibleGames.push(pg) })
          }
        } catch { }

        console.log(`[Discovery] API: ${apiOwnedGames.length}, Badges: ${cardEligibleGames.length}`)
        const libraryMap = new Map()
        apiOwnedGames.forEach(g => libraryMap.set(g.appId, g.gameName))
        cardEligibleGames.forEach(g => libraryMap.set(g.appId, g.gameName))

        const candidates = Array.from(libraryMap.keys()).map(appId => ({ appId, gameName: libraryMap.get(appId) }))
        console.log(`[Discovery] Total candidates: ${candidates.length}`)

        send({ type: 'status', message: `${candidates.length} oyun tek tek taranıyor...` })
        const gameCards: any[] = []
        const failedGames: any[] = []
        let currentDelay = 250

        for (let i = 0; i < candidates.length; i++) {
          const game = candidates[i]
          if (i > 0 && i % 20 === 0) {
            console.log(`[Cooldown] Reached ${i}. Waiting 12s...`)
            send({ type: 'status', message: 'Steam IP limiti bekletiliyor (12s)...' })
            await new Promise(r => setTimeout(r, 12000))
          } else if (i > 0) {
            await new Promise(r => setTimeout(r, currentDelay))
          }

          const { normalCards, foilCards, failed } = await fetchCardPrices(game.appId, game.gameName)
          if (failed) {
            console.warn(`[Market] FAILED: ${game.gameName}`)
            failedGames.push(game)
            currentDelay = Math.min(3000, currentDelay + 500)
          } else {
            if (normalCards.length > 0) {
              console.log(`[Market] SUCCESS: ${game.gameName} (${normalCards.length} cards)`)
              const res = {
                appId: game.appId,
                gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                normalCards,
                foilCards,
                highestCardPrice: normalCards[0].price,
                highestCardName: normalCards[0].name,
                totalNormalCardsValue: normalCards.reduce((s, c) => s + c.price, 0),
                totalNormalCards: normalCards.length,
                totalFoilCards: foilCards.length,
                cardDropsTotal: Math.ceil(normalCards.length / 2),
                droppableCardsValue: (normalCards.reduce((s, c) => s + c.price, 0) / normalCards.length) * Math.ceil(normalCards.length / 2),
                avgCardPrice: normalCards.reduce((s, c) => s + c.price, 0) / normalCards.length,
                hasCardDrops: true
              }
              gameCards.push(res)
              send({ type: 'game', data: res })
            }
            currentDelay = Math.max(250, currentDelay - 50)
          }

          if (i % 5 === 0 || i === candidates.length - 1) {
            send({ type: 'progress', current: i + 1, total: candidates.length, found: gameCards.length, message: `İşleniyor: ${i + 1}/${candidates.length}` })
          }
        }

        gameCards.sort((a, b) => b.highestCardPrice - a.highestCardPrice)
        send({ type: 'complete', data: { profile: profileInfo, games: gameCards, totalGamesWithCards: gameCards.length, totalOwnedGames: candidates.length } })
        controller.close()
      } catch (err) {
        console.error(err)
        send({ type: 'error', message: 'Bir hata oluştu.' })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
