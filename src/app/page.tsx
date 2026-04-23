'use client'

import React, { useState, useCallback, useRef, useMemo } from 'react'
import {
  TrendingUp, Search, RefreshCw, X, Layout,
  ExternalLink, Info, Loader2, Zap, Trophy,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
  Globe, User, Gamepad2, Coins, BarChart3, Star
} from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

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
    title: 'Steam Kart Takipçisi',
    subtitle: 'Kütüphaneni saniyeler içinde tara.',
    urlPlaceholder: 'Steam Profil URL veya ID',
    apiKeyPlaceholder: 'API Anahtarı',
    analyze: 'Tara',
    continue: 'Kalanlar',
    scanning: 'Taranıyor...',
    progress: 'Kütüphane İlerlemesi',
    potentialProfit: 'Top. Kazanç',
    topFoil: 'En Değerli Foil',
    normalAvg: 'Ort. Kart',
    noGames: 'Henüz tarama yapılmadı.'
  },
  en: {
    title: 'Steam Card Tracker',
    subtitle: 'Scan your library in seconds.',
    urlPlaceholder: 'Steam Profile URL or ID',
    apiKeyPlaceholder: 'API Key',
    analyze: 'Scan',
    continue: 'Continue',
    scanning: 'Scanning...',
    progress: 'Library Progress',
    potentialProfit: 'Total Profit',
    topFoil: 'Top Foil',
    normalAvg: 'Avg. Card',
    noGames: 'No games scanned yet.'
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
              current: (isMore ? (p?.current || 0) : 0) + data.current,
              total: data.total,
              foundInLib: data.found
            }))
            if (data.type === 'game') {
              setGames(prev => {
                if (prev.some(g => g.appId === data.data.appId)) return prev
                const updated = [...prev, data.data]
                return updated.sort((a, b) => (b.droppableCardsValue + b.foilCardsValue) - (a.droppableCardsValue + a.foilCardsValue))
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

  const totalPot = useMemo(() => games.reduce((acc, g) => acc + g.droppableCardsValue + g.foilCardsValue, 0), [games])

  return (
    <div className="min-h-screen bg-[#0d121a] text-[#c7d5e0] font-sans selection:bg-[#66c0f4]/20">
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[10%] left-[10%] w-[30%] h-[30%] bg-[#66c0f4] blur-[150px] rounded-full"></div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-12 relative">
        {/* Minimal Header */}
        <div className="flex flex-col md:flex-row justify-between items-end mb-12 gap-8">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <TrendingUp className="w-6 h-6 text-[#66c0f4]" />
              <h1 className="text-2xl font-black tracking-tight text-white uppercase italic">STC PLATINUM</h1>
            </div>
            <p className="text-sm font-medium text-[#8f98a0]">{t.subtitle}</p>
          </div>

          <div className="w-full md:w-auto flex flex-col md:flex-row gap-4">
            <div className="flex bg-[#171d25] rounded-xl p-1 border border-white/5 h-12 items-center px-4 gap-4 flex-1">
              <Globe className="w-4 h-4 text-[#4d535b]" />
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.urlPlaceholder} className="border-none bg-transparent h-full text-sm text-white focus-visible:ring-0 placeholder:text-[#4d535b] p-0 w-48" />
              <div className="w-px h-6 bg-white/10"></div>
              <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder={t.apiKeyPlaceholder} className="border-none bg-transparent h-full text-sm text-white focus-visible:ring-0 placeholder:text-[#4d535b] p-0 w-32" />
            </div>
            <div className="flex gap-2">
              {loading ? (
                <Button onClick={() => abortControllerRef.current?.abort()} variant="destructive" className="h-12 w-12 rounded-xl border border-white/5 p-0">
                  <X className="w-5 h-5" />
                </Button>
              ) : (
                <Button onClick={() => analyzeProfile(false)} className="h-12 bg-[#66c0f4] hover:bg-[#4fa3d3] text-[#1b2838] font-black px-8 rounded-xl shadow-lg shadow-[#66c0f4]/10 uppercase transition-all active:scale-95">
                  {t.analyze}
                </Button>
              )}
              {!loading && progress && progress.current < progress.total && (
                <Button onClick={() => analyzeProfile(true)} className="h-12 bg-green-500 hover:bg-green-600 text-[#1b2838] font-black px-8 rounded-xl shadow-lg shadow-green-500/10 uppercase animate-pulse">
                  {t.continue}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Real-time Dashboard */}
        {progress && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12 animate-in fade-in slide-in-from-top-4 duration-700">
            <Card className="bg-[#171d25]/60 border-white/5 backdrop-blur-xl">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#8f98a0]">{t.progress}</span>
                  <span className="text-xs font-mono text-[#66c0f4]">{progress.current} / {progress.total}</span>
                </div>
                <Progress value={(progress.current / progress.total) * 100} className="h-1.5 bg-white/5 [&>div]:bg-[#66c0f4]" />
                <p className="text-[9px] mt-3 font-bold opacity-40 uppercase truncate italic">{statusMessage}</p>
              </CardContent>
            </Card>

            <Card className="bg-[#171d25]/60 border-white/5 backdrop-blur-xl">
              <CardContent className="p-6">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#8f98a0]">Library Scan Status</span>
                <div className="flex items-end gap-3 mt-2">
                  <div className="text-3xl font-black text-white italic">{progress.foundInLib}</div>
                  <div className="text-[10px] font-bold text-[#8f98a0] mb-1.5 uppercase">Owned Games</div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[#66c0f4]/10 border-[#66c0f4]/10 backdrop-blur-xl">
              <CardContent className="p-6">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#66c0f4]/70">{t.potentialProfit}</span>
                <div className="flex items-end gap-2 mt-2">
                  <div className="text-3xl font-black text-green-400 italic">${totalPot.toFixed(2)}</div>
                  <div className="text-[10px] font-bold text-green-400 mb-1.5 uppercase tracking-widest">USD</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Main List */}
        <div className="space-y-3">
          {games.length === 0 && !loading && !error && (
            <div className="py-40 flex flex-col items-center opacity-20 select-none">
              <Gamepad2 className="w-16 h-16 mb-4" />
              <p className="font-black uppercase tracking-[0.3em] text-xs">{t.noGames}</p>
            </div>
          )}

          {error && (
            <div className="text-center p-6 border border-red-500/20 bg-red-500/5 rounded-2xl animate-in zoom-in-95 duration-300">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-sm font-bold text-red-400 uppercase italic">{error}</p>
            </div>
          )}

          {games.map((game, idx) => (
            <Card key={game.appId} className="bg-[#171d25]/40 border-white/5 hover:border-[#66c0f4]/20 transition-all duration-300 overflow-hidden group">
              <CardContent className="p-3 flex items-center gap-6">
                <img src={game.gameIconUrl} className="w-24 h-10 object-cover rounded-md flex-shrink-0 grayscale group-hover:grayscale-0 transition-all duration-500" />

                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-black text-white truncate uppercase italic tracking-tight">{game.gameName}</h3>
                  <div className="flex items-center gap-6 mt-1.5">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black text-[#8f98a0] uppercase tracking-tighter">Normal Drop</span>
                      <span className="text-xs font-black text-[#66c0f4]">${game.droppableCardsValue.toFixed(2)}</span>
                    </div>
                    {game.foilCards.length > 0 && (
                      <>
                        <div className="w-px h-4 bg-white/5"></div>
                        <div className="flex flex-col">
                          <span className="text-[8px] font-black text-yellow-500/70 uppercase tracking-tighter">Top Foil</span>
                          <span className="text-xs font-black text-yellow-500">${game.foilCardsValue.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a href={`https://steamcommunity.com/market/search?q=${encodeURIComponent(game.gameName)}&appid=753`} target="_blank" className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-all">
                          <ExternalLink className="w-4 h-4 text-[#4d535b] group-hover:text-[#66c0f4]" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent className="bg-[#171d25] border-white/10 text-white text-[10px] font-black uppercase">Market</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <Button variant="ghost" size="icon" onClick={() => toggleGame(game.appId)} className={`rounded-xl transition-transform h-10 w-10 ${expandedGames.has(game.appId) ? 'rotate-180 bg-white/5' : ''}`}>
                    <ChevronDown className="w-5 h-5 text-[#4d535b]" />
                  </Button>
                </div>
              </CardContent>

              {expandedGames.has(game.appId) && (
                <div className="px-6 pb-6 pt-2 border-t border-white/5 bg-black/20 animate-in slide-in-from-top-2 duration-300">
                  <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-3">
                    {[...game.normalCards, ...game.foilCards].sort((a, b) => b.price - a.price).map((card, i) => (
                      <div key={i} className="space-y-2 text-center group/card">
                        <div className="relative aspect-square overflow-hidden rounded-lg bg-[#1b2838] border border-white/5 group-hover/card:border-[#66c0f4]/30 transition-all">
                          <img src={card.imageUrl} className="w-full h-full object-cover scale-110 group-hover/card:scale-100 transition-transform duration-500" />
                          {card.isFoil && <Badge className="absolute top-1 right-1 bg-yellow-500 text-[#1b2838] text-[8px] font-black border-none h-4 px-1">FOIL</Badge>}
                        </div>
                        <p className="text-[10px] font-black text-white italic truncate">${card.price.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>

        {/* Footer Support */}
        <div className="mt-20 border-t border-white/5 pt-12 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#66c0f4] to-[#2a475e] p-2 rotate-3">
              <Trophy className="w-full h-full text-[#1b2838]" />
            </div>
            <p className="text-xs font-black uppercase tracking-widest text-[#4d535b]">Support Revetax</p>
          </div>

          <div className="flex gap-4">
            <a href="https://store.steampowered.com/wishlist/id/Revetaxn/" target="_blank" className="h-12 px-8 rounded-xl bg-white/5 border border-white/5 hover:border-[#66c0f4]/30 flex items-center gap-3 transition-all group">
              <Star className="w-4 h-4 text-[#4d535b] group-hover:text-yellow-500" />
              <span className="text-[10px] font-black uppercase tracking-tighter text-white">Wishlist</span>
            </a>
            <a href="https://steamcommunity.com/tradeoffer/new/?partner=75521086&token=4YxxBXfy" target="_blank" className="h-12 px-8 rounded-xl bg-white/5 border border-white/5 hover:border-[#66c0f4]/30 flex items-center gap-3 transition-all group">
              <RefreshCw className="w-4 h-4 text-[#4d535b] group-hover:text-[#66c0f4]" />
              <span className="text-[10px] font-black uppercase tracking-tighter text-white">Trade Offer</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
