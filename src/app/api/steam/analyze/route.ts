import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

// Types
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
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

// Helper: Extract Steam ID type from URL
function parseSteamUrl(url: string): { type: 'id' | 'profiles'; value: string } | null {
  const idMatch = url.match(/steamcommunity\.com\/id\/([^/?\s]+)/)
  if (idMatch) return { type: 'id', value: idMatch[1] }

  const profileMatch = url.match(/steamcommunity\.com\/profiles\/(\d+)/)
  if (profileMatch) return { type: 'profiles', value: profileMatch[1] }

  return null
}

// Helper: Parse profile page HTML to extract profile info
function parseProfileInfo(html: string): ProfileInfo | null {
  // Extract g_rgProfileData
  const profileDataMatch = html.match(
    /g_rgProfileData\s*=\s*({[^}]+})/
  )
  if (!profileDataMatch) return null

  try {
    const profileData = JSON.parse(profileDataMatch[1])
    const steamId = profileData.steamid || ''
    const personaName = profileData.personaname || ''
    const profileUrl = profileData.url || ''

    // Extract avatar from og:image or image_src
    const avatarMatch = html.match(
      /<link rel="image_src" href="([^"]+)"/
    ) || html.match(
      /<meta property="og:image" content="([^"]+)"/
    )
    const avatarUrl = avatarMatch
      ? avatarMatch[1].replace('_full.jpg', '_medium.jpg')
      : ''

    // Extract game count
    const gameCountMatch = html.match(
      /Games[^<]*<[^>]*>\s*<[^>]*>\s*(\d+)/
    )
    const gameCount = gameCountMatch ? parseInt(gameCountMatch[1]) : 0

    return {
      steamId,
      personaName,
      avatarUrl,
      profileUrl,
      gameCount,
    }
  } catch {
    return null
  }
}

// Helper: Clean HTML entities and extra text from game names
function cleanGameName(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/View details/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Helper: Parse badges page to extract games with trading cards
function parseBadgesPage(html: string): { appId: number; gameName: string }[] {
  const games: { appId: number; gameName: string }[] = []

  // Find all gamecard links with their game names
  const gamecardPattern =
    /gamecards\/(\d+)\/"[^>]*>[\s\S]*?<div class="badge_title"[^>]*>\s*([\s\S]*?)\s*(&nbsp;|<\/div>)/g

  let match
  while ((match = gamecardPattern.exec(html)) !== null) {
    const appId = parseInt(match[1])
    const gameName = cleanGameName(match[2])

    if (appId && gameName) {
      // Avoid duplicates
      if (!games.some(g => g.appId === appId)) {
        games.push({ appId, gameName })
      }
    }
  }

  return games
}

// Helper: Fetch card prices from Steam Market API
async function fetchCardPrices(
  appId: number,
  gameName: string
): Promise<CardInfo[]> {
  const cards: CardInfo[] = []

  try {
    // Fetch trading cards sorted by price desc (includes both normal and foil)
    const marketUrl = `https://steamcommunity.com/market/search/render/?norender=1&query=&start=0&count=30&search_descriptions=0&sort_column=price&sort_dir=desc&category_753_Game[]=tag_app_${appId}&category_753_item_class[]=tag_item_class_2`

    const response = await fetch(marketUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
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

        // Construct image URL
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

  // Sort by price desc
  cards.sort((a, b) => b.price - a.price)

  return cards
}

// Helper: Process games in batches
async function processGamesInBatches(
  games: { appId: number; gameName: string }[],
  batchSize: number = 5
): Promise<GameCardInfo[]> {
  const results: GameCardInfo[] = []

  for (let i = 0; i < games.length; i += batchSize) {
    const batch = games.slice(i, i + batchSize)

    const batchResults = await Promise.all(
      batch.map(async game => {
        const cards = await fetchCardPrices(game.appId, game.gameName)

        if (cards.length === 0) return null

        const highestCard = cards[0] // Already sorted by price desc
        const totalCardsValue = cards.reduce((sum, c) => sum + c.price, 0)

        // Get game icon URL
        const gameIconUrl = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`

        return {
          appId: game.appId,
          gameName: game.gameName,
          gameIconUrl,
          cards,
          highestCardPrice: highestCard.price,
          highestCardName: highestCard.name,
          highestCardIsFoil: highestCard.isFoil,
          totalCardsValue,
          totalCards: cards.length,
        } as GameCardInfo
      })
    )

    results.push(...batchResults.filter(Boolean) as GameCardInfo[])

    // Small delay between batches to avoid rate limiting
    if (i + batchSize < games.length) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return results
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url } = body

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'Steam profil URL\'si gereklidir' },
        { status: 400 }
      )
    }

    // Parse URL
    const parsedUrl = parseSteamUrl(url)
    if (!parsedUrl) {
      return NextResponse.json(
        { error: 'Geçersiz Steam profil URL\'si. Format: https://steamcommunity.com/id/kullaniciadi/ veya https://steamcommunity.com/profiles/76561198xxxxxxxxx/' },
        { status: 400 }
      )
    }

    // Initialize Z-AI SDK for web reading
    const zai = await ZAI.create()

    // Step 1: Fetch profile page to get profile info
    const profilePageUrl =
      parsedUrl.type === 'id'
        ? `https://steamcommunity.com/id/${parsedUrl.value}/`
        : `https://steamcommunity.com/profiles/${parsedUrl.value}/`

    const profileResult = await zai.functions.invoke('page_reader', {
      url: profilePageUrl,
    })

    const profileInfo = parseProfileInfo(profileResult.data.html)

    if (!profileInfo) {
      return NextResponse.json(
        { error: 'Profil bilgileri okunamadı. Profil gizli olabilir veya geçersiz bir URL girdiniz.' },
        { status: 404 }
      )
    }

    // Step 2: Fetch badges page to get games with trading cards
    const badgesUrl =
      parsedUrl.type === 'id'
        ? `https://steamcommunity.com/id/${parsedUrl.value}/badges/`
        : `https://steamcommunity.com/profiles/${parsedUrl.value}/badges/`

    const badgesResult = await zai.functions.invoke('page_reader', {
      url: badgesUrl,
    })

    let gamesWithCards = parseBadgesPage(badgesResult.data.html)

    // Fetch additional badge pages (check up to page 3 for larger collections)
    for (let page = 2; page <= 3; page++) {
      try {
        const pageResult = await zai.functions.invoke('page_reader', {
          url: `${badgesUrl}?p=${page}`,
        })
        const moreGames = parseBadgesPage(pageResult.data.html)
        if (moreGames.length === 0) break
        for (const game of moreGames) {
          if (!gamesWithCards.some(g => g.appId === game.appId)) {
            gamesWithCards.push(game)
          }
        }
      } catch {
        break // Stop if page fetch fails
      }
    }

    if (gamesWithCards.length === 0) {
      return NextResponse.json({
        profile: profileInfo,
        games: [],
        totalGamesWithCards: 0,
      })
    }

    // Step 3: Fetch card prices for all games
    const gameCards = await processGamesInBatches(gamesWithCards, 5)

    // Sort by highest card price descending
    gameCards.sort((a, b) => b.highestCardPrice - a.highestCardPrice)

    return NextResponse.json({
      profile: profileInfo,
      games: gameCards,
      totalGamesWithCards: gameCards.length,
    })
  } catch (err) {
    console.error('Steam analysis error:', err)
    return NextResponse.json(
      { error: 'Profil analiz edilirken bir hata oluştu. Lütfen tekrar deneyin.' },
      { status: 500 }
    )
  }
}
