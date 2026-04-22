import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

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
  cards: CardInfo[]
  highestCardPrice: number
  highestCardName: string
  highestCardIsFoil: boolean
  totalCardsValue: number
  totalCards: number
  hasCardDrops: boolean
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
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
): { appId: number; gameName: string; hasCardDrops: boolean }[] {
  const games: { appId: number; gameName: string; hasCardDrops: boolean }[] = []
  const gamecardPattern =
    /gamecards\/(\d+)\/"[^>]*>[\s\S]*?<div class="badge_title"[^>]*>\s*([\s\S]*?)\s*(&nbsp;|<\/div>)/g

  let match
  while ((match = gamecardPattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    const gameName = cleanGameName(match[2])

    if (appId && gameName && !games.some(g => g.appId === appId)) {
      const rowStart = Math.max(0, match.index - 2000)
      const rowEnd = Math.min(html.length, match.index + 3000)
      const rowContext = html.substring(rowStart, rowEnd)
      const hasCardDrops = /card\s+drops?\s+remain/i.test(rowContext)

      games.push({ appId, gameName, hasCardDrops })
    }
  }

  return games
}

// ===== Helper: Parse total page count from badges pagination =====
function parseBadgesPageCount(html: string): number {
  let maxPage = 1

  const pageLinkMatches = [...html.matchAll(/(?:\?p=|page=)(\d+)/g)]
  for (const m of pageLinkMatches) {
    const p = parseInt(m[1])
    if (p > maxPage) maxPage = p
  }

  const pageOfMatch = html.match(/Page\s+\d+\s+of\s+(\d+)/i)
  if (pageOfMatch) {
    maxPage = Math.max(maxPage, parseInt(pageOfMatch[1]))
  }

  return maxPage
}

// ===== Helper: Parse SteamDB calculator page for all games =====
function parseSteamDBGames(html: string): { appId: number; gameName: string }[] {
  const games: { appId: number; gameName: string }[] = []
  const seen = new Set<number>()

  // Check if Cloudflare blocked us
  if (
    html.includes('challenge-platform') ||
    html.includes('cf-browser-verification') ||
    html.includes('Just a moment') ||
    html.includes('Enable JavaScript and cookies to continue')
  ) {
    console.log('SteamDB: Cloudflare challenge detected')
    return []
  }

  // Pattern 1: SteamDB app links — href="/app/APPID/"
  const appLinkPattern = /href="\/app\/(\d+)\/?"[^>]*>([\s\S]*?)<\/a>/g
  let match
  while ((match = appLinkPattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    const rawName = match[2].replace(/<[^>]+>/g, '').trim()
    const gameName = cleanGameName(rawName)
    if (appId && gameName && !seen.has(appId) && gameName.length > 1 && !gameName.includes('SteamDB')) {
      seen.add(appId)
      games.push({ appId, gameName })
    }
  }

  // Pattern 2: data-appid attributes
  if (games.length === 0) {
    const dataAppIdPattern = /data-appid="(\d+)"/g
    while ((match = dataAppIdPattern.exec(html)) !== null) {
      const appId = parseInt(match[1])
      if (appId && !seen.has(appId)) {
        seen.add(appId)
        games.push({ appId, gameName: `Game ${appId}` })
      }
    }
  }

  // Pattern 3: store.steampowered.com links
  if (games.length === 0) {
    const storeLinkPattern = /store\.steampowered\.com\/app\/(\d+)/g
    while ((match = storeLinkPattern.exec(html)) !== null) {
      const appId = parseInt(match[1])
      if (appId && !seen.has(appId)) {
        seen.add(appId)
        games.push({ appId, gameName: `Game ${appId}` })
      }
    }
  }

  return games
}

// ===== Helper: Parse Steam games page (rgGames JS variable) =====
function parseSteamGamesPage(
  html: string
): { appId: number; gameName: string; playtime: number }[] {
  const games: { appId: number; gameName: string; playtime: number }[] = []

  // Try to find rgGames JavaScript variable
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

  // Try to parse XML format
  // <appID>12345</appID><name>Game Name</name>
  const gamePattern = /<appID>(\d+)<\/appID>[\s\S]*?<name><!\[CDATA\[([^\]]*)\]\]><\/name>/g
  let match
  while ((match = gamePattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    const gameName = cleanGameName(match[2])
    if (appId && gameName) {
      // Try to find playtime in the same block
      const blockEnd = html.indexOf('</game>', match.index)
      const block = blockEnd > 0 ? html.substring(match.index, blockEnd) : ''
      const hoursMatch = block.match(/<hoursOnRecord>([^<]+)<\/hoursOnRecord>/)
      const playtime = hoursMatch ? Math.round(parseFloat(hoursMatch[1].replace(',', '.')) * 60) : 0
      games.push({ appId, gameName, playtime })
    }
  }

  // Fallback: try non-CDATA format
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

// ===== Helper: Fetch games directly from Steam API (no key needed for some endpoints) =====
async function fetchGamesFromSteamAPI(
  steamId: string
): Promise<{ appId: number; gameName: string; playtime: number }[]> {
  try {
    // Try the games page JSON endpoint
    const url = `https://steamcommunity.com/profiles/${steamId}/games/?tab=all`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) return []

    const html = await response.text()

    // Try rgGames JSON
    const jsonGames = parseSteamGamesPage(html)
    if (jsonGames.length > 0) return jsonGames

    // Try XML parsing
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

// ===== Helper: Fetch card prices from Steam Market API =====
async function fetchCardPrices(
  appId: number,
  gameName: string
): Promise<CardInfo[]> {
  const cards: CardInfo[] = []

  try {
    const marketUrl = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=30&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`

    const response = await fetch(marketUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (response.ok) {
      const data = await response.json()
      const results = data.results || []

      for (const item of results) {
        const hashName: string = item.hash_name || ''
        const name: string = item.name || ''
        const sellPrice: number = item.sell_price || 0
        const sellPriceText: string = item.sell_price_text || ''
        const assetDesc = item.asset_description || {}
        const iconUrl = assetDesc.icon_url || ''
        const iconUrlLarge = assetDesc.icon_url_large || ''
        const isFoil = hashName.includes('(Foil)')

        let imageUrl = ''
        if (iconUrlLarge) {
          imageUrl = `https://community.akamai.steamstatic.com/economy/image/${iconUrlLarge}/62fx62f`
        } else if (iconUrl) {
          imageUrl = `https://community.akamai.steamstatic.com/economy/image/${iconUrl}/62fx62f`
        }

        if (name && sellPrice > 0) {
          cards.push({
            name,
            price: sellPrice / 100,
            priceText: sellPriceText,
            isFoil,
            imageUrl,
            hashName,
          })
        }
      }
    }
  } catch (err) {
    console.error(`Error fetching card prices for ${gameName} (${appId}):`, err)
  }

  cards.sort((a, b) => b.price - a.price)
  return cards
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
        // ===== Step 1: Fetch profile info =====
        send({ type: 'status', message: 'Profil bilgileri alınıyor...' })

        const zai = await ZAI.create()

        const profilePageUrl =
          parsedUrl.type === 'id'
            ? `https://steamcommunity.com/id/${parsedUrl.value}/`
            : `https://steamcommunity.com/profiles/${parsedUrl.value}/`

        const profileResult = await zai.functions.invoke('page_reader', {
          url: profilePageUrl,
        })

        const profileInfo = parseProfileInfo(profileResult.data.html)

        if (!profileInfo) {
          send({
            type: 'error',
            message: 'Profil bilgileri okunamadı. Profil gizli olabilir veya geçersiz bir URL girdiniz.',
          })
          try { controller.close() } catch {}
          return
        }

        // ===== Step 2: Fetch all games — try multiple sources =====
        let allGames: {
          appId: number
          gameName: string
          hasCardDrops?: boolean
        }[] = []
        let scanMethod = 'unknown'

        // --- Source 0: Steam Web API (requires API key — most reliable) ---
        if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
          send({ type: 'status', message: 'Steam Web API ile tüm oyunlar çekiliyor...' })
          try {
            const apiGames = await fetchOwnedGamesViaAPI(profileInfo.steamId, apiKey.trim())
            if (apiGames.length > 0) {
              allGames = apiGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0,
              }))
              scanMethod = 'steam_web_api'
              send({ type: 'status', message: `Steam API'den ${allGames.length} oyun bulundu.` })
            }
          } catch (err) {
            console.error('Steam Web API failed:', err)
            send({ type: 'status', message: 'Steam API hatası, diğer kaynaklar deneniyor...' })
          }
        }

        // --- Source 1: SteamDB Calculator ---
        if (allGames.length === 0) {
          send({ type: 'status', message: 'SteamDB\'den oyunlar çekiliyor...' })

          try {
            const steamdbUrl = `https://steamdb.info/calculator/${profileInfo.steamId}/?cc=us&all_games`
            const steamdbResult = await zai.functions.invoke('page_reader', {
              url: steamdbUrl,
            })

            const steamdbGames = parseSteamDBGames(steamdbResult.data.html)

            if (steamdbGames.length > 10) {
              allGames = steamdbGames
              scanMethod = 'steamdb'
              send({
                type: 'status',
                message: `SteamDB'den ${allGames.length} oyun bulundu.`,
              })
            } else {
              console.log(
                `SteamDB returned too few games (${steamdbGames.length}), trying other sources...`
              )
            }
          } catch (err) {
            console.error('SteamDB fetch failed:', err)
          }
        }

        // --- Source 2: Steam Games Page (web-reader) ---
        if (allGames.length === 0) {
          send({
            type: 'status',
            message: 'Steam profilinden oyunlar çekiliyor...',
          })

          try {
            const gamesPageUrl = `https://steamcommunity.com/profiles/${profileInfo.steamId}/games/?tab=all`
            const gamesPageResult = await zai.functions.invoke('page_reader', {
              url: gamesPageUrl,
            })

            const gamesPageHtml = gamesPageResult.data.html
            const gamesPageGames = parseSteamGamesPage(gamesPageHtml)

            if (gamesPageGames.length > 0) {
              allGames = gamesPageGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0,
              }))
              scanMethod = 'games_page'
              send({
                type: 'status',
                message: `Steam profilinden ${allGames.length} oyun bulundu.`,
              })
            }
          } catch (err) {
            console.error('Games page (web-reader) fetch failed:', err)
          }
        }

        // --- Source 2b: Steam Games direct fetch (bypasses web-reader) ---
        if (allGames.length === 0) {
          send({
            type: 'status',
            message: 'Steam API\'den oyunlar çekiliyor...',
          })

          try {
            const apiGames = await fetchGamesFromSteamAPI(profileInfo.steamId)
            if (apiGames.length > 0) {
              allGames = apiGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0,
              }))
              scanMethod = 'steam_api'
              send({
                type: 'status',
                message: `Steam API'den ${allGames.length} oyun bulundu.`,
              })
            }
          } catch (err) {
            console.error('Steam API fetch failed:', err)
          }
        }

        // --- Source 2c: Steam XML games endpoint ---
        if (allGames.length === 0) {
          send({
            type: 'status',
            message: 'Steam XML\'den oyunlar çekiliyor...',
          })

          try {
            const xmlUrl = `https://steamcommunity.com/profiles/${profileInfo.steamId}/games/?xml=1`
            const xmlResult = await zai.functions.invoke('page_reader', {
              url: xmlUrl,
            })

            const xmlGames = parseSteamXMLGames(xmlResult.data.html)
            if (xmlGames.length > 0) {
              allGames = xmlGames.map(g => ({
                appId: g.appId,
                gameName: g.gameName,
                hasCardDrops: g.playtime > 0,
              }))
              scanMethod = 'steam_xml'
              send({
                type: 'status',
                message: `Steam XML'den ${allGames.length} oyun bulundu.`,
              })
            }
          } catch (err) {
            console.error('Steam XML fetch failed:', err)
          }
        }

        // --- Source 3: Badges Page with Extended Pagination ---
        if (allGames.length === 0) {
          send({
            type: 'status',
            message: 'Badges sayfasından oyunlar çekiliyor...',
          })
          scanMethod = 'badges'

          const badgesUrl =
            parsedUrl.type === 'id'
              ? `https://steamcommunity.com/id/${parsedUrl.value}/badges/`
              : `https://steamcommunity.com/profiles/${parsedUrl.value}/badges/`

          try {
            const firstPageResult = await zai.functions.invoke('page_reader', {
              url: badgesUrl,
            })
            const firstPageHtml = firstPageResult.data.html
            const firstPageGames = parseBadgesPage(firstPageHtml)
            const detectedPages = parseBadgesPageCount(firstPageHtml)

            allGames = [...firstPageGames]

            // Always try at least 20 pages (detected pages might be wrong due to web-reader)
            const maxPages = Math.max(detectedPages, 20)

            send({
              type: 'status',
              message: `Badges sayfası 1/${maxPages} — ${allGames.length} oyun bulundu...`,
            })

            // Fetch remaining pages until no new games found
            let consecutiveEmptyPages = 0
            for (let page = 2; page <= maxPages; page++) {
              try {
                const pageResult = await zai.functions.invoke('page_reader', {
                  url: `${badgesUrl}?p=${page}`,
                })
                const moreGames = parseBadgesPage(pageResult.data.html)
                const newGames = moreGames.filter(
                  g => !allGames.some(existing => existing.appId === g.appId)
                )

                if (newGames.length === 0) {
                  consecutiveEmptyPages++
                  // Stop after 2 consecutive empty pages
                  if (consecutiveEmptyPages >= 2) break
                } else {
                  consecutiveEmptyPages = 0
                  allGames.push(...newGames)
                }

                send({
                  type: 'status',
                  message: `Badges sayfası ${page}/${maxPages} — ${allGames.length} oyun bulundu...`,
                })
              } catch {
                break
              }
            }

            if (allGames.length > 0) {
              send({
                type: 'status',
                message: `Badges sayfasından ${allGames.length} kartlı oyun bulundu.`,
              })
            }
          } catch (err) {
            console.error('Badges page fetch failed:', err)
          }
        }

        if (allGames.length === 0) {
          send({
            type: 'error',
            message: 'Hiç oyun bulunamadı. Profil gizli olabilir veya geçersiz bir URL girdiniz.',
          })
          try { controller.close() } catch {}
          return
        }

        // ===== Step 3: Fetch card prices for all games =====
        // For badges source, games already have cards. For other sources, we need to check.
        send({
          type: 'progress',
          current: 0,
          total: allGames.length,
          found: 0,
          message: `Kart fiyatları alınıyor... (0/${allGames.length})`,
        })

        const gameCards: GameCardInfo[] = []
        const batchSize = 10
        const batchDelay = 400 // ms between batches

        for (let i = 0; i < allGames.length; i += batchSize) {
          const batch = allGames.slice(i, i + batchSize)

          const batchResults = await Promise.all(
            batch.map(async game => {
              const cards = await fetchCardPrices(game.appId, game.gameName)
              if (cards.length === 0) return null

              const highestCard = cards[0]
              const totalCardsValue = cards.reduce(
                (sum, c) => sum + c.price,
                0
              )

              return {
                appId: game.appId,
                gameName: game.gameName,
                gameIconUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`,
                cards,
                highestCardPrice: highestCard.price,
                highestCardName: highestCard.name,
                highestCardIsFoil: highestCard.isFoil,
                totalCardsValue,
                totalCards: cards.length,
                hasCardDrops: game.hasCardDrops ?? false,
              } as GameCardInfo
            })
          )

          const validResults = batchResults.filter(Boolean) as GameCardInfo[]
          gameCards.push(...validResults)

          const processed = Math.min(i + batchSize, allGames.length)

          // Send progress update
          send({
            type: 'progress',
            current: processed,
            total: allGames.length,
            found: gameCards.length,
            message: `Kart fiyatları alınıyor... (${processed}/${allGames.length}) — ${gameCards.length} kartlı oyun bulundu`,
          })

          // Send individual game results for real-time display
          for (const gameResult of validResults) {
            send({ type: 'game', data: gameResult })
          }

          // Delay between batches to avoid rate limiting
          if (i + batchSize < allGames.length) {
            await new Promise(resolve => setTimeout(resolve, batchDelay))
          }
        }

        // Sort by highest card price descending
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

        try { controller.close() } catch {}
      } catch (err) {
        console.error('Steam analysis error:', err)
        try {
          send({
            type: 'error',
            message: 'Profil analiz edilirken bir hata oluştu. Lütfen tekrar deneyin.',
          })
        } catch {}
        try { controller.close() } catch {}
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
