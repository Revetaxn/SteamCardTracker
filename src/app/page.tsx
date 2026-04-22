'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Search,
  Gamepad2,
  TrendingUp,
  Trophy,
  ChevronDown,
  ExternalLink,
  Loader2,
  ArrowUpDown,
  Coins,
  Zap,
  BarChart3,
  Sparkles,
  X,
  RefreshCw,
  Key,
  Info,
} from 'lucide-react'

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

type SortField = 'highestCardPrice' | 'totalCardsValue' | 'totalCards' | 'gameName'
type SortDirection = 'asc' | 'desc'

export default function Home() {
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [games, setGames] = useState<GameCardInfo[]>([])
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [totalOwnedGames, setTotalOwnedGames] = useState(0)
  const [scanMethod, setScanMethod] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('highestCardPrice')
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

  const analyzeProfile = useCallback(async () => {
    if (!url.trim()) return

    // Cancel any existing request
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
    setStatusMessage('Başlatılıyor...')
    setExpandedGames(new Set())

    try {
      const response = await fetch('/api/steam/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), apiKey: apiKey.trim() || undefined }),
        signal: abortController.signal,
      })

      if (!response.body) {
        throw new Error('Streaming desteklenmiyor')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE messages (separated by \n\n)
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
                    setProgress({
                      current: data.current,
                      total: data.total,
                      found: data.found,
                    })
                    setStatusMessage(data.message)
                    break
                  case 'game':
                    setGames(prev => {
                      const newGames = [...prev, data.data]
                      newGames.sort(
                        (a, b) => b.highestCardPrice - a.highestCardPrice
                      )
                      return newGames
                    })
                    break
                  case 'complete':
                    setProfile(data.data.profile)
                    setTotalOwnedGames(data.data.totalOwnedGames)
                    setScanMethod(data.data.scanMethod)
                    // Final sort
                    setGames(prev =>
                      [...prev].sort(
                        (a, b) => b.highestCardPrice - a.highestCardPrice
                      )
                    )
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
        setStatusMessage('İptal edildi')
      } else {
        setError(
          err instanceof Error ? err.message : 'Bilinmeyen bir hata oluştu'
        )
      }
    } finally {
      setLoading(false)
    }
  }, [url, apiKey])

  const cancelAnalysis = useCallback(() => {
    abortControllerRef.current?.abort()
    setLoading(false)
    setStatusMessage('İptal edildi')
  }, [])

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
          case 'highestCardPrice':
            comparison = a.highestCardPrice - b.highestCardPrice
            break
          case 'totalCardsValue':
            comparison = a.totalCardsValue - b.totalCardsValue
            break
          case 'totalCards':
            comparison = a.totalCards - b.totalCards
            break
          case 'gameName':
            comparison = a.gameName.localeCompare(b.gameName)
            break
        }
        return sortDirection === 'desc' ? -comparison : comparison
      })
    : []

  const getRankBadge = (index: number) => {
    if (index === 0)
      return {
        label: '#1',
        className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      }
    if (index === 1)
      return {
        label: '#2',
        className: 'bg-gray-400/20 text-gray-300 border-gray-400/30',
      }
    if (index === 2)
      return {
        label: '#3',
        className: 'bg-amber-700/20 text-amber-500 border-amber-600/30',
      }
    return {
      label: `#${index + 1}`,
      className: 'bg-[#2a475e]/30 text-[#8f98a0] border-[#2a475e]/50',
    }
  }

  const totalHighestCardsValue =
    games.reduce((sum, g) => sum + g.highestCardPrice, 0) || 0
  const totalAllCardsValue =
    games.reduce((sum, g) => sum + g.totalCardsValue, 0) || 0
  const progressPercent = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0

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
              Steam Kart Takipçi
            </h1>
          </div>
          <Badge
            variant="outline"
            className="ml-auto text-[10px] border-[#66c0f4]/30 text-[#66c0f4] hidden sm:inline-flex"
          >
            <Sparkles className="w-3 h-3 mr-1" />
            Kart Fiyat Takip
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5">
        {/* Search Section */}
        <Card className="bg-[#1e2d3d] border-[#2a475e]/50 mb-5">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8f98a0]" />
                <Input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e =>
                    e.key === 'Enter' && !loading && analyzeProfile()
                  }
                  placeholder="Steam profil URL'si girin... (örn: https://steamcommunity.com/id/kullaniciadi/)"
                  className="pl-9 bg-[#2a475e]/40 border-[#2a475e] text-[#c7d5e0] placeholder:text-[#8f98a0]/60 focus:border-[#66c0f4] h-11 text-sm"
                  disabled={loading}
                />
              </div>
              {loading ? (
                <Button
                  onClick={cancelAnalysis}
                  className="bg-red-500/80 hover:bg-red-600 text-white font-semibold h-11 px-6"
                >
                  <X className="w-4 h-4 mr-2" />
                  İptal
                </Button>
              ) : (
                <Button
                  onClick={analyzeProfile}
                  disabled={!url.trim()}
                  className="bg-[#66c0f4] hover:bg-[#4fa3d6] text-[#1b2838] font-semibold h-11 px-6 disabled:opacity-50"
                >
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Analiz Et
                </Button>
              )}
            </div>

            {/* API Key Section */}
            <div className="mt-3">
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="flex items-center gap-1.5 text-[11px] text-[#8f98a0]/70 hover:text-[#66c0f4] transition-colors"
                type="button"
              >
                <Key className="w-3 h-3" />
                {showApiKey ? 'API Anahtarını Gizle' : 'Steam API Anahtarı (opsiyonel — tüm oyunlar için)'}
              </button>

              {showApiKey && (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#8f98a0]/60" />
                    <Input
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="Steam Web API Anahtarı..."
                      className="pl-8 bg-[#2a475e]/40 border-[#2a475e] text-[#c7d5e0] placeholder:text-[#8f98a0]/60 focus:border-[#66c0f4] h-9 text-xs"
                      disabled={loading}
                      type="password"
                    />
                  </div>
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#66c0f4]/5 border border-[#66c0f4]/10">
                    <Info className="w-3.5 h-3.5 text-[#66c0f4] flex-shrink-0 mt-0.5" />
                    <div className="text-[10px] text-[#8f98a0] leading-relaxed">
                      <strong className="text-[#66c0f4]">Neden gerekli?</strong> API anahtarı olmadan yalnızca oynanmış kartlı oyunlar listelenir. 
                      500+ oyununuz varsa tamamını taramak için API anahtarı gerekir.{' '}
                      <a
                        href="https://steamcommunity.com/dev/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#66c0f4] hover:underline"
                      >
                        Ücretsiz API anahtarı alın →
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {loading && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#8f98a0]">
                    {statusMessage}
                  </span>
                  {progress && (
                    <span className="text-xs text-[#66c0f4] font-medium">
                      {progressPercent}%
                    </span>
                  )}
                </div>
                <Progress
                  value={progressPercent}
                  className="h-2 bg-[#2a475e]/50 [&>div]:bg-[#66c0f4]"
                />
                {progress && (
                  <div className="flex items-center justify-between text-[10px] text-[#8f98a0]/60">
                    <span>
                      {progress.current}/{progress.total} oyun tarandı
                    </span>
                    <span>{progress.found} kartlı oyun bulundu</span>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-3 p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Info + Stats */}
        {(profile || games.length > 0) && (
          <div className="mb-5 space-y-3">
            {/* Profile Card */}
            {profile && (
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <img
                      src={profile.avatarUrl}
                      alt={profile.personaName}
                      className="w-14 h-14 rounded-md border-2 border-[#66c0f4]/30"
                    />
                    <div className="flex-1 min-w-0">
                      <h2 className="text-base font-bold text-[#c7d5e0] truncate">
                        {profile.personaName}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        <a
                          href={profile.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-[#66c0f4] hover:underline flex items-center gap-1"
                        >
                          Profili Görüntüle{' '}
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        {scanMethod && (
                          <Badge
                            variant="outline"
                            className={`text-[9px] h-4 px-1.5 ${
                              scanMethod === 'badges'
                                ? 'border-amber-500/30 text-amber-400'
                                : 'border-green-500/30 text-green-400'
                            }`}
                          >
                            {scanMethod === 'steam_web_api'
                              ? '✓ Tüm Oyunlar'
                              : scanMethod === 'steamdb'
                                ? '✓ SteamDB'
                                : scanMethod === 'games_page'
                                  ? '✓ Steam Profil'
                                  : '⚠ Yalnızca Oynanmış'}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {loading && (
                      <Loader2 className="w-5 h-5 text-[#66c0f4] animate-spin" />
                    )}
                  </div>
                  {/* Warning for badges-only scan */}
                  {scanMethod === 'badges' && !loading && (
                    <div className="mt-3 flex items-start gap-2 p-2.5 rounded-md bg-amber-500/5 border border-amber-500/10">
                      <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                      <div className="text-[10px] text-[#8f98a0] leading-relaxed">
                        <strong className="text-amber-400">Sınırlı tarama:</strong> Yalnızca oynanmış kartlı oyunlar listelendi. 
                        Tüm oyunlarınızı taramak için{' '}
                        <button
                          onClick={() => setShowApiKey(true)}
                          className="text-[#66c0f4] hover:underline"
                        >
                          Steam API anahtarı ekleyin
                        </button>.
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-3 text-center">
                  <Coins className="w-4 h-4 text-[#66c0f4] mx-auto mb-1" />
                  <div className="text-xl font-bold text-[#66c0f4]">
                    {games.length}
                  </div>
                  <div className="text-[10px] text-[#8f98a0]">Kartlı Oyun</div>
                </CardContent>
              </Card>
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-3 text-center">
                  <Zap className="w-4 h-4 text-green-400 mx-auto mb-1" />
                  <div className="text-xl font-bold text-green-400">
                    ${totalHighestCardsValue.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[#8f98a0]">
                    En Yüksek Kart Top.
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#1e2d3d] border-[#2a475e]/50">
                <CardContent className="p-3 text-center">
                  <BarChart3 className="w-4 h-4 text-purple-400 mx-auto mb-1" />
                  <div className="text-xl font-bold text-purple-400">
                    ${totalAllCardsValue.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-[#8f98a0]">
                    Tüm Kartlar Top.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Loading Skeleton - initial state before any results */}
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
            {/* Sort Header */}
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[#8f98a0] uppercase tracking-wider">
                Oyunlar — En Değerli Karta Göre Sıralandı
                {loading && (
                  <Loader2 className="w-3 h-3 inline-block ml-2 animate-spin text-[#66c0f4]" />
                )}
              </h3>
              <div className="flex gap-0.5">
                {[
                  {
                    field: 'highestCardPrice' as SortField,
                    label: 'Fiyat',
                    icon: Coins,
                  },
                  {
                    field: 'totalCardsValue' as SortField,
                    label: 'Toplam',
                    icon: TrendingUp,
                  },
                  {
                    field: 'totalCards' as SortField,
                    label: 'Kart',
                    icon: Trophy,
                  },
                ].map(({ field, label, icon: Icon }) => (
                  <Button
                    key={field}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSort(field)}
                    className={`text-[10px] h-6 px-1.5 ${
                      sortField === field
                        ? 'text-[#66c0f4] bg-[#66c0f4]/10'
                        : 'text-[#8f98a0]/60 hover:text-[#8f98a0]'
                    }`}
                  >
                    <Icon className="w-2.5 h-2.5 mr-0.5" />
                    {label}
                    {sortField === field && (
                      <ArrowUpDown className="w-2 h-2 ml-0.5" />
                    )}
                  </Button>
                ))}
              </div>
            </div>

            {/* Game Cards List */}
            <ScrollArea className="max-h-[calc(100vh-340px)]">
              <div className="space-y-1.5 pr-1">
                {sortedGames.map((game, index) => {
                  const rank = getRankBadge(index)
                  const isExpanded = expandedGames.has(game.appId)
                  const normalCards = game.cards.filter(c => !c.isFoil)
                  const foilCards = game.cards.filter(c => c.isFoil)

                  return (
                    <Collapsible
                      key={game.appId}
                      open={isExpanded}
                      onOpenChange={() => toggleExpand(game.appId)}
                    >
                      <Card
                        className={`bg-[#1e2d3d] border-[#2a475e]/50 hover:border-[#66c0f4]/20 transition-all duration-200 group cursor-pointer ${
                          index < 3 ? 'ring-1 ring-[#66c0f4]/10' : ''
                        }`}
                      >
                        <CollapsibleTrigger asChild>
                          <CardContent className="p-3 sm:p-4">
                            <div className="flex items-center gap-3">
                              {/* Rank */}
                              <Badge
                                variant="outline"
                                className={`text-xs font-bold min-w-[36px] justify-center ${rank.className}`}
                              >
                                {rank.label}
                              </Badge>

                              {/* Game Icon */}
                              <img
                                src={`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_231x87.jpg`}
                                alt={game.gameName}
                                className="w-11 h-11 rounded object-cover bg-[#2a475e]/30 flex-shrink-0"
                                loading="lazy"
                                onError={e => {
                                  const img = e.target as HTMLImageElement
                                  img.src =
                                    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NCIgaGVpZ2h0PSI0NCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0YTVhNmIiIHN0cm9rZS13aWR0aD0iMS41Ij48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIi8+PHBhdGggZD0iTTggMjFoOCIvPjwvc3ZnPg=='
                                }}
                              />

                              {/* Game Info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="font-semibold text-[#c7d5e0] truncate text-sm">
                                    {game.gameName}
                                  </h4>
                                  <a
                                    href={`https://store.steampowered.com/app/${game.appId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                    onClick={e => e.stopPropagation()}
                                  >
                                    <ExternalLink className="w-3 h-3 text-[#66c0f4]" />
                                  </a>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                  <span className="text-[11px] text-[#8f98a0]">
                                    {game.totalCards} kart
                                  </span>
                                  <span className="text-[#2a475e]">•</span>
                                  <span className="text-[11px] text-[#8f98a0] truncate">
                                    En değerli: {game.highestCardName}
                                    {game.highestCardIsFoil && (
                                      <span className="text-yellow-400 ml-0.5">
                                        ★Foil
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </div>

                              {/* Price Info */}
                              <div className="text-right flex-shrink-0">
                                <div className="flex items-center justify-end gap-0.5">
                                  <span className="text-base font-bold text-green-400">
                                    ${game.highestCardPrice.toFixed(2)}
                                  </span>
                                </div>
                                <div className="text-[10px] text-[#8f98a0]">
                                  Toplam: ${game.totalCardsValue.toFixed(2)}
                                </div>
                              </div>

                              {/* Expand Chevron */}
                              <ChevronDown
                                className={`w-4 h-4 text-[#8f98a0]/40 flex-shrink-0 transition-transform duration-200 ${
                                  isExpanded ? 'rotate-180' : ''
                                }`}
                              />
                            </div>
                          </CardContent>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="px-4 pb-4 pt-0">
                            <div className="border-t border-[#2a475e]/30 pt-3 space-y-3">
                              {/* Normal Cards */}
                              {normalCards.length > 0 && (
                                <div>
                                  <div className="text-[10px] font-semibold text-[#8f98a0] uppercase tracking-wider mb-1.5">
                                    Normal Kartlar ({normalCards.length})
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                    {normalCards.map((card, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-2 bg-[#2a475e]/20 rounded-md px-2 py-1.5 hover:bg-[#2a475e]/30 transition-colors"
                                      >
                                        <img
                                          src={card.imageUrl}
                                          alt={card.name}
                                          className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0"
                                          loading="lazy"
                                          onError={e => {
                                            ;(
                                              e.target as HTMLImageElement
                                            ).style.display = 'none'
                                          }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[11px] text-[#c7d5e0] truncate">
                                            {card.name}
                                          </div>
                                          <div className="text-[10px] text-green-400 font-medium">
                                            ${card.price.toFixed(2)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Foil Cards */}
                              {foilCards.length > 0 && (
                                <div>
                                  <div className="text-[10px] font-semibold text-yellow-400/80 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" />
                                    Foil Kartlar ({foilCards.length})
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
                                    {foilCards.map((card, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center gap-2 bg-yellow-500/5 border border-yellow-500/10 rounded-md px-2 py-1.5 hover:bg-yellow-500/10 transition-colors"
                                      >
                                        <img
                                          src={card.imageUrl}
                                          alt={card.name}
                                          className="w-7 h-7 rounded object-cover bg-[#2a475e]/30 flex-shrink-0"
                                          loading="lazy"
                                          onError={e => {
                                            ;(
                                              e.target as HTMLImageElement
                                            ).style.display = 'none'
                                          }}
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-[11px] text-[#c7d5e0] truncate">
                                            {card.name}
                                            <span className="text-yellow-400 ml-0.5">
                                              ★
                                            </span>
                                          </div>
                                          <div className="text-[10px] text-green-400 font-medium">
                                            ${card.price.toFixed(2)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Market Link */}
                              <a
                                href={`https://steamcommunity.com/market/search?q=&appid=753&category_753_Game[]=tag_app_${game.appId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-[#66c0f4] hover:underline flex items-center gap-1"
                              >
                                Steam Market&apos;te görüntüle{' '}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  )
                })}

                {/* Loading more indicator */}
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

        {/* Empty State */}
        {!loading && games.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-2xl bg-[#2a475e]/20 flex items-center justify-center mb-5">
              <Gamepad2 className="w-10 h-10 text-[#66c0f4]/50" />
            </div>
            <h3 className="text-lg font-bold text-[#c7d5e0] mb-2">
              Steam Kart Değerlerinizi Keşfedin
            </h3>
            <p className="text-sm text-[#8f98a0] max-w-md leading-relaxed">
              Steam profil URL&apos;nizi girin ve hangi oyunların en değerli
              trading kartlarını düşürdüğünü görün. Kartlar güncel fiyatlarına
              göre otomatik sıralanır.
            </p>
            <div className="mt-8 flex flex-col items-center gap-2">
              <p className="text-[10px] text-[#8f98a0]/50 uppercase tracking-wider font-semibold">
                Örnek URL formatları
              </p>
              <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                https://steamcommunity.com/id/kullaniciadi/
              </code>
              <code className="text-xs text-[#66c0f4]/70 bg-[#2a475e]/20 px-4 py-2 rounded-md font-mono">
                https://steamcommunity.com/profiles/76561198xxxxxxxxx/
              </code>
            </div>

            {/* Feature highlights */}
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg">
              {[
                {
                  icon: RefreshCw,
                  label: 'Güncel Fiyatlar',
                  desc: 'Steam Market canlı veriler',
                },
                {
                  icon: TrendingUp,
                  label: 'Akıllı Sıralama',
                  desc: 'En karlı kartlar üstte',
                },
                {
                  icon: Sparkles,
                  label: 'Foil Kart Takip',
                  desc: 'Normal + Foil kartlar',
                },
              ].map(({ icon: Icon, label, desc }) => (
                <div
                  key={label}
                  className="flex flex-col items-center gap-1 text-center p-3"
                >
                  <Icon className="w-5 h-5 text-[#66c0f4]/40" />
                  <div className="text-xs font-semibold text-[#8f98a0]">
                    {label}
                  </div>
                  <div className="text-[10px] text-[#8f98a0]/50">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-[#171a21] border-t border-[#2a475e]/50 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-2.5 text-center text-[10px] text-[#8f98a0]/40">
          Steam Kart Takipçi — Steam Market güncel fiyatları gerçek zamanlı
          çekilir • Fiyatlar USD cinsindendir
        </div>
      </footer>
    </div>
  )
}
