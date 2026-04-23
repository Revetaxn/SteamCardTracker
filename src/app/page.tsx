'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Search,
  Gamepad2,
  TrendingUp,
  ChevronDown,
  ExternalLink,
  Loader2,
  ArrowUpDown,
  Coins,
  Zap,
  BarChart3,
  X,
  RefreshCw,
  Key,
  Info,
  Sparkles,
  Layers,
  Globe,
  Package,
} from 'lucide-react'

// ===== i18n Translation Dictionary =====
type Lang = 'tr' | 'en'

const translations: Record<Lang, Record<string, string>> = {
  tr: {
    // Header
    appTitle: 'Steam Kart Takipçi',
    cardPriceTrack: 'Kart Fiyat Takip',

    // Tabs
    tabProfile: 'Profil Analizi',
    tabGame: 'Oyun Kartları',

    // Profile tab
    profilePlaceholder: "Steam profil URL'si girin... (örn: https://steamcommunity.com/id/kullaniciadi/)",
    analyze: 'Analiz Et',
    cancel: 'İptal',
    hideApiKey: 'API Anahtarını Gizle',
    showApiKey: 'Steam API Anahtarı (opsiyonel — tüm oyunlar için)',
    apiKeyPlaceholder: 'Steam Web API Anahtarı...',
    whyNeeded: 'Neden gerekli?',
    whyNeededDesc: 'API anahtarı olmadan yalnızca oynanmış kartlı oyunlar listelenir. 500+ oyununuz varsa tamamını taramak için API anahtarı gerekir.',
    getFreeKey: 'Ücretsiz API anahtarı alın →',
    starting: 'Başlatılıyor...',
    gamesScanned: 'oyun tarandı',
    cardsFound: 'kartlı oyun bulundu',

    // Game tab
    gameUrlPlaceholder: 'Steam oyun linki veya App ID girin... (örn: https://store.steampowered.com/app/730/)',
    lookupCards: 'Kartları Getir',
    searching: 'Aranıyor...',
    noCardsFound: 'Bu oyunda trading kart bulunamadı.',
    noCardsDesc: 'Bu oyun trading kartlarını desteklemiyor olabilir veya henüz kart çıkmamış olabilir.',
    gameNotFound: 'Oyun bulunamadı. Geçerli bir Steam mağaza URL\'si veya App ID girin.',
    lookupError: 'Kart bilgileri alınamadı. Lütfen tekrar deneyin.',

    // Profile info
    viewProfile: 'Profili Görüntüle',
    allGames: '✓ Tüm Oyunlar',
    steamdb: '✓ SteamDB',
    steamProfile: '✓ Steam Profil',
    onlyPlayed: '⚠ Yalnızca Oynanmış',
    limitedScan: 'Sınırlı tarama:',
    limitedScanDesc: 'Yalnızca oynanmış kartlı oyunlar listelendi. Tüm oyunlarınızı taramak için',
    addApiKey: 'Steam API anahtarı ekleyin',

    // Stats
    cardGames: 'Kartlı Oyun',
    droppableValue: 'Düşebilir Değer',
    totalNormal: 'Tüm Normal Top.',
    totalDrops: 'Toplam Düşecek',
    normalCards: 'Normal Kart',
    foilCards: 'Foil Kartlar',
    totalValue: 'Toplam Değer',
    foilValue: 'Foil Değer',
    dropCount: 'Düşecek Sayı',
    highestCard: 'En Yüksek',

    // Sort
    gamesSortedBy: 'Oyunlar — Düşebilecek Kart Değerine Göre',
    sortDroppable: 'Düşebilir',
    sortHighest: 'En Yüksek',
    sortTotal: 'Toplam',
    sortDrops: 'Düşecek',

    // Game rows
    cardDropsBadge: 'kart düşebilir',
    normalFoil: 'normal',
    foilLabel: 'foil',

    // Expanded sections
    droppableCards: 'Düşebilecek Kartlar',
    otherNormalCards: 'Diğer Normal Kartlar',
    tradeOnly: 'düşmez, takas ile alınır',
    foilCardsSection: 'Foil Kartlar',
    notIncludedInTotal: 'toplama dahil değil',
    viewOnMarket: "Steam Market'te görüntüle",

    // Empty state
    discoverTitle: 'Steam Kart Değerlerinizi Keşfedin',
    discoverDesc: "Steam profil URL'nizi girin ve hangi oyunların en değerli trading kartlarını düşürdüğünü görün. Kaç kart düşeceği ve toplam kazancınızı anında görün.",
    exampleUrlTitle: 'Örnek URL formatları',
    featureLivePrices: 'Güncel Fiyatlar',
    featureLivePricesDesc: 'Steam Market canlı veriler',
    featureDroppableCards: 'Düşecek Kartlar',
    featureDroppableCardsDesc: 'Kaç kart düşeceği bilgisi',
    featureSmartSort: 'Akıllı Sıralama',
    featureSmartSortDesc: 'En karlı kartlar üstte',
    featureFoilCards: 'Foil Kartlar',
    featureFoilCardsDesc: 'Bilgi amaçlı foil fiyatları',

    // Game lookup empty state
    gameLookupTitle: 'Oyun Kartlarını Arayın',
    gameLookupDesc: 'Herhangi bir Steam oyununun trading kartlarını ve fiyatlarını hızlıca görün. Oyun mağaza linkini veya App ID\'sini yapıştırın.',
    featureAllCards: 'Tüm Kartlar',
    featureAllCardsDesc: 'Normal ve foil kartlar',
    featureDropInfo: 'Düşme Bilgisi',
    featureDropInfoDesc: 'Kaç kart düşebilir',
    featureLivePrice: 'Canlı Fiyat',
    featureLivePriceDesc: 'Güncel piyasa fiyatı',
    featureFoilInfo: 'Foil Bilgisi',
    featureFoilInfoDesc: 'Parlak kart fiyatları',

    // Footer
    footer: 'Steam Kart Takipçi — Steam Market güncel fiyatları gerçek zamanlı çekilir • Fiyatlar USD cinsindendir • Foil kartlar toplama dahil değildir',
  },
  en: {
    // Header
    appTitle: 'Steam Card Tracker',
    cardPriceTrack: 'Card Price Track',

    // Tabs
    tabProfile: 'Profile Analysis',
    tabGame: 'Game Cards',

    // Profile tab
    profilePlaceholder: 'Enter Steam profile URL... (e.g.: https://steamcommunity.com/id/username/)',
    analyze: 'Analyze',
    cancel: 'Cancel',
    hideApiKey: 'Hide API Key',
    showApiKey: 'Steam API Key (optional — for all games)',
    apiKeyPlaceholder: 'Steam Web API Key...',
    whyNeeded: 'Why needed?',
    whyNeededDesc: 'Without an API key, only played card games are listed. If you have 500+ games, an API key is required to scan them all.',
    getFreeKey: 'Get free API key →',
    starting: 'Starting...',
    gamesScanned: 'games scanned',
    cardsFound: 'card games found',

    // Game tab
    gameUrlPlaceholder: 'Enter Steam game URL or App ID... (e.g.: https://store.steampowered.com/app/730/)',
    lookupCards: 'Lookup Cards',
    searching: 'Searching...',
    noCardsFound: 'No trading cards found for this game.',
    noCardsDesc: 'This game may not support trading cards or cards may not have been released yet.',
    gameNotFound: 'Game not found. Please enter a valid Steam store URL or App ID.',
    lookupError: 'Failed to fetch card data. Please try again.',

    // Profile info
    viewProfile: 'View Profile',
    allGames: '✓ All Games',
    steamdb: '✓ SteamDB',
    steamProfile: '✓ Steam Profile',
    onlyPlayed: '⚠ Played Only',
    limitedScan: 'Limited scan:',
    limitedScanDesc: 'Only played card games are listed. To scan all your games,',
    addApiKey: 'add a Steam API key',

    // Stats
    cardGames: 'Card Games',
    droppableValue: 'Droppable Value',
    totalNormal: 'Total Normal',
    totalDrops: 'Total Drops',
    normalCards: 'Normal Cards',
    foilCards: 'Foil Cards',
    totalValue: 'Total Value',
    foilValue: 'Foil Value',
    dropCount: 'Drop Count',
    highestCard: 'Highest Card',

    // Sort
    gamesSortedBy: 'Games — Sorted by Droppable Card Value',
    sortDroppable: 'Droppable',
    sortHighest: 'Highest',
    sortTotal: 'Total',
    sortDrops: 'Drops',

    // Game rows
    cardDropsBadge: 'card drops',
    normalFoil: 'normal',
    foilLabel: 'foil',

    // Expanded sections
    droppableCards: 'Droppable Cards',
    otherNormalCards: 'Other Normal Cards',
    tradeOnly: 'won\'t drop, trade only',
    notIncludedInTotal: 'not included in total',
    foilCardsSection: 'Foil Cards',
    viewOnMarket: 'View on Steam Market',

    // Empty state
    discoverTitle: 'Discover Your Steam Card Values',
    discoverDesc: "Enter your Steam profile URL to see which games drop the most valuable trading cards. See how many cards drop and your total earnings instantly.",
    exampleUrlTitle: 'Example URL formats',
    featureLivePrices: 'Live Prices',
    featureLivePricesDesc: 'Steam Market real-time data',
    featureDroppableCards: 'Droppable Cards',
    featureDroppableCardsDesc: 'Card drop count info',
    featureSmartSort: 'Smart Sorting',
    featureSmartSortDesc: 'Most profitable cards on top',
    featureFoilCards: 'Foil Cards',
    featureFoilCardsDesc: 'Foil card prices for info',

    // Game lookup empty state
    gameLookupTitle: 'Look Up Game Cards',
    gameLookupDesc: 'Quickly see trading cards and prices for any Steam game. Paste the game store link or App ID.',
    featureAllCards: 'All Cards',
    featureAllCardsDesc: 'Normal and foil cards',
    featureDropInfo: 'Drop Info',
    featureDropInfoDesc: 'How many cards can drop',
    featureLivePrice: 'Live Price',
    featureLivePriceDesc: 'Current market price',
    featureFoilInfo: 'Foil Info',
    featureFoilInfoDesc: 'Shiny card prices',

    // Footer
    footer: 'Steam Card Tracker — Steam Market live prices fetched in real-time • Prices are in USD • Foil cards are not included in totals',
  },
}

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
  hasCardDrops: boolean
}

