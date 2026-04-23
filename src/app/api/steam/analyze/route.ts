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

// ===== Helper: Fetch with retry (exponential backoff) =====
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
          let delay = baseDelay * Math.pow(2, attempt)
          console.log(`[Retry] ${response.status} for ${url.substring(0, 80)}... waiting ${delay}ms`)
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

// ===== Helper: Fetch page HTML =====
async function fetchPageHtml(url: string, timeout = 20000): Promise<string> {
  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(timeout),
  }, 2, 1000)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
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

function cleanGameName(raw: string): string {
  return raw.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim()
}

// ===== Helper: Resolve vanity URL =====
async function resolveVanityUrl(vanityName: string): Promise<string | null> {
  try {
    const html = await fetchPageHtml(`https://steamcommunity.com/id/${vanityName}/`)
    const profileMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
    if (profileMatch) return JSON.parse(profileMatch[1]).steamid || null
    const idMatch = html.match(/steamid":"(\d{17})"/)
    return idMatch ? idMatch[1] : null
  } catch { return null }
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
    let gName = context.match(/badge_title"[^>]*>\s*([\s\S]*?)\s*(?:&nbsp;|<\/div>)/i)?.[1] || `Game ${appId}`
    const drops = context.match(/(\d+)\s+card\s+drops?\s+remain/i)?.[1] || '0'
    games.push({ appId, gameName: cleanGameName(gName), hasCardDrops: parseInt(drops) > 0 })
  }
  return games
}

function parseBadgesPageCount(html: string): number {
  let max = 1
  const matches = html.matchAll(/[\?&]p=(\d+)/g)
  for (const m of matches) {
    const p = parseInt(m[1])
    if (p > max) max = p
  }
  return max
}

function parseSteamGamesPage(html: string) {
  const rgMatch = html.match(/rgGames\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!rgMatch) return []
  try {
    return JSON.parse(rgMatch[1]).map((g: any) => ({ appId: g.appid, gameName: cleanGameName(g.name) }))
  } catch { return [] }
}

async function fetchGamesFromSteamAPI(steamId: string) {
  try {
    const html = await fetchPageHtml(`https://steamcommunity.com/profiles/${steamId}/games/?tab=all`)
    return parseSteamGamesPage(html)
  } catch { return [] }
}

async function fetchOwnedGamesViaAPI(steamId: string, apiKey: string) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error()
  const data = await resp.json()
  return (data.response?.games || []).map((g: any) => ({ appId: g.appid, gameName: cleanGameName(g.name) }))
}

async function fetchCardPrices(appId: number, gameName: string) {
  try {
    const url = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
    const resp = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 1, 1000)
    if (!resp.ok) return { normalCards: [], foilCards: [], failed: true }
    const data = await resp.json()
    if (!data?.success) return { normalCards: [], foilCards: [], failed: true }

    const normal: any[] = []
    const foil: any[] = []
    data.results.forEach((item: any) => {
      const isFoil = (item.hash_name || '').includes('(Foil)')
      const card = { name: item.name, price: item.sell_price / 100, priceText: item.sell_price_text, isFoil, imageUrl: `https://community.akamai.steamstatic.com/economy/image/${item.asset_description?.icon_url_large || item.asset_description?.icon_url}/62fx62f` }
      if (isFoil) foil.push(card)
      else normal.push(card)
    })
    return { normalCards: normal, foilCards: foil, failed: false }
  } catch { return { normalCards: [], foilCards: [], failed: true } }
}

// ===== Main POST Handler =====
export async function POST(request: NextRequest) {
  try {
    const { url, apiKey } = await request.json()
    const parsed = parseSteamUrl(url)
    if (!parsed) return new Response(JSON.stringify({ error: 'invalid url' }), { status: 400 })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }

        try {
          send({ type: 'status', message: 'Profil bilgileri alınıyor...' })
          const pUrl = parsed.type === 'id' ? `https://steamcommunity.com/id/${parsed.value}/` : `https://steamcommunity.com/profiles/${parsed.value}/`
          const pHtml = await fetchPageHtml(pUrl)
          const pInfo = parseProfileInfo(pHtml)
          if (!pInfo) { send({ type: 'error', message: 'Profil gizli veya hatalı.' }); return controller.close() }

          send({ type: 'status', message: 'Kütüphane listesi taranıyor...' })
          const [apiG, scrapedG] = await Promise.all([
            apiKey?.trim() ? fetchOwnedGamesViaAPI(pInfo.steamId, apiKey.trim()).catch(() => []) : Promise.resolve([]),
            fetchGamesFromSteamAPI(pInfo.steamId)
          ])

          send({ type: 'status', message: 'Kartlı oyunlar tespit ediliyor...' })
          const bHtml = await fetchPageHtml(pUrl + 'badges/')
          const badgeG = parseBadgesPage(bHtml)

          const lib = new Map()
          apiG.forEach((g: any) => lib.set(g.appId, g.gameName))
          scrapedG.forEach((g: any) => lib.set(g.appId, g.gameName))
          badgeG.forEach((g: any) => lib.set(g.appId, g.gameName))

          const candidates = Array.from(lib.keys()).map(id => ({ appId: id, gameName: lib.get(id) }))
          console.log(`[Discovery] API:${apiG.length} Scraped:${scrapedG.length} Badges:${badgeG.length} Total Unique:${candidates.length}`)

          send({ type: 'status', message: `${candidates.length} oyun taranacak...` })
          const gameCards: any[] = []
          let curDelay = 250

          for (let i = 0; i < candidates.length; i++) {
            const game = candidates[i]
            if (i > 0 && i % 25 === 0) {
              send({ type: 'status', message: `IP Limiti bekleniyor... (${Math.round((candidates.length - i) / 25 * 10)}s kaldı)` })
              await new Promise(r => setTimeout(r, 10000))
            } else if (i > 0) {
              await new Promise(r => setTimeout(r, curDelay))
            }

            const { normalCards, foilCards, failed } = await fetchCardPrices(game.appId, game.gameName)
            if (!failed && normalCards.length > 0) {
              const res = {
                appId: game.appId,
                gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                normalCards, foilCards,
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
              gameCards.push(res); send({ type: 'game', data: res })
            }
            if (failed) curDelay = Math.min(3000, curDelay + 500)
            else curDelay = Math.max(250, curDelay - 50)

            if (i % 5 === 0 || i === candidates.length - 1) {
              send({ type: 'progress', current: i + 1, total: candidates.length, found: gameCards.length, message: `${i + 1}/${candidates.length}` })
            }
          }

          gameCards.sort((a, b) => b.highestCardPrice - a.highestCardPrice)
          send({ type: 'complete', data: { profile: pInfo, games: gameCards, totalGamesWithCards: gameCards.length, totalOwnedGames: candidates.length } })
          controller.close()
        } catch (err) { console.error(err); send({ type: 'error', message: 'Hata oluştu.' }); controller.close() }
      }
    })

    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } })
  } catch (e) { return new Response(JSON.stringify({ error: 'internal error' }), { status: 500 }) }
}
