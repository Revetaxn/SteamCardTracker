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

interface GameCardResult {
  appId: number
  gameName: string
  normalCards: CardInfo[]
  foilCards: CardInfo[]
  totalNormalCards: number
  totalFoilCards: number
  totalNormalCardsValue: number
  totalFoilCardsValue: number
  cardDropsTotal: number
  droppableCardsValue: number
  avgCardPrice: number
  highestNormalCardPrice: number
  highestFoilCardPrice: number
}

// ===== Helper: Parse game URL or App ID =====
function parseGameInput(input: string): number | null {
  const trimmed = input.trim()

  // Pure numeric app ID
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed)
  }

  // Steam store URL: https://store.steampowered.com/app/730/CounterStrike_2/
  const storeMatch = trimmed.match(/store\.steampowered\.com\/app\/(\d+)/)
  if (storeMatch) return parseInt(storeMatch[1])

  // Steam community market URL with appid
  const communityMatch = trimmed.match(/steamcommunity\.com\/.*(?:app|game)\/(\d+)/i)
  if (communityMatch) return parseInt(communityMatch[1])

  // SteamDB URL: https://steamdb.info/app/730/
  const steamdbMatch = trimmed.match(/steamdb\.info\/app\/(\d+)/)
  if (steamdbMatch) return parseInt(steamdbMatch[1])

  return null
}

// ===== Helper: Clean HTML entities =====
function cleanGameName(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim()
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

// ===== Helper: Fetch game name from Steam Store API =====
async function fetchGameName(appId: number): Promise<string> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us`
    const response = await fetchWithRetry(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    }, 2, 1000)

    if (response.ok) {
      const data = await response.json()
      const appData = data[appId.toString()]
      if (appData?.success && appData?.data?.name) {
        return cleanGameName(appData.data.name)
      }
    }
  } catch {
    // Fall through
  }
  return `Game ${appId}`
}

// ===== Helper: Fetch card prices from Steam Market API =====
async function fetchCardPrices(appId: number, gameName: string): Promise<{ normalCards: CardInfo[]; foilCards: CardInfo[] }> {
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

    if (response.ok) {
      const data = await response.json()

      // Detect soft rate limit: Steam sometimes returns 200 OK with success=false or null
      if (!data || data.success === false) {
        console.warn(`[SoftRateLimit] Detected for ${gameName} (${appId})`)
        return { normalCards: [], foilCards: [] }
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
    }
  } catch (err) {
    console.error(`Error fetching card prices for ${gameName} (${appId}):`, err)
  }

  normalCards.sort((a, b) => b.price - a.price)
  foilCards.sort((a, b) => b.price - a.price)
  return { normalCards, foilCards }
}

// ===== Main POST Handler =====
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { gameUrl, appId: rawAppId } = body

  let appId: number | null = null

  if (rawAppId && typeof rawAppId === 'number') {
    appId = rawAppId
  } else if (gameUrl && typeof gameUrl === 'string') {
    appId = parseGameInput(gameUrl)
  }

  if (!appId) {
    return Response.json(
      { error: 'Invalid game URL or App ID. Please enter a Steam store URL or numeric App ID.' },
      { status: 400 }
    )
  }

  try {
    // Fetch game name
    const gameName = await fetchGameName(appId)

    // Fetch card prices
    const { normalCards, foilCards } = await fetchCardPrices(appId, gameName)

    if (normalCards.length === 0 && foilCards.length === 0) {
      return Response.json({
        appId,
        gameName,
        normalCards: [],
        foilCards: [],
        totalNormalCards: 0,
        totalFoilCards: 0,
        totalNormalCardsValue: 0,
        totalFoilCardsValue: 0,
        cardDropsTotal: 0,
        droppableCardsValue: 0,
        avgCardPrice: 0,
        highestNormalCardPrice: 0,
        highestFoilCardPrice: 0,
        hasCards: false,
      } as GameCardResult & { hasCards: boolean })
    }

    const totalNormalCardsValue = normalCards.reduce((sum, c) => sum + c.price, 0)
    const totalFoilCardsValue = foilCards.reduce((sum, c) => sum + c.price, 0)
    const cardDropsTotal = Math.ceil(normalCards.length / 2)
    // All normal cards can drop randomly (duplicates possible)
    // Expected value = cardDropsTotal × average card price
    const avgCardPrice = normalCards.length > 0 ? totalNormalCardsValue / normalCards.length : 0
    const droppableCardsValue = Math.round(avgCardPrice * cardDropsTotal * 100) / 100
    const highestNormalCardPrice = normalCards.length > 0 ? normalCards[0].price : 0
    const highestFoilCardPrice = foilCards.length > 0 ? foilCards[0].price : 0

    const result: GameCardResult & { hasCards: boolean } = {
      appId,
      gameName,
      normalCards,
      foilCards,
      totalNormalCards: normalCards.length,
      totalFoilCards: foilCards.length,
      totalNormalCardsValue,
      totalFoilCardsValue,
      cardDropsTotal,
      droppableCardsValue,
      avgCardPrice,
      highestNormalCardPrice,
      highestFoilCardPrice,
      hasCards: true,
    }

    return Response.json(result)
  } catch (err) {
    console.error('Game card lookup error:', err)
    return Response.json(
      { error: 'Failed to fetch card data. Please try again.' },
      { status: 500 }
    )
  }
}