interface GameLookupResult {
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
  highestNormalCardPrice: number
  highestFoilCardPrice: number
  hasCards: boolean
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

type SortField = 'highestCardPrice' | 'droppableCardsValue' | 'totalNormalCardsValue' | 'cardDropsTotal' | 'gameName'
type SortDirection = 'asc' | 'desc'

export default function Home() {
  // Language
  const [lang, setLang] = useState<Lang>('tr')
  const t = (key: string) => translations[lang][key] || key

  // Tab
  const [activeTab, setActiveTab] = useState('profile')

  // Profile analysis state
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<GameCardInfo[]>([])
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [totalOwnedGames, setTotalOwnedGames] = useState(0)
  const [scanMethod, setScanMethod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('droppableCardsValue')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedGames, setExpandedGames] = useState<Set<number>>(new Set())

  // SSE state
  const [statusMessage, setStatusMessage] = useState('')
  const [progress, setProgress] = useState<{
    current: number
    total: number
    found: number
  } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Game lookup state
  const [gameUrl, setGameUrl] = useState('')
  const [gameLoading, setGameLoading] = useState(false)
  const [gameResult, setGameResult] = useState<GameLookupResult | null>(null)
  const [gameError, setGameError] = useState<string | null>(null)

  // ===== Profile Analysis =====
  const analyzeProfile = useCallback(async () => {
    if (!url.trim()) return

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setLoading(true)
    setError(null)
    setGames([])
    setProfile(null)
    setTotalOwnedGames(0)
    setScanMethod('')
    setProgress(null)
    setStatusMessage(t('starting'))
    setExpandedGames(new Set())

    try {
      const response = await fetch('/api/steam/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), apiKey: apiKey.trim() || undefined, lang }),
        signal: abortController.signal,
      })

      if (!response.body) {
        throw new Error('Streaming not supported')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                switch (data.type) {
                  case 'status':
                    setStatusMessage(data.message)
                    break
                  case 'progress':
                    setProgress({ current: data.current, total: data.total, found: data.found })
                    setStatusMessage(data.message)
                    break
                  case 'game':
                    setGames(prev => {
                      const newGames = [...prev, data.data]
                      newGames.sort((a, b) => b.droppableCardsValue - a.droppableCardsValue)
                      return newGames
                    })
                    break
                  case 'complete':
                    setProfile(data.data.profile)
                    setTotalOwnedGames(data.data.totalOwnedGames)
                    setScanMethod(data.data.scanMethod)
                    setGames(prev => [...prev].sort((a, b) => b.droppableCardsValue - a.droppableCardsValue))
                    setLoading(false)
                    break
                  case 'error':
                    setError(data.message)
                    setLoading(false)
                    break
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusMessage(lang === 'tr' ? 'İptal edildi' : 'Cancelled')
      } else {
        setError(err instanceof Error ? err.message : (lang === 'tr' ? 'Bilinmeyen bir hata oluştu' : 'An unknown error occurred'))
      }
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, lang, t])

  const cancelAnalysis = useCallback(() => {
    abortControllerRef.current?.abort()
    setLoading(false)
    setStatusMessage(lang === 'tr' ? 'İptal edildi' : 'Cancelled')
  }, [lang])

  // ===== Game Lookup =====
  const lookupGameCards = useCallback(async () => {
    if (!gameUrl.trim()) return
    setGameLoading(true)
    setGameError(null)
    setGameResult(null)

    try {
      const response = await fetch('/api/steam/game-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameUrl: gameUrl.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setGameError(data.error || t('lookupError'))
        return
      }

      if (!data.hasCards) {
        setGameError(t('noCardsFound'))
      }

      setGameResult(data)
    } catch {
      setGameError(t('lookupError'))
    } finally {
      setGameLoading(false)
    }
  }, [gameUrl, t])

  // ===== Sort & Expand =====
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDirection(field === 'gameName' ? 'asc' : 'desc')
    }
  }

