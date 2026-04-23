import { NextRequest } from 'next/server'

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

      // On 429 (rate limit) or 5xx, retry with backoff
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
  // Also allow raw SteamID64
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

    // Try to extract steamID from profile page data
    const profileDataMatch = html.match(/g_rgProfileData\s*=\s*({[^}]+})/)
    if (profileDataMatch) {
      const profileData = JSON.parse(profileDataMatch[1])
      return profileData.steamid || null
    }

    // Try steamid in meta tags or other patterns
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

  // More inclusive pattern: matches any gamecard link on the badges page
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

    // Extract game name - look for badge_title or similar
    let gameName = ''
    const titleMatch = context.match(/badge_title"[^>]*>\s*([\s\S]*?)\s*(?:&nbsp;|<\/div>)/i)
    if (titleMatch) {
      gameName = cleanGameName(titleMatch[1])
    } else {
      // Fallback for games with zero progress (might have different HTML)
      const secondaryTitleMatch = context.match(/badge_row_type[^>]*>\s*([\s\S]*?)\s*<\/div>/i)
      if (secondaryTitleMatch) {
        gameName = cleanGameName(secondaryTitleMatch[1]).replace(/Trading Card Badge/i, '').trim()
      }
    }

    // Default name if still not found
    if (!gameName) gameName = `Game ${appId}`

    // Parse "X card drops remaining"
    const dropsMatch = context.match(/(\d+)\s+card\s+drops?\s+remain/i)
    const cardDropsRemaining = dropsMatch ? parseInt(dropsMatch[1]) : 0
    const hasCardDrops = cardDropsRemaining > 0

    games.push({ appId, gameName, hasCardDrops, cardDropsRemaining })
  }

  return games
}

// ===== Helper: Parse total page count from badges pagination =====
function parseBadgesPageCount(html: string): number {
  let maxPage = 1

  // Matches ?p=X or page=X or simply numbers in the pagination bar
  const pageMatches = html.matchAll(/(?:\?p=|page=|\/badges\/)(\d+)/g)
  for (const m of pageMatches) {
    const p = parseInt(m[1])
    if (p > maxPage && p < 200) maxPage = p // Cap at 200 pages to be safe
  }

  // Also check "Page 1 of X" text
  const ofMatch = html.match(/(\d+)\s+of\s+(\d+)/i)
  if (ofMatch && ofMatch[2]) {
    const p = parseInt(ofMatch[2])
    if (p > maxPage) maxPage = p
  }

  return maxPage
}

// ===== Helper: Parse Steam games page (rgGames JS variable) =====
function parseSteamGamesPage(
  html: string
): { appId: number; gameName: string; playtime: number }[] {
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
    } catch (err) {
      console.error('Failed to parse rgGames:', err)
    }
  }

  return games
}

// ===== Helper: Parse Steam XML games endpoint =====
function parseSteamXMLGames(
  html: string
): { appId: number; gameName: string; playtime: number }[] {
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
async function fetchGamesFromSteamAPI(
  steamId: string
): Promise<{ appId: number; gameName: string; playtime: number }[]> {
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
async function fetchOwnedGamesViaAPI(
  steamId: string,
  apiKey: string
): Promise<{ appId: number; gameName: string; playtime: number }[]> {
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${apiKey}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`Steam API error: ${response.status}`)
    }

    const data = await response.json()
    const games = data?.response?.games || []

    return games.map((g: { appid: number; name: string; playtime_forever: number }) => ({
      appId: g.appid,
      gameName: cleanGameName(g.name),
      playtime: g.playtime_forever || 0,
    }))
  } catch (err) {
    console.error('Steam Web API error:', err)
    throw err
  }
}

