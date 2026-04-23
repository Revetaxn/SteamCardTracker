'use client'

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  TrendingUp, Search, RefreshCw, X, Layout,
  ExternalLink, Info, Loader2, Zap, Trophy,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
  Globe, User, Gamepad2, Coins, BarChart3, Star,
  LayoutGrid, List, ArrowDownWideArrow, ArrowUpWideArrow,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// ===== TYPES =====
interface CardInfo {
  name: string
  price: number
  priceText: string
  isFoil: boolean
  imageUrl: string
}

interface GameResult {
  appId: number
  gameName: string
  gameIconUrl: string
  normalCards: CardInfo[]
  foilCards: CardInfo[]
  highestCardPrice: number
  totalNormalCards: number
  droppableCardsValue: number
  foilCardsValue: number
  hasCardDrops: boolean
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

const translations = {
  tr: {
    title: 'STC PLATINUM',
    subtitle: 'Kütüphaneni saniyeler içinde tara.',
    urlPlaceholder: 'Profil URL veya ID',
    apiKeyPlaceholder: 'API',
    analyze: 'TARA',
    continue: 'DEVAM ET',
    scanning: 'Taranıyor...',
    progress: 'Kütüphane İlerlemesi',
    potentialProfit: 'Top. Kazanç',
    topFoil: 'Top Foil',
    getKey: 'Anahtar Al',
    noGames: 'Henüz tarama yapılmadı.',
    sortByProfit: 'Kazanca Göre',
    sortByCard: 'Kart Fiyatına Göre',
    viewGrid: 'Grid Görünüm',
    viewList: 'Liste Görünüm',
    page: 'Sayfa'
  },
  en: {
    title: 'STC PLATINUM',
    subtitle: 'Scan your library in seconds.',
    urlPlaceholder: 'Profile URL or ID',
    apiKeyPlaceholder: 'API',
    analyze: 'SCAN',
    continue: 'CONTINUE',
    scanning: 'Scanning...',
    progress: 'Library Progress',
    potentialProfit: 'Total Profit',
    topFoil: 'Top Foil',
    getKey: 'Get Key',
    noGames: 'No games scanned yet.',
    sortByProfit: 'Sort by Profit',
    sortByCard: 'Sort by Card Price',
    viewGrid: 'Grid View',
    viewList: 'List View',
    page: 'Page'
  }
}

export default function SteamCardTracker() {
  const [lang, setLang] = useState<'tr' | 'en'>('tr')
  const t = translations[lang]
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [games, setGames] = useState<GameResult[]>([])
  const [progress, setProgress] = useState<{ current: number, total: number, foundInLib: number } | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [expandedGames, setExpandedGames] = useState<Set<number>>(new Set())
  const [isClient, setIsClient] = useState(false)

  // New States: Grid, Sort, Pagination
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
  const [sortBy, setSortBy] = useState<'profit' | 'card'>('profit')
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 50

  useEffect(() => { setIsClient(true) }, [])

  const abortControllerRef = useRef<AbortController | null>(null)

  const analyzeProfile = useCallback(async (isMore = false) => {
    if (!url.trim()) return
    if (!isMore) abortControllerRef.current?.abort()
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setLoading(true)
    setError(null)
    setStatusMessage(t.scanning)

    if (!isMore) {
      setGames([])
      setProfile(null)
      setProgress(null)
      setExpandedGames(new Set())
      setCurrentPage(1)
    }

    try {
      const excludeIds = isMore ? games.map(g => g.appId) : []
      const response = await fetch('/api/steam/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), apiKey: apiKey.trim(), lang, excludeIds, limit: 100 }),
        signal: abortController.signal
      })

      if (!response.body) throw new Error('Stream failed')
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
          if (!part.trim()) continue
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue

          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'status') setStatusMessage(data.message)
            if (data.type === 'progress') setProgress(p => ({
              current: (isMore ? (p?.current || 0) : 0) + (data.current || 0),
              total: data.total || 0,
              foundInLib: data.found || 0
            }))
            if (data.type === 'game') {
              setGames(prev => {
                if (prev.some(g => g.appId === data.data.appId)) return prev
                return [...prev, data.data]
              })
            }
            if (data.type === 'complete') {
              if (data.data.profile) setProfile(data.data.profile)
              setLoading(false)
            }
            if (data.type === 'error') throw new Error(data.message)
          } catch (e) { console.error(e) }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, lang, t, games])

  const sortedGames = useMemo(() => {
    return [...games].sort((a, b) => {
      if (sortBy === 'profit') return (b.droppableCardsValue + b.foilCardsValue) - (a.droppableCardsValue + a.foilCardsValue)
      return b.highestCardPrice - a.highestCardPrice
    })
  }, [games, sortBy])

  const paginatedGames = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    return sortedGames.slice(start, start + itemsPerPage)
  }, [sortedGames, currentPage])

  const totalPages = Math.ceil(sortedGames.length / itemsPerPage)
  const totalPot = useMemo(() => games.reduce((acc, g) => acc + g.droppableCardsValue + g.foilCardsValue, 0), [games])

  if (!isClient) return null

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0d121a] text-[#c7d5e0] font-sans selection:bg-[#66c0f4]/20 pb-20">
        <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
          <div className="absolute top-[10%] left-[10%] w-[30%] h-[30%] bg-[#66c0f4] blur-[150px] rounded-full"></div>
        </div>

        <div className="container max-w-6xl mx-auto px-4 py-12 relative">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-8">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-6 h-6 text-[#66c0f4]" />
                <h1 className="text-2xl font-black italic tracking-tight text-white uppercase">{t.title}</h1>
                <div className="flex bg-[#171d25] rounded-lg p-0.5 border border-white/5 ml-4">
                  <button onClick={() => setLang('tr')} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${lang === 'tr' ? 'bg-[#66c0f4] text-[#1b2838]' : 'hover:text-white'}`}>TR</button>
                  <button onClick={() => setLang('en')} className={`px-3 py-1 rounded-md text-[10px] font-black transition-all ${lang === 'en' ? 'bg-[#66c0f4] text-[#1b2838]' : 'hover:text-white text-[#4d535b]'}`}>EN</button>
                </div>
              </div>
              <p className="text-sm font-medium text-[#8f98a0]">{t.subtitle}</p>
            </div>

            <div className="w-full md:w-auto space-y-2">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex bg-[#171d25] rounded-xl p-1 border border-white/5 h-12 items-center px-4 gap-4 flex-1">
                  <Globe className="w-4 h-4 text-[#4d535b]" />
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.urlPlaceholder} className="border-none bg-transparent h-full text-sm text-white focus-visible:ring-0 placeholder:text-[#4d535b] p-0 w-48" />
                  <div className="w-px h-6 bg-white/10"></div>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder={t.apiKeyPlaceholder} className="border-none bg-transparent h-full text-sm text-white focus-visible:ring-0 placeholder:text-[#4d535b] p-0 w-24" />
                </div>
                <div className="flex gap-2">
                  {loading ? (
                    <Button onClick={() => abortControllerRef.current?.abort()} variant="destructive" className="h-12 w-12 rounded-xl border border-white/5 p-0 hover:scale-105 transition-transform"><X className="w-5 h-5" /></Button>
                  ) : (
                    <Button onClick={() => analyzeProfile(false)} className="h-12 bg-[#66c0f4] hover:bg-[#4fa3d3] text-[#1b2838] font-black px-8 rounded-xl shadow-lg shadow-[#66c0f4]/10 uppercase transition-all active:scale-95">{t.analyze}</Button>
                  )}
                  {!loading && progress && progress.current < progress.total && (
                    <Button onClick={() => analyzeProfile(true)} className="h-12 bg-green-500 hover:bg-green-600 text-[#1b2838] font-black px-8 rounded-xl shadow-lg shadow-green-500/10 uppercase animate-pulse">{t.continue}</Button>
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#66c0f4] hover:underline font-black flex items-center gap-1.5 uppercase tracking-tighter">
                  <Zap className="w-3 h-3" /> {t.getKey}
                </a>
              </div>
            </div>
          </div>

          {/* DASHBOARD */}
          {progress && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 animate-in fade-in slide-in-from-top-4 duration-700">
              <Card className="bg-[#171d25]/60 border-white/5 backdrop-blur-xl">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#8f98a0]">{t.progress}</span>
                    <span className="text-xs font-mono text-[#66c0f4] tracking-tight">{progress.current} / {progress.total}</span>
                  </div>
                  <Progress value={(progress.current / (progress.total || 1)) * 100} className="h-1.5 bg-white/5 [&>div]:bg-[#66c0f4]" />
                  <p className="text-[9px] mt-3 font-bold opacity-40 uppercase truncate italic">{statusMessage}</p>
                </CardContent>
              </Card>

              <Card className="bg-[#171d25]/60 border-white/5 backdrop-blur-xl">
                <CardContent className="p-6">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#8f98a0]">Total Discovery</span>
                  <div className="flex items-end gap-3 mt-2">
                    <div className="text-3xl font-black text-white italic">{progress.foundInLib}</div>
                    <div className="text-[10px] font-bold text-[#8f98a0] mb-1.5 uppercase">Owned Games</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#66c0f4]/10 border-[#66c0f4]/10 backdrop-blur-xl group">
                <CardContent className="p-6">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#66c0f4]/70">{t.potentialProfit}</span>
                  <div className="flex items-end gap-2 mt-2">
                    <div className="text-3xl font-black text-green-400 italic">${totalPot.toFixed(2)}</div>
                    <div className="text-[10px] font-bold text-green-400 mb-1.5 uppercase tracking-widest group-hover:scale-110 transition-transform">USD</div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* CONTROLS: View Mode, Sorting, Pagination */}
          {games.length > 0 && (
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-8 p-4 bg-[#171d25]/30 rounded-2xl border border-white/5 backdrop-blur-md animate-in fade-in duration-500">
              <div className="flex bg-[#0d121a] p-1 rounded-xl border border-white/5">
                <Button onClick={() => setSortBy('profit')} variant="ghost" className={`h-9 px-4 text-xs font-black uppercase ${sortBy === 'profit' ? 'bg-[#66c0f4] text-[#1b2838]' : 'text-[#8f98a0] hover:text-white'}`}>
                  <Coins className="w-3.5 h-3.5 mr-2" /> {t.sortByProfit}
                </Button>
                <Button onClick={() => setSortBy('card')} variant="ghost" className={`h-9 px-4 text-xs font-black uppercase ${sortBy === 'card' ? 'bg-[#66c0f4] text-[#1b2838]' : 'text-[#8f98a0] hover:text-white'}`}>
                  <BarChart3 className="w-3.5 h-3.5 mr-2" /> {t.sortByCard}
                </Button>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex bg-[#0d121a] p-1 rounded-xl border border-white/5">
                  <Button onClick={() => setViewMode('list')} variant="ghost" size="icon" className={`h-9 w-9 ${viewMode === 'list' ? 'bg-white/10 text-[#66c0f4]' : 'text-[#4d535b]'}`}><List className="w-4 h-4" /></Button>
                  <Button onClick={() => setViewMode('grid')} variant="ghost" size="icon" className={`h-9 w-9 ${viewMode === 'grid' ? 'bg-white/10 text-[#66c0f4]' : 'text-[#4d535b]'}`}><LayoutGrid className="w-4 h-4" /></Button>
                </div>

                <div className="w-px h-6 bg-white/10"></div>

                <div className="flex items-center gap-2">
                  <Button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} variant="ghost" size="icon" className="h-9 w-9 border border-white/5"><ChevronLeft className="w-4 h-4" /></Button>
                  <span className="text-[10px] font-black text-white uppercase italic">{currentPage} / {totalPages || 1}</span>
                  <Button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} variant="ghost" size="icon" className="h-9 w-9 border border-white/5"><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </div>
          )}

          {/* MAIN LIST / GRID */}
          <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-3'}>
            {paginatedGames.length === 0 && !loading && !error && (
              <div className="col-span-full py-40 flex flex-col items-center opacity-20 select-none">
                <Gamepad2 className="w-16 h-16 mb-4" />
                <p className="font-black uppercase tracking-[0.3em] text-xs">{t.noGames}</p>
              </div>
            )}

            {error && (
              <div className="col-span-full text-center p-6 border border-red-500/20 bg-red-500/5 rounded-2xl">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-sm font-bold text-red-400 uppercase italic">{error}</p>
              </div>
            )}

            {paginatedGames.map((game, idx) => (
              <Card key={game.appId} className={`bg-[#171d25]/40 border-white/5 hover:border-[#66c0f4]/20 transition-all duration-300 overflow-hidden group ${viewMode === 'grid' ? 'flex flex-col' : ''}`}>
                <CardContent className={`p-3 flex ${viewMode === 'grid' ? 'flex-col gap-4' : 'items-center gap-6'}`}>
                  <div className={`relative flex-shrink-0 ${viewMode === 'grid' ? 'w-full aspect-[231/87] rounded-xl overflow-hidden' : 'w-24 h-10 rounded-md overflow-hidden'}`}>
                    <img src={game.gameIconUrl} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700 group-hover:scale-105" />
                    {viewMode === 'grid' && (
                      <div className="absolute top-2 right-2 flex gap-1">
                        <Badge className="bg-black/60 text-[#66c0f4] backdrop-blur-md border-none text-[8px] font-black h-5">{game.totalNormalCards} C</Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className={`font-black text-white truncate uppercase italic tracking-tight ${viewMode === 'grid' ? 'text-sm' : 'text-sm'}`}>{game.gameName}</h3>
                      {viewMode === 'grid' && (
                        <a href={`https://steamcommunity.com/market/search?q=${encodeURIComponent(game.gameName)}&appid=753`} target="_blank" className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10"><ExternalLink className="w-3.5 h-3.5 text-[#4d535b] group-hover:text-[#66c0f4]" /></a>
                      )}
                    </div>

                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black text-[#8f98a0] uppercase tracking-tighter italic">Normal Drops</span>
                        <span className="text-xs font-black text-green-400 group-hover:scale-110 origin-left transition-transform">${game.droppableCardsValue.toFixed(2)}</span>
                      </div>
                      <div className="w-px h-4 bg-white/5"></div>
                      <div className={`flex flex-col ${game.foilCards.length === 0 ? 'opacity-20' : ''}`}>
                        <span className="text-[8px] font-black text-yellow-500/70 uppercase tracking-tighter italic">{t.topFoil}</span>
                        <span className="text-xs font-black text-yellow-500">${game.foilCardsValue.toFixed(2)}</span>
                      </div>
                      <div className="w-px h-4 bg-white/5 md:hidden lg:block"></div>
                      <div className="hidden md:flex flex-col">
                        <span className="text-[8px] font-black text-[#66c0f4]/70 uppercase tracking-tighter italic">Max Card</span>
                        <span className="text-xs font-black text-[#66c0f4]">${game.highestCardPrice.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className={`flex items-center gap-2 ${viewMode === 'grid' ? 'mt-4 pt-3 border-t border-white/5 w-full justify-between' : ''}`}>
                    {viewMode === 'list' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a href={`https://steamcommunity.com/market/search?q=${encodeURIComponent(game.gameName)}&appid=753`} target="_blank" className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                            <ExternalLink className="w-4 h-4 text-[#4d535b] group-hover:text-[#66c0f4]" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent className="bg-[#171d25] border-white/10 text-white text-[10px] font-black uppercase">Market</TooltipContent>
                      </Tooltip>
                    )}

                    <Button variant="ghost" size={viewMode === 'grid' ? 'sm' : 'icon'} onClick={() => toggleGame(game.appId)} className={`rounded-xl h-10 ${viewMode === 'grid' ? 'flex-1 gap-2 text-[10px] font-black uppercase' : 'w-10'}`}>
                      {viewMode === 'grid' && (expandedGames.has(game.appId) ? 'Gizle' : 'Kartları Gör')}
                      <ChevronDown className={`w-4 h-4 text-[#4d535b] transition-transform ${expandedGames.has(game.appId) ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </CardContent>

                {expandedGames.has(game.appId) && (
                  <div className="px-6 pb-6 pt-4 border-t border-white/5 bg-black/40 animate-in slide-in-from-top-2 duration-300">
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
                      {[...game.normalCards, ...game.foilCards].sort((a, b) => b.price - a.price).map((card, i) => (
                        <div key={i} className="space-y-2 text-center group/card">
                          <div className="relative aspect-[62/62] overflow-hidden rounded-lg bg-[#1b2838] border border-white/5 group-hover/card:border-[#66c0f4]/30 transition-all shadow-xl">
                            <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover scale-110 group-hover/card:scale-100 transition-transform duration-500" />
                            {card.isFoil && <Badge className="absolute top-1 right-1 bg-yellow-500/90 text-[#1b2838] text-[7px] font-black border-none h-3 px-1 rounded-sm">FOIL</Badge>}
                          </div>
                          <p className="text-[10px] font-black text-white italic truncate tracking-tighter opacity-80 group-hover/card:opacity-100">${card.price.toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {/* Footer Support */}
          <div className="mt-20 border-t border-white/5 pt-12 flex flex-col md:flex-row justify-between items-center gap-8 opacity-40 hover:opacity-100 transition-opacity">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#66c0f4] to-[#2a475e] p-2 rotate-3 shadow-xl">
                <Trophy className="w-full h-full text-[#1b2838]" />
              </div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[#8f98a0]">Support Revetax</p>
            </div>
            <div className="flex gap-4">
              <a href="https://store.steampowered.com/wishlist/id/Revetaxn/" target="_blank" className="h-10 px-6 rounded-xl bg-white/5 border border-white/5 hover:border-[#66c0f4]/30 flex items-center gap-3 transition-all group">
                <Star className="w-3.5 h-3.5 text-[#4d535b] group-hover:text-yellow-500" />
                <span className="text-[9px] font-black uppercase tracking-tighter text-white">Wishlist</span>
              </a>
              <a href="https://steamcommunity.com/tradeoffer/new/?partner=75521086&token=4YxxBXfy" target="_blank" className="h-10 px-6 rounded-xl bg-white/5 border border-white/5 hover:border-[#66c0f4]/30 flex items-center gap-3 transition-all group">
                <RefreshCw className="w-3.5 h-3.5 text-[#4d535b] group-hover:text-[#66c0f4]" />
                <span className="text-[9px] font-black uppercase tracking-tighter text-white">Trade Offer</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