  const toggleExpand = (appId: number) => {
    setExpandedGames(prev => {
      const next = new Set(prev)
      if (next.has(appId)) next.delete(appId)
      else next.add(appId)
      return next
    })
  }

  const sortedGames = games.length > 0
    ? [...games].sort((a, b) => {
        let comparison = 0
        switch (sortField) {
          case 'highestCardPrice': comparison = a.highestCardPrice - b.highestCardPrice; break
          case 'droppableCardsValue': comparison = a.droppableCardsValue - b.droppableCardsValue; break
          case 'totalNormalCardsValue': comparison = a.totalNormalCardsValue - b.totalNormalCardsValue; break
          case 'cardDropsTotal': comparison = a.cardDropsTotal - b.cardDropsTotal; break
          case 'gameName': comparison = a.gameName.localeCompare(b.gameName); break
        }
        return sortDirection === 'desc' ? -comparison : comparison
      })
    : []

  const getRankBadge = (index: number) => {
    if (index === 0) return { label: '#1', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' }
    if (index === 1) return { label: '#2', className: 'bg-gray-400/20 text-gray-300 border-gray-400/30' }
    if (index === 2) return { label: '#3', className: 'bg-amber-700/20 text-amber-500 border-amber-600/30' }
    return { label: `#${index + 1}`, className: 'bg-[#2a475e]/30 text-[#8f98a0] border-[#2a475e]/50' }
  }

  // Stats
  const totalDroppableValue = games.reduce((sum, g) => sum + g.droppableCardsValue, 0) || 0
  const totalAllNormalValue = games.reduce((sum, g) => sum + g.totalNormalCardsValue, 0) || 0
  const totalCardDrops = games.reduce((sum, g) => sum + g.cardDropsTotal, 0) || 0
  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0

  // ===== Render: Game Lookup Card Detail =====
  const renderGameLookupCards = (result: GameLookupResult) => {
    const totalFoilValue = result.foilCards.reduce((s, c) => s + c.price, 0)
    return (
      <div className="space-y-4">
        {/* Game Header */}
        <div className="flex items-center gap-3">
          <img
            src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${result.appId}/capsule_231x87.jpg`}
            alt={result.gameName}
            className="w-16 h-16 rounded-md object-cover bg-[#2a475e]/30 flex-shrink-0"
            onError={e => {
              ;(e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0YTVhNmIiIHN0cm9rZS13aWR0aD0iMS41Ij48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+PHBhdGggZD0iTTggMjFoOCIvPjwvc3ZnPg=='
            }}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-[#c7d5e0] truncate">{result.gameName}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <a href={`https://store.steampowered.com/app/${result.appId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#66c0f4] hover:underline flex items-center gap-1">
                Steam <ExternalLink className="w-2.5 h-2.5" />
              </a>
              <a href={`https://steamcommunity.com/market/search?q=&appid=753&category_753_Game[]=tag_app_${result.appId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#66c0f4] hover:underline flex items-center gap-1">
                Market <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Card className="bg-[#2a475e]/30 border-[#2a475e]/50">
            <CardContent className="p-2.5 text-center">
              <Layers className="w-3.5 h-3.5 text-[#66c0f4] mx-auto mb-0.5" />
              <div className="text-sm font-bold text-[#66c0f4]">{result.totalNormalCards}</div>
              <div className="text-[9px] text-[#8f98a0]">{t('normalCards')}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#2a475e]/30 border-[#2a475e]/50">
            <CardContent className="p-2.5 text-center">
              <Zap className="w-3.5 h-3.5 text-green-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold text-green-400">${result.droppableCardsValue.toFixed(2)}</div>
              <div className="text-[9px] text-[#8f98a0]">{t('droppableValue')}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#2a475e]/30 border-[#2a475e]/50">
            <CardContent className="p-2.5 text-center">
              <BarChart3 className="w-3.5 h-3.5 text-purple-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold text-purple-400">${result.totalNormalCardsValue.toFixed(2)}</div>
              <div className="text-[9px] text-[#8f98a0]">{t('totalValue')}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#2a475e]/30 border-[#2a475e]/50">
            <CardContent className="p-2.5 text-center">
              <Coins className="w-3.5 h-3.5 text-amber-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold text-amber-400">{result.cardDropsTotal}</div>
              <div className="text-[9px] text-[#8f98a0]">{t('dropCount')}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#2a475e]/30 border-[#2a475e]/50">
            <CardContent className="p-2.5 text-center">
              <Sparkles className="w-3.5 h-3.5 text-yellow-400 mx-auto mb-0.5" />
              <div className="text-sm font-bold text-yellow-400">{result.totalFoilCards}</div>
              <div className="text-[9px] text-[#8f98a0]">{t('foilCards')}</div>
            </CardContent>
          </Card>
        </div>

        {/* Droppable Normal Cards */}
        {result.normalCards.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-green-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {t('droppableCards')} ({result.cardDropsTotal}/{result.totalNormalCards})
              <span className="text-green-400 ml-1 normal-case font-bold">— ${result.droppableCardsValue.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {result.normalCards.slice(0, result.cardDropsTotal).map((card, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-green-500/5 border border-green-500/10 rounded-md px-2 py-1.5 hover:bg-green-500/10 transition-colors">
                  <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[#c7d5e0] truncate">{card.name}</div>
                    <div className="text-[10px] text-green-400 font-medium">${card.price.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Remaining Normal Cards */}
        {result.normalCards.length > result.cardDropsTotal && (
          <div>
            <div className="text-[10px] font-semibold text-[#8f98a0] uppercase tracking-wider mb-1.5">
              {t('otherNormalCards')} ({result.normalCards.length - result.cardDropsTotal})
              <span className="ml-1 normal-case font-normal text-[#8f98a0]/60">— {t('tradeOnly')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {result.normalCards.slice(result.cardDropsTotal).map((card, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-[#2a475e]/20 rounded-md px-2 py-1.5 hover:bg-[#2a475e]/30 transition-colors opacity-60">
                  <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[#c7d5e0] truncate">{card.name}</div>
                    <div className="text-[10px] text-green-400/60 font-medium">${card.price.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Foil Cards */}
        {result.foilCards.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-yellow-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              {t('foilCardsSection')} ({result.foilCards.length})
              <span className="text-yellow-400/50 ml-1 normal-case font-normal">— {t('notIncludedInTotal')}</span>
              <span className="text-yellow-400 ml-1 normal-case font-bold">— ${totalFoilValue.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
              {result.foilCards.map((card, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-yellow-500/5 border border-yellow-500/10 rounded-md px-2 py-1.5 hover:bg-yellow-500/10 transition-colors">
                  <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-[#c7d5e0] truncate">
                      {card.name} <span className="text-yellow-400">★</span>
                    </div>
                    <div className="text-[10px] text-yellow-400/80 font-medium">${card.price.toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#1b2838]">
      {/* Header */}
      <header className="bg-[#171a21] border-b border-[#2a475e]/50 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#66c0f4]/10 flex items-center justify-center">
              <Gamepad2 className="w-5 h-5 text-[#66c0f4]" />
            </div>
            <h1 className="text-lg font-bold text-[#c7d5e0] tracking-tight">
              {t('appTitle')}
            </h1>
          </div>
          {/* Language Toggle */}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setLang('tr')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                lang === 'tr'
                  ? 'bg-[#66c0f4]/20 text-[#66c0f4] border border-[#66c0f4]/30'
                  : 'text-[#8f98a0]/60 hover:text-[#8f98a0] hover:bg-[#2a475e]/30'
              }`}
            >
              <Globe className="w-3 h-3" />
              TR
            </button>
            <button
              onClick={() => setLang('en')}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
                lang === 'en'
                  ? 'bg-[#66c0f4]/20 text-[#66c0f4] border border-[#66c0f4]/30'
                  : 'text-[#8f98a0]/60 hover:text-[#8f98a0] hover:bg-[#2a475e]/30'
              }`}
            >
              <Globe className="w-3 h-3" />
              EN
            </button>
          </div>
          <Badge variant="outline" className="text-[10px] border-[#66c0f4]/30 text-[#66c0f4] hidden sm:inline-flex">
            <Coins className="w-3 h-3 mr-1" />
            {t('cardPriceTrack')}
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-[#1e2d3d] border border-[#2a475e]/50 mb-4 w-full grid grid-cols-2 h-10">
            <TabsTrigger value="profile" className="text-xs data-[state=active]:bg-[#66c0f4]/20 data-[state=active]:text-[#66c0f4]">
              <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
              {t('tabProfile')}
            </TabsTrigger>
            <TabsTrigger value="game" className="text-xs data-[state=active]:bg-[#66c0f4]/20 data-[state=active]:text-[#66c0f4]">
              <Package className="w-3.5 h-3.5 mr-1.5" />
              {t('tabGame')}
            </TabsTrigger>
          </TabsList>

          {/* ====== PROFILE ANALYSIS TAB ====== */}
          <TabsContent value="profile" className="mt-0">
            {/* Search Section */}
            <Card className="bg-[#1e2d3d] border-[#2a475e]/50 mb-5">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8f98a0]" />
                    <Input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !loading && analyzeProfile()}
                      placeholder={t('profilePlaceholder')}
                      className="pl-9 bg-[#2a475e]/40 border-[#2a475e] text-[#c7d5e0] placeholder:text-[#8f98a0]/60 focus:border-[#66c0f4] h-11 text-sm"
                      disabled={loading}
                    />
                  </div>
                  {loading ? (
                    <Button onClick={cancelAnalysis} className="bg-red-500/80 hover:bg-red-600 text-white font-semibold h-11 px-6">
                      <X className="w-4 h-4 mr-2" />{t('cancel')}
                    </Button>
                  ) : (
                    <Button onClick={analyzeProfile} disabled={!url.trim()} className="bg-[#66c0f4] hover:bg-[#4fa3d6] text-[#1b2838] font-semibold h-11 px-6 disabled:opacity-50">
                      <TrendingUp className="w-4 h-4 mr-2" />{t('analyze')}
                    </Button>
                  )}
                </div>

                {/* API Key Section */}
                <div className="mt-3">
                  <button onClick={() => setShowApiKey(!showApiKey)} className="flex items-center gap-1.5 text-[11px] text-[#8f98a0]/70 hover:text-[#66c0f4] transition-colors" type="button">
                    <Key className="w-3 h-3" />
                    {showApiKey ? t('hideApiKey') : t('showApiKey')}
                  </button>
                  {showApiKey && (
                    <div className="mt-2 space-y-2">
                      <div className="relative">
                        <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8f98a0]/60" />
                        <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={t('apiKeyPlaceholder')} className="pl-8 bg-[#2a475e]/40 border-[#2a475e] text-[#c7d5e0] placeholder:text-[#8f98a0]/60 focus:border-[#66c0f4] h-9 text-xs" disabled={loading} type="password" />
                      </div>
                      <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#66c0f4]/5 border border-[#66c0f4]/10">
                        <Info className="w-3.5 h-3.5 text-[#66c0f4] flex-shrink-0 mt-0.5" />
                        <div className="text-[10px] text-[#8f98a0] leading-relaxed">
                          <strong className="text-[#66c0f4]">{t('whyNeeded')}</strong> {t('whyNeededDesc')}{' '}
                          <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-[#66c0f4] hover:underline">{t('getFreeKey')}</a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress Bar */}
                {loading && (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#8f98a0]">{statusMessage}</span>
                      {progress && <span className="text-xs text-[#66c0f4] font-medium">{progressPercent}%</span>}
                    </div>
                    <Progress value={progressPercent} className="h-2 bg-[#2a475e]/50 [&>div]:bg-[#66c0f4]" />
                    {progress && (
                      <div className="flex items-center justify-between text-[10px] text-[#8f98a0]/60">
                        <span>{progress.current}/{progress.total} {t('gamesScanned')}</span>
                        <span>{progress.found} {t('cardsFound')}</span>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
                )}
              </CardContent>
            </Card>

            {/* Profile Info + Stats */}
            {(profile || games.length > 0) && (
              <div className="mb-5 space-y-3">
                {profile && (
                  <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <img src={profile.avatarUrl} alt={profile.personaName} className="w-14 h-14 rounded-md border-2 border-[#66c0f4]/30" />
                        <div className="flex-1 min-w-0">
                          <h2 className="text-base font-bold text-[#c7d5e0] truncate">{profile.personaName}</h2>
                          <div className="flex items-center gap-2 mt-0.5">
                            <a href={profile.profileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[#66c0f4] hover:underline flex items-center gap-1">
                              {t('viewProfile')} <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                            {scanMethod && (
                              <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${scanMethod === 'badges' ? 'border-amber-500/30 text-amber-400' : 'border-green-500/30 text-green-400'}`}>
                                {scanMethod === 'steam_web_api' ? t('allGames') : scanMethod === 'steamdb' ? t('steamdb') : scanMethod === 'games_page' ? t('steamProfile') : t('onlyPlayed')}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {loading && <Loader2 className="w-5 h-5 text-[#66c0f4] animate-spin" />}
                      </div>
                      {scanMethod === 'badges' && !loading && (
                        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
                          <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                          <div className="text-[10px] text-[#8f98a0] leading-relaxed">
                            <strong className="text-amber-400">{t('limitedScan')}</strong> {t('limitedScanDesc')} <button onClick={() => setShowApiKey(true)} className="text-[#66c0f4] hover:underline">{t('addApiKey')}</button>.
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-2">
                  <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-3 text-center">
                      <Layers className="w-4 h-4 text-[#66c0f4] mx-auto mb-1" />
                      <div className="text-lg font-bold text-[#66c0f4]">{games.length}</div>
                      <div className="text-[10px] text-[#8f98a0]">{t('cardGames')}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-3 text-center">
                      <Zap className="w-4 h-4 text-green-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-green-400">${totalDroppableValue.toFixed(2)}</div>
                      <div className="text-[10px] text-[#8f98a0]">{t('droppableValue')}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-3 text-center">
                      <BarChart3 className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-purple-400">${totalAllNormalValue.toFixed(2)}</div>
                      <div className="text-[10px] text-[#8f98a0]">{t('totalNormal')}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-3 text-center">
                      <Coins className="w-4 h-4 text-amber-400 mx-auto mb-1" />
                      <div className="text-lg font-bold text-amber-400">{totalCardDrops}</div>
                      <div className="text-[10px] text-[#8f98a0]">{t('totalDrops')}</div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Loading Skeleton */}
            {loading && games.length === 0 && !profile && (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="bg-[#1e2d3d] border-[#2a475e]/50">
                    <CardContent className="p-4 flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded bg-[#2a475e]/50 flex-shrink-0" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-40 bg-[#2a475e]/50" />
                        <Skeleton className="h-3 w-28 bg-[#2a475e]/50" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded bg-[#2a475e]/50" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Results */}
            {sortedGames.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-[#8f98a0] uppercase tracking-wider">
                    {t('gamesSortedBy')}
                    {loading && <Loader2 className="w-3 h-3 inline-block ml-2 animate-spin text-[#66c0f4]" />}
                  </h3>
                  <div className="flex gap-0.5 flex-wrap justify-end">
                    {[
                      { field: 'droppableCardsValue' as SortField, label: t('sortDroppable'), icon: Zap },
                      { field: 'highestCardPrice' as SortField, label: t('sortHighest'), icon: Coins },
                      { field: 'totalNormalCardsValue' as SortField, label: t('sortTotal'), icon: TrendingUp },
                      { field: 'cardDropsTotal' as SortField, label: t('sortDrops'), icon: Layers },
                    ].map(({ field, label, icon: Icon }) => (
                      <Button key={field} variant="ghost" size="sm" onClick={() => handleSort(field)}
                        className={`text-[10px] h-6 px-1.5 ${sortField === field ? 'text-[#66c0f4] bg-[#66c0f4]/10' : 'text-[#8f98a0]/60 hover:text-[#8f98a0]'}`}>
                        <Icon className="w-2.5 h-2.5 mr-0.5" />{label}
                        {sortField === field && <ArrowUpDown className="w-2 h-2 ml-0.5" />}
                      </Button>
                    ))}
                  </div>
                </div>

                <ScrollArea className="max-h-[calc(100vh-380px)]">
                  <div className="space-y-1.5 pr-1">
                    {sortedGames.map((game, index) => {
                      const rank = getRankBadge(index)
                      const isExpanded = expandedGames.has(game.appId)

                      return (
                        <Collapsible key={game.appId} open={isExpanded} onOpenChange={() => toggleExpand(game.appId)}>
                          <Card className={`bg-[#1e2d3d] border-[#2a475e]/50 hover:border-[#66c0f4]/20 transition-all duration-200 group cursor-pointer ${index < 3 ? 'ring-1 ring-[#66c0f4]/10' : ''}`}>
                            <CollapsibleTrigger asChild>
                              <CardContent className="p-3 sm:p-4">
                                <div className="flex items-center gap-3">
                                  <Badge variant="outline" className={`text-xs font-bold min-w-[36px] justify-center ${rank.className}`}>
                                    {rank.label}
                                  </Badge>
                                  <img
                                    src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`}
                                    alt={game.gameName}
                                    className="w-11 h-11 rounded object-cover bg-[#2a475e]/30 flex-shrink-0"
                                    loading="lazy"
                                    onError={e => {
                                      ;(e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0YTVhNmIiIHN0cm9rZS13aWR0aD0iMS41Ij48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+PHBhdGggZD0iTTggMjFoOCIvPjwvc3ZnPg=='
                                    }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <h4 className="font-semibold text-[#c7d5e0] truncate text-sm">{game.gameName}</h4>
                                      <a href={`https://store.steampowered.com/app/${game.appId}`} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={e => e.stopPropagation()}>
                                        <ExternalLink className="w-3 h-3 text-[#66c0f4]" />
                                      </a>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                      <Badge className="text-[9px] h-4 px-1.5 bg-green-500/15 text-green-400 border-green-500/20 border hover:bg-green-500/20">
                                        {game.cardDropsTotal} {t('cardDropsBadge')}
                                      </Badge>
                                      <span className="text-[11px] text-[#8f98a0]">
                                        {game.totalNormalCards} {t('normalFoil')}{game.totalFoilCards > 0 ? ` + ${game.totalFoilCards} ${t('foilLabel')}` : ''}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="flex items-center justify-end gap-0.5">
                                      <span className="text-base font-bold text-green-400">
                                        ${game.droppableCardsValue.toFixed(2)}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-[#8f98a0]">
                                      {t('highestCard')}: ${game.highestCardPrice.toFixed(2)}
                                    </div>
                                  </div>
                                  <ChevronDown className={`w-4 h-4 text-[#8f98a0]/40 flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                </div>
                              </CardContent>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="px-4 pb-4 pt-0">
                                <div className="border-t border-[#2a475e]/30 pt-3 space-y-3">
                                  {game.normalCards.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-green-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                        <Zap className="w-3 h-3" />
                                        {t('droppableCards')} ({game.cardDropsTotal}/{game.totalNormalCards})
                                        <span className="text-green-400 ml-1 normal-case font-bold">— ${game.droppableCardsValue.toFixed(2)}</span>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                        {game.normalCards.slice(0, game.cardDropsTotal).map((card, idx) => (
                                          <div key={idx} className="flex items-center gap-2 bg-green-500/5 border border-green-500/10 rounded-md px-2 py-1.5 hover:bg-green-500/10 transition-colors">
                                            <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                                            <div className="flex-1 min-w-0">
                                              <div className="text-[11px] text-[#c7d5e0] truncate">{card.name}</div>
                                              <div className="text-[10px] text-green-400 font-medium">${card.price.toFixed(2)}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {game.normalCards.length > game.cardDropsTotal && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-[#8f98a0] uppercase tracking-wider mb-1.5">
                                        {t('otherNormalCards')} ({game.normalCards.length - game.cardDropsTotal})
                                        <span className="ml-1 normal-case font-normal text-[#8f98a0]/60">— {t('tradeOnly')}</span>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                        {game.normalCards.slice(game.cardDropsTotal).map((card, idx) => (
                                          <div key={idx} className="flex items-center gap-2 bg-[#2a475e]/20 rounded-md px-2 py-1.5 hover:bg-[#2a475e]/30 transition-colors opacity-60">
                                            <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                                            <div className="flex-1 min-w-0">
                                              <div className="text-[11px] text-[#c7d5e0] truncate">{card.name}</div>
                                              <div className="text-[10px] text-green-400/60 font-medium">${card.price.toFixed(2)}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {game.foilCards.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-semibold text-yellow-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                        <Sparkles className="w-3 h-3" />
                                        {t('foilCardsSection')} ({game.foilCards.length})
                                        <span className="text-yellow-400/50 ml-1 normal-case font-normal">— {t('notIncludedInTotal')}</span>
                                      </div>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                        {game.foilCards.map((card, idx) => (
                                          <div key={idx} className="flex items-center gap-2 bg-yellow-500/5 border border-yellow-500/10 rounded-md px-2 py-1.5 hover:bg-yellow-500/10 transition-colors">
                                            <img src={card.imageUrl} alt={card.name} className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0" loading="lazy" onError={e => { ;(e.target as HTMLImageElement).style.display = 'none' }} />
                                            <div className="flex-1 min-w-0">
                                              <div className="text-[11px] text-[#c7d5e0] truncate">
                                                {card.name} <span className="text-yellow-400">★</span>
                                              </div>
                                              <div className="text-[10px] text-yellow-400/80 font-medium">${card.price.toFixed(2)}</div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <a href={`https://steamcommunity.com/market/search?q=&appid=753&category_753_Game[]=tag_app_${game.appId}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#66c0f4] hover:underline flex items-center gap-1">
                                    {t('viewOnMarket')} <ExternalLink className="w-2.5 h-2.5" />
                                  </a>
                                </div>
                              </div>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      )
                    })}

                    {loading && (
                      <div className="flex items-center justify-center py-4 gap-2 text-[#66c0f4]">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-xs">{statusMessage}</span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Empty State - Profile */}
            {!loading && games.length === 0 && !error && activeTab === 'profile' && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 rounded-2xl bg-[#2a475e]/20 flex items-center justify-center mb-5">
                  <Gamepad2 className="w-10 h-10 text-[#66c0f4]/50" />
                </div>
                <h3 className="text-lg font-bold text-[#c7d5e0] mb-2">{t('discoverTitle')}</h3>
                <p className="text-sm text-[#8f98a0] max-w-md leading-relaxed">
                  {t('discoverDesc')}
                </p>
                <div className="mt-8 flex flex-col items-center gap-2">
                  <p className="text-[10px] text-[#8f98a0]/50 uppercase tracking-wider font-semibold">{t('exampleUrlTitle')}</p>
                  <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                    https://steamcommunity.com/id/username/
                  </code>
                  <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                    https://steamcommunity.com/profiles/76561198xxxxxxxxx/
                  </code>
                </div>

                <div className="mt-10 grid grid-cols-1 sm:grid-cols-4 gap-3 max-w-xl">
                  {[
                    { icon: RefreshCw, label: t('featureLivePrices'), desc: t('featureLivePricesDesc') },
                    { icon: Zap, label: t('featureDroppableCards'), desc: t('featureDroppableCardsDesc') },
                    { icon: TrendingUp, label: t('featureSmartSort'), desc: t('featureSmartSortDesc') },
                    { icon: Sparkles, label: t('featureFoilCards'), desc: t('featureFoilCardsDesc') },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex flex-col items-center gap-1 text-center p-3">
                      <Icon className="w-5 h-5 text-[#66c0f4]/40" />
                      <div className="text-xs font-semibold text-[#8f98a0]">{label}</div>
                      <div className="text-[10px] text-[#8f98a0]/50">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* ====== GAME CARDS LOOKUP TAB ====== */}
          <TabsContent value="game" className="mt-0">
            {/* Search */}
            <Card className="bg-[#1e2d3d] border-[#2a475e]/50 mb-5">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="flex-1 relative">
                    <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8f98a0]" />
                    <Input
                      value={gameUrl}
                      onChange={e => setGameUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !gameLoading && lookupGameCards()}
                      placeholder={t('gameUrlPlaceholder')}
                      className="pl-9 bg-[#2a475e]/40 border-[#2a475e] text-[#c7d5e0] placeholder:text-[#8f98a0]/60 focus:border-[#66c0f4] h-11 text-sm"
                      disabled={gameLoading}
                    />
                  </div>
                  {gameLoading ? (
                    <Button disabled className="bg-[#66c0f4]/50 text-[#1b2838] font-semibold h-11 px-6">
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />{t('searching')}
                    </Button>
                  ) : (
                    <Button onClick={lookupGameCards} disabled={!gameUrl.trim()} className="bg-[#66c0f4] hover:bg-[#4fa3d6] text-[#1b2838] font-semibold h-11 px-6 disabled:opacity-50">
                      <Package className="w-4 h-4 mr-2" />{t('lookupCards')}
                    </Button>
                  )}
                </div>

                {gameError && (
                  <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{gameError}</div>
                )}
              </CardContent>
            </Card>

            {/* Game Result */}
            {gameResult && gameResult.hasCards && (
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-4 sm:p-6">
                  {renderGameLookupCards(gameResult)}
                </CardContent>
              </Card>
            )}

            {/* Loading skeleton */}
            {gameLoading && !gameResult && (
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Skeleton className="w-16 h-16 rounded-md bg-[#2a475e]/50" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48 bg-[#2a475e]/50" />
                      <Skeleton className="h-3 w-32 bg-[#2a475e]/50" />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2 mb-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 rounded-md bg-[#2a475e]/50" />
                    ))}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-md bg-[#2a475e]/50" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Empty State - Game */}
            {!gameLoading && !gameResult && !gameError && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-20 h-20 rounded-2xl bg-[#2a475e]/20 flex items-center justify-center mb-5">
                  <Package className="w-10 h-10 text-[#66c0f4]/50" />
                </div>
                <h3 className="text-lg font-bold text-[#c7d5e0] mb-2">{t('gameLookupTitle')}</h3>
                <p className="text-sm text-[#8f98a0] max-w-md leading-relaxed">
                  {t('gameLookupDesc')}
                </p>
                <div className="mt-8 flex flex-col items-center gap-2">
                  <p className="text-[10px] text-[#8f98a0]/50 uppercase tracking-wider font-semibold">{t('exampleUrlTitle')}</p>
                  <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                    https://store.steampowered.com/app/730/
                  </code>
                  <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                    730
                  </code>
                </div>

                <div className="mt-10 grid grid-cols-1 sm:grid-cols-4 gap-3 max-w-xl">
                  {[
                    { icon: Layers, label: t('featureAllCards'), desc: t('featureAllCardsDesc') },
                    { icon: Zap, label: t('featureDropInfo'), desc: t('featureDropInfoDesc') },
                    { icon: RefreshCw, label: t('featureLivePrice'), desc: t('featureLivePriceDesc') },
                    { icon: Sparkles, label: t('featureFoilInfo'), desc: t('featureFoilInfoDesc') },
                  ].map(({ icon: Icon, label, desc }) => (
                    <div key={label} className="flex flex-col items-center gap-1 text-center p-3">
                      <Icon className="w-5 h-5 text-[#66c0f4]/40" />
                      <div className="text-xs font-semibold text-[#8f98a0]">{label}</div>
                      <div className="text-[10px] text-[#8f98a0]/50">{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="bg-[#171a21] border-t border-[#2a475e]/50 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-2.5 text-center text-[10px] text-[#8f98a0]/40">
          {t('footer')}
        </div>
      </footer>
    </div>
  )
}