// ===== Helper: Fetch appIds of games that have trading card badges =====
// Uses IPlayerService/GetBadges/v1 — returns all badge data in ONE request
async function fetchCardEligibleAppIds(
  steamId: string,
  apiKey: string
): Promise<Set<number>> {
  const appIds = new Set<number>()
  try {
    const url = `https://api.steampowered.com/IPlayerService/GetBadges/v1/?key=${apiKey}&steamid=${steamId}`
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) {
      console.error(`GetBadges API error: ${response.status}`)
      return appIds
    }
    const data = await response.json()
    const badges: { appid?: number; badgeid?: number }[] = data?.response?.badges || []
    // Only keep game badges (appid > 0, badgeid === 1 means trading card badge)
    for (const b of badges) {
      if (b.appid && b.appid > 0) {
        appIds.add(b.appid)
      }
    }
    console.log(`[GetBadges] Found ${appIds.size} games with card badges`)
  } catch (err) {
    console.error('GetBadges API error:', err)
  }
  return appIds
}

// ===== Helper: Fetch card prices from Steam Market API =====
async function fetchCardPrices(
  appId: number,
  gameName: string
): Promise<{ normalCards: CardInfo[]; foilCards: CardInfo[]; failed: boolean }> {
  const normalCards: CardInfo[] = []
  const foilCards: CardInfo[] = []

  try {
    const marketUrl = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=100&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`

    const response = await fetchWithRetry(marketUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    }, 2, 1000)

    if (!response.ok) {
      console.error(`Market API error ${response.status} for ${gameName} (${appId})`)
      return { normalCards: [], foilCards: [], failed: true }
    }

    const data = await response.json()

    // Detect soft rate limit: Steam sometimes returns 200 OK with success=false or null
    if (!data || data.success === false) {
      console.warn(`[SoftRateLimit] Detected for ${gameName} (${appId}) — data.success=${data?.success}`)
      return { normalCards: [], foilCards: [], failed: true }
    }

    const results = data.results || []
    const totalCount = data.total_count || 0

    const processItem = (item: {
      hash_name?: string
      name?: string
      sell_price?: number
      sell_price_text?: string
      asset_description?: { icon_url?: string; icon_url_large?: string }
    }) => {
      const hashName: string = item.hash_name || ''
      const name: string = item.name || ''
      const sellPrice: number = item.sell_price || 0
      const sellPriceText: string = item.sell_price_text || ''
      const assetDesc = item.asset_description || {}
      const iconUrl = assetDesc.icon_url || ''
      const iconUrlLarge = assetDesc.icon_url_large || ''
      const isFoil =
        hashName.includes('(Foil)') ||
        hashName.includes('Foil Trading Card') ||
        name.includes('(Foil)') ||
        name.includes('Foil Trading Card')

      let imageUrl = ''
      if (iconUrlLarge) {
        imageUrl = `https://community.akamai.steamstatic.com/economy/image/${iconUrlLarge}/62fx62f`
      } else if (iconUrl) {
        imageUrl = `https://community.akamai.steamstatic.com/economy/image/${iconUrl}/62fx62f`
      }

      const card: CardInfo = {
        name,
        price: sellPrice / 100,
        priceText: sellPriceText,
        isFoil,
        imageUrl,
        hashName,
      }

      if (name && sellPrice > 0) {
        if (isFoil) {
          foilCards.push(card)
        } else {
          normalCards.push(card)
        }
      }
    }

    for (const item of results) {
      processItem(item)
    }

    // Pagination if needed
    if (totalCount > 100) {
      // Wait before second page to avoid rate limit
      await new Promise(resolve => setTimeout(resolve, 500))
      const secondPageUrl = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=100&count=100&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`
      try {
        const secondResponse = await fetchWithRetry(secondPageUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        }, 2, 1000)
        if (secondResponse.ok) {
          const secondData = await secondResponse.json()
          for (const item of secondData.results || []) {
            processItem(item)
          }
        }
      } catch (err) {
        console.warn(`Second page fetch failed for ${gameName} (${appId}):`, err)
      }
    }
  } catch (err) {
    console.error(`Error fetching card prices for ${gameName} (${appId}):`, err)
    return { normalCards: [], foilCards: [], failed: true }
  }

  normalCards.sort((a, b) => b.price - a.price)
  foilCards.sort((a, b) => b.price - a.price)
  return { normalCards, foilCards, failed: false }
}

// ===== Helper: Resolve SteamID from vanity URL or profile URL =====
async function resolveSteamId(parsedUrl: { type: 'id' | 'profiles'; value: string }): Promise<string | null> {
  if (parsedUrl.type === 'profiles') {
    return parsedUrl.value
  }

  // Vanity URL — need to resolve to SteamID64
  const resolved = await resolveVanityUrl(parsedUrl.value)
  return resolved
}

// ===== Main POST Handler with SSE Streaming =====
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { url, apiKey } = body

  if (!url || typeof url !== 'string') {
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: 'Steam profil URL\'si gereklidir' })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const parsedUrl = parseSteamUrl(url)
  if (!parsedUrl) {
    return new Response(
      `data: ${JSON.stringify({
        type: 'error',
        message: 'Geçersiz Steam URL. Format: https://steamcommunity.com/id/kullaniciadi/ veya https://steamcommunity.com/profiles/76561198xxxxxxxxx/',
      })}\n\n`,
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } }
    )
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller might be closed
        }
      }

      try {
        // ===== Step 1: Fetch profile info using direct HTTP =====
        send({ type: 'status', message: 'Profil bilgileri alınıyor...' })

        const profilePageUrl =
          parsedUrl.type === 'id'
            ? `https://steamcommunity.com/id/${parsedUrl.value}/`
            : `https://steamcommunity.com/profiles/${parsedUrl.value}/`

        const profileHtml = await fetchPageHtml(profilePageUrl)
        const profileInfo = parseProfileInfo(profileHtml)

        if (!profileInfo) {
          send({
            type: 'error',
            message: 'Profil bilgileri okunamadı. Profil gizli olabilir veya geçersiz bir URL girdiniz.',
          })
          try { controller.close() } catch { }
          return
        }

        // ===== Step 2: Fetch all games — try multiple sources =====
        let allGames: {
          appId: number
          gameName: string
          hasCardDrops?: boolean
          cardDropsRemaining?: number
        }[] = []
        let scanMethod = 'unknown'

        // --- Source 0: Steam Web API (requires API key) ---
        let apiOwnedGames: { appId: number; gameName: string; playtime: number }[] = []
        if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
          send({ type: 'status', message: 'Steam Web API ile kütüphane çekiliyor...' })
          try {
            apiOwnedGames = await fetchOwnedGamesViaAPI(profileInfo.steamId, apiKey.trim())
            if (apiOwnedGames.length > 0) {
              send({ type: 'status', message: `API üzerinden ${apiOwnedGames.length} oyun bulundu.` })
            }
          } catch (err) {
            console.error('Steam Web API failed:', err)
          }
        }

        // --- Step 2b: Card Discovery via Badges Page (HTML) ---
        // We always try this because it identifies which games actually have cards
        send({ type: 'status', message: 'Kartlı oyunlar tespit ediliyor...' })

        const badgesUrl =
          parsedUrl.type === 'id'
            ? `https://steamcommunity.com/id/${parsedUrl.value}/badges/`
            : `https://steamcommunity.com/profiles/${parsedUrl.value}/badges/`

        let cardEligibleGames: { appId: number; gameName: string; hasCardDrops: boolean; cardDropsRemaining: number }[] = []

        try {
          const firstPageHtml = await fetchPageHtml(badgesUrl)
          const firstPageGames = parseBadgesPage(firstPageHtml)
          const maxPages = parseBadgesPageCount(firstPageHtml)

          cardEligibleGames = [...firstPageGames]

          if (maxPages > 1) {
            send({
              type: 'status',
              message: `Badges sayfası 1/${maxPages} taranıyor... (${cardEligibleGames.length} oyun)`,
            })

            for (let page = 2; page <= maxPages; page++) {
              try {
                const pageHtml = await fetchPageHtml(`${badgesUrl}?p=${page}`)
                const moreGames = parseBadgesPage(pageHtml)
                if (moreGames.length === 0) break

                for (const g of moreGames) {
                  if (!cardEligibleGames.some(existing => existing.appId === g.appId)) {
                    cardEligibleGames.push(g)
                  }
                }

                send({
                  type: 'status',
                  message: `Badges sayfası ${page}/${maxPages} taranıyor... (${cardEligibleGames.length} oyun)`,
                })
              } catch {
                break
              }
            }
          }
        } catch (err) {
          console.error('Badges scan failed:', err)
        }

        // --- Final Merge ---
        if (apiOwnedGames.length > 0) {
          // If we have API data, we use all games that have cards detected in badges
          // OR if badges failed, we use all API games with playtime
          if (cardEligibleGames.length > 0) {
            allGames = cardEligibleGames.map(cg => {
              const apiGame = apiOwnedGames.find(ag => ag.appId === cg.appId)
              return {
                appId: cg.appId,
                gameName: apiGame ? apiGame.gameName : cg.gameName,
                hasCardDrops: cg.hasCardDrops,
                cardDropsRemaining: cg.cardDropsRemaining
              }
            })
            scanMethod = 'web_api_plus_badges'
          } else {
            allGames = apiOwnedGames.map(g => ({
              appId: g.appId,
              gameName: g.gameName,
              hasCardDrops: g.playtime > 0
            }))
            scanMethod = 'web_api_only'
          }
        } else {
          // No API key, use badges only
          allGames = cardEligibleGames
          scanMethod = 'badges_only'
        }

        // Final fallback if still empty
        if (allGames.length === 0) {
          try {
            send({ type: 'status', message: 'Diğer kaynaklar deneniyor (Games Page)...' })
            const profileGames = await fetchGamesFromSteamAPI(profileInfo.steamId)
            if (profileGames.length > 0) {
              allGames = profileGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0
              }))
              scanMethod = 'games_page'
            }
          } catch { }
        }

        if (allGames.length === 0) {
          try {
            send({ type: 'status', message: 'Diğer kaynaklar deneniyor (XML)...' })
            const xmlUrl = `https://steamcommunity.com/profiles/${profileInfo.steamId}/games/?xml=1`
            const xmlHtml = await fetchPageHtml(xmlUrl)
            const xmlGames = parseSteamXMLGames(xmlHtml)
            if (xmlGames.length > 0) {
              allGames = xmlGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0
              }))
              scanMethod = 'steam_xml'
            }
          } catch { }
        }

        if (allGames.length === 0) {
          send({
            type: 'error',
            message: 'Hiç oyun bulunamadı. Profil gizli olabilir veya geçersiz bir URL girdiniz.',
          })
          try { controller.close() } catch { }
          return
        }

        // ===== Step 3: Fetch card prices for all games (sequential with adaptive delay) =====
        send({
          type: 'status',
          message: `${allGames.length} kartlı oyun için fiyatlar alınıyor...`,
        })

        send({
          type: 'progress',
          current: 0,
          total: allGames.length,
          found: 0,
          message: `Kart fiyatları alınıyor... (0/${allGames.length})`,
        })

        const gameCards: GameCardInfo[] = []
        let failedGames: typeof allGames = []

        const processGameResult = (game: typeof allGames[0], normalCards: CardInfo[], foilCards: CardInfo[]): GameCardInfo | null => {
          if (normalCards.length === 0) return null

          const highestCard = normalCards[0]
          const totalNormalCardsValue = normalCards.reduce(
            (sum, c) => sum + c.price,
            0
          )

          const cardDropsTotal = Math.ceil(normalCards.length / 2)
          const avgCardPrice = totalNormalCardsValue / normalCards.length
          const droppableCardsValue = Math.round(avgCardPrice * cardDropsTotal * 100) / 100

          return {
            appId: game.appId,
            gameName: game.gameName,
            gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
            normalCards,
            foilCards,
            highestCardPrice: highestCard.price,
            highestCardName: highestCard.name,
            totalNormalCardsValue,
            totalNormalCards: normalCards.length,
            totalFoilCards: foilCards.length,
            cardDropsTotal,
            droppableCardsValue,
            avgCardPrice,
            hasCardDrops: game.hasCardDrops ?? false,
          } as GameCardInfo
        }

        // Sequential processing with adaptive delay
        let currentDelay = 250 // start fast
        let consecutiveSuccesses = 0

        for (let i = 0; i < allGames.length; i++) {
          const game = allGames[i]

          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, currentDelay))
          }

          const { normalCards, foilCards, failed } = await fetchCardPrices(game.appId, game.gameName)

          if (failed) {
            failedGames.push(game)
            // Rate limited — slow down significantly
            currentDelay = 3000
            consecutiveSuccesses = 0
          } else {
            consecutiveSuccesses++
            const result = processGameResult(game, normalCards, foilCards)
            if (result) {
              gameCards.push(result)
              send({ type: 'game', data: result })
            }
            // Gradually speed up after consecutive successes
            if (consecutiveSuccesses > 10) {
              currentDelay = Math.max(200, currentDelay - 50)
            } else if (consecutiveSuccesses > 5) {
              currentDelay = Math.max(300, currentDelay - 30)
            }
          }

          // Progress update every 5 games
          if (i % 5 === 0 || i === allGames.length - 1) {
            send({
              type: 'progress',
              current: i + 1,
              total: allGames.length,
              found: gameCards.length,
              message: `Kart fiyatları alınıyor... (${i + 1}/${allGames.length}) — ${gameCards.length} kartlı oyun bulundu`,
            })
          }
        }

        // ===== Step 3b: Retry failed games (up to 3 rounds) =====
        for (let round = 1; round <= 3 && failedGames.length > 0; round++) {
          const retryList = [...failedGames]
          failedGames = []

          send({
            type: 'status',
            message: `Başarısız ${retryList.length} oyun yeniden deneniyor (tur ${round}/3)...`,
          })
          console.log(`[Retry] Round ${round}: Retrying ${retryList.length} failed games...`)

          // Wait before starting retry round to let rate limit expire
          await new Promise(resolve => setTimeout(resolve, 5000 * round))

          for (let i = 0; i < retryList.length; i++) {
            const game = retryList[i]
            await new Promise(resolve => setTimeout(resolve, 2000))

            try {
              const { normalCards, foilCards, failed } = await fetchCardPrices(game.appId, game.gameName)
              if (failed) {
                failedGames.push(game)
              } else {
                const result = processGameResult(game, normalCards, foilCards)
                if (result) {
                  gameCards.push(result)
                  send({ type: 'game', data: result })
                }
              }
            } catch (err) {
              console.error(`[Retry] Failed for ${game.gameName} (${game.appId}):`, err)
              failedGames.push(game)
            }

            if (i % 5 === 0 || i === retryList.length - 1) {
              send({
                type: 'progress',
                current: allGames.length,
                total: allGames.length,
                found: gameCards.length,
                message: `Yeniden deneme tur ${round} (${i + 1}/${retryList.length}) — ${gameCards.length} kartlı oyun bulundu`,
              })
            }
          }
        }

        if (failedGames.length > 0) {
          console.warn(`[Final] ${failedGames.length} games could not be checked after all retries`)
        }

        gameCards.sort((a, b) => b.highestCardPrice - a.highestCardPrice)

        // ===== Step 4: Send complete event =====
        send({
          type: 'complete',
          data: {
            profile: profileInfo,
            games: gameCards,
            totalGamesWithCards: gameCards.length,
            scanMethod,
            totalOwnedGames: allGames.length,
          },
        })

        try { controller.close() } catch { }
      } catch (err) {
        console.error('Steam analysis error:', err)
        try {
          send({
            type: 'error',
            message: 'Profil analiz edilirken bir hata oluştu. Lütfen tekrar deneyin.',
          })
        } catch { }
        try { controller.close() } catch { }
      }
    },
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
