'use client'

import React, { useState, useCallback, useRef, useMemo } from 'react'
import {
  TrendingUp, Search, RefreshCw, X, Layout,
  ExternalLink, Info, Loader2, Zap, Trophy,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle2,
  Globe, User, Gamepad2, Coins
} from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  hasCardDrops: boolean
}

interface ProfileInfo {
  steamId: string
  personaName: string
  avatarUrl: string
  profileUrl: string
  gameCount: number
}

// ===== TRANSLATIONS =====
const translations = {
  tr: {
    title: 'Steam Kart Takipçisi',
    subtitle: 'Kütüphanendeki en değerli koleksiyon kartlarını bul ve kazancını maksimize et.',
    urlLabel: 'Steam Profil URL veya SteamID64',
    urlPlaceholder: 'Örn: https://steamcommunity.com/id/stancly/',
    apiKeyLabel: 'Steam API Anahtarı',
    apiKeyPlaceholder: 'Daha hızlı keşif için...',
    analyze: 'Kütüphaneyi Tara',
    continue: 'Kalanları Getir',
    cancel: 'Durdur',
    scanning: 'Kütüphane taranıyor...',
    found: 'kartlı oyun bulundu',
    totalGames: 'Toplam Oyun',
    potentialProfit: 'Tahmini Kazanç',
    cardPrices: 'Kart Fiyatları',
    noGames: 'Henüz taranmış oyun yok.',
    batchComplete: 'Paket Tamamlandı',
    batchDesc: 'Steam limitlerine takılmamak için 100 oyunluk tarama bitti. Devam etmek için butona bas.',
    error: 'Hata oluştu, lütfen URL\'yi kontrol et.',
    maxPrice: 'En Değerli Kart'
  },
  en: {
    title: 'Steam Card Tracker',
    subtitle: 'Find the most valuable trading cards in your library and maximize your profit.',
    urlLabel: 'Steam Profile URL or SteamID64',
    urlPlaceholder: 'e.g. https://steamcommunity.com/id/stancly/',
    apiKeyLabel: 'Steam API Key',
    apiKeyPlaceholder: 'For faster discovery...',
    analyze: 'Scan Library',
    continue: 'Fetch Remaining',
    cancel: 'Stop',
    scanning: 'Scanning Library...',
    found: 'card games found',
    totalGames: 'Total Games',
    potentialProfit: 'Est. Profit',
    cardPrices: 'Card Prices',
    noGames: 'No games scanned yet.',
    batchComplete: 'Batch Completed',
    batchDesc: 'Scanned 100 games to avoid Steam rate limits. Press the button to continue.',
    error: 'An error occurred, please check the URL.',
    maxPrice: 'Highest Card'
  }
}

export default function SteamCardTracker() {
  // State
  const [lang, setLang] = useState<'tr' | 'en'>('tr')
  const t = translations[lang]
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileInfo | null>(null)
  const [games, setGames] = useState<GameResult[]>([])
  const [progress, setProgress] = useState<{ current: number, total: number, found: number } | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [expandedGames, setExpandedGames] = useState<Set<number>>(new Set())

  const abortControllerRef = useRef<AbortController | null>(null)

  // Handlers
  const toggleGame = (appId: number) => {
    const next = new Set(expandedGames)
    if (next.has(appId)) next.delete(appId)
    else next.add(appId)
    setExpandedGames(next)
  }

  const analyzeProfile = useCallback(async (isMore = false) => {
    if (!url.trim()) return

    if (!isMore) {
      abortControllerRef.current?.abort()
    }
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
            if (data.type === 'progress') setProgress({
              current: data.current,
              total: data.total,
              found: (isMore ? games.length : 0) + data.found
            })
            if (data.type === 'game') {
              setGames(prev => {
                const updated = [...prev, data.data]
                return updated.sort((a, b) => b.droppableCardsValue - a.droppableCardsValue)
              })
            }
            if (data.type === 'complete') {
              if (data.data.profile) setProfile(data.data.profile)
              setLoading(false)
            }
            if (data.type === 'error') throw new Error(data.message)
          } catch (e) { console.error('E:', e) }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message || t.error)
    } finally {
      setLoading(false)
    }
  }, [url, apiKey, lang, t, games])

  const totalPot = useMemo(() => games.reduce((acc, g) => acc + g.droppableCardsValue, 0), [games])

  return (
    <div className="min-h-screen bg-[#1b2838] text-[#c7d5e0] font-sans selection:bg-[#66c0f4]/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-[#66c0f4]/5 blur-[120px] rounded-full"></div>
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-[#2a475e]/10 blur-[100px] rounded-full"></div>
      </div>

      <div className="container max-w-6xl mx-auto px-4 py-8 relative">
        <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-[#66c0f4] to-[#2a475e] rounded-2xl flex items-center justify-center shadow-2xl rotate-3">
              <TrendingUp className="w-8 h-8 text-[#1b2838]" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter text-white uppercase">{t.title}</h1>
              <p className="text-sm text-[#8f98a0] font-medium">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex bg-[#0d121a] rounded-full p-1 border border-white/5">
            <button onClick={() => setLang('tr')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${lang === 'tr' ? 'bg-[#66c0f4] text-[#1b2838]' : 'hover:text-white'}`}>TR</button>
            <button onClick={() => setLang('en')} className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${lang === 'en' ? 'bg-[#66c0f4] text-[#1b2838]' : 'hover:text-white'}`}>EN</button>
          </div>
        </header>

        <div className="grid lg:grid-cols-12 gap-8">
          <aside className="lg:col-span-4 space-y-6">
            <Card className="bg-[#0d121a]/60 backdrop-blur-xl border-white/5 shadow-2xl">
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-[#8f98a0] tracking-widest flex items-center gap-2">
                    <User className="w-3 h-3" /> {t.urlLabel}
                  </label>
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8f98a0]" />
                    <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.urlPlaceholder} className="pl-10 h-12 bg-[#171d25] border-white/5 text-white" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] uppercase font-black text-[#8f98a0] tracking-widest flex items-center gap-2">
                      <Zap className="w-3 h-3" /> {t.apiKeyLabel}
                    </label>
                    <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer" className="text-[9px] text-[#66c0f4] hover:underline font-bold">
                      {lang === 'tr' ? 'Anahtar Al' : 'Get Key'}
                    </a>
                  </div>
                  <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder={t.apiKeyPlaceholder} className="h-12 bg-[#171d25] border-white/5 text-white" />
                </div>

                <div className="flex gap-2 pt-2">
                  {loading ? (
                    <Button onClick={() => abortControllerRef.current?.abort()} variant="destructive" className="flex-1 h-12 font-bold uppercase tracking-tight">
                      <X className="w-4 h-4 mr-2" /> {t.cancel}
                    </Button>
                  ) : progress && progress.current < progress.total ? (
                    <>
                      <Button onClick={() => analyzeProfile(false)} variant="secondary" className="flex-1 h-12 font-bold uppercase tracking-tight border border-white/5">
                        {t.analyze}
                      </Button>
                      <Button onClick={() => analyzeProfile(true)} className="flex-[1.5] h-12 bg-green-500 hover:bg-green-600 text-[#1b2838] font-bold uppercase tracking-tight shadow-lg shadow-green-500/20 group">
                        <RefreshCw className="w-4 h-4 mr-2 group-hover:rotate-180 transition-transform duration-500" /> {t.continue}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => analyzeProfile(false)} disabled={!url.trim()} className="flex-1 h-12 bg-[#66c0f4] hover:bg-[#4fa3d6] text-[#1b2838] font-black uppercase tracking-tight shadow-lg shadow-[#66c0f4]/20">
                      <TrendingUp className="w-5 h-5 mr-2" /> {t.analyze}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {profile && (
              <Card className="bg-gradient-to-br from-[#171d25] to-[#0d121a] border-[#66c0f4]/20 shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="h-1 bg-[#66c0f4]"></div>
                <CardContent className="pt-6 flex items-center gap-4">
                  <div className="relative">
                    <img src={profile.avatarUrl} alt={profile.personaName} className="w-16 h-16 rounded-xl border-2 border-white/10 shadow-xl" />
                  </div>
                  <div>
                    <h3 className="font-black text-white text-lg leading-tight uppercase truncate max-w-[180px]">{profile.personaName}</h3>
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-bold text-[#8f98a0] tracking-tighter">{t.totalGames}</span>
                        <span className="text-sm font-black text-[#66c0f4]">{profile.gameCount}</span>
                      </div>
                      <div className="w-px h-6 bg-white/10"></div>
                      <div className="flex flex-col">
                        <span className="text-[9px] uppercase font-bold text-[#8f98a0] tracking-tighter">Kartlı</span>
                        <span className="text-sm font-black text-green-400">{progress?.found || games.length}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {games.length > 0 && (
              <div className="p-6 rounded-2xl bg-gradient-to-br from-[#66c0f4]/20 to-transparent border border-[#66c0f4]/10 shadow-inner">
                <div className="flex items-center gap-3 mb-2">
                  <Coins className="w-5 h-5 text-green-400" />
                  <span className="text-[10px] uppercase font-black tracking-widest text-[#8f98a0]">{t.potentialProfit}</span>
                </div>
                <div className="text-4xl font-black text-white tracking-tighter flex items-center gap-2">
                  {totalPot.toFixed(2)} <span className="text-lg font-bold text-green-400">$</span>
                </div>
              </div>
            )}

            <Card className="bg-[#0d121a]/40 border-dashed border-white/10 hover:border-[#66c0f4]/30 transition-colors cursor-pointer group">
              <a href="#" className="block p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-[#66c0f4]/20 transition-colors">
                    <Trophy className="w-5 h-5 text-[#8f98a0] group-hover:text-[#66c0f4]" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-tight">Support Me</h4>
                    <p className="text-[10px] text-[#8f98a0]">Buy me a coffee or donate skin.</p>
                  </div>
                </div>
              </a>
            </Card>
          </aside>

          <main className="lg:col-span-8 space-y-6">
            {loading && (
              <div className="p-8 rounded-3xl bg-[#0d121a]/40 border border-white/5 flex flex-col items-center justify-center text-center">
                <div className="relative w-20 h-20 mb-6">
                  <div className="absolute inset-0 rounded-full border-4 border-[#66c0f4]/20 border-t-[#66c0f4] animate-spin"></div>
                </div>
                <h2 className="text-xl font-bold text-white mb-2">{statusMessage}</h2>
                {progress && (
                  <div className="w-full max-w-xs space-y-2">
                    <Progress value={(progress.current / progress.total) * 100} className="h-2 bg-white/5 [&>div]:bg-[#66c0f4]" />
                    <p className="text-xs font-mono text-[#8f98a0] uppercase">{progress.current} / {progress.total}</p>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-4">
                <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
                <div>
                  <h4 className="font-bold text-white uppercase italic text-sm">{t.error}</h4>
                  <p className="text-xs text-red-400/80 mt-1">{error}</p>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {games.length === 0 && !loading && !error && (
                <div className="py-32 flex flex-col items-center justify-center text-center opacity-30 select-none">
                  <div className="w-24 h-24 rounded-full border-4 border-dashed border-[#8f98a0] flex items-center justify-center mb-6">
                    <Gamepad2 className="w-12 h-12 text-[#8f98a0]" />
                  </div>
                  <p className="text-sm font-black uppercase tracking-widest text-[#8f98a0]">{t.noGames}</p>
                </div>
              )}

              {games.map((game, idx) => (
                <Card key={game.appId} className="bg-[#0d121a]/60 border-white/5 overflow-hidden">
                  <CardContent className="p-0">
                    <div className="p-4 flex items-center gap-4">
                      <div className="relative group flex-shrink-0">
                        <img src={game.gameIconUrl} alt={game.gameName} className="w-32 h-[48px] rounded-lg object-cover" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-bold text-white text-base leading-tight truncate uppercase italic">{game.gameName}</h3>
                          <a href={`https://steamcommunity.com/market/search?appid=753&q=tag_app_${game.appId}`} target="_blank" rel="noopener noreferrer" className="bg-white/5 hover:bg-white/10 p-2 rounded-lg">
                            <ExternalLink className="w-3 h-3 text-[#8f98a0]" />
                          </a>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase text-[#66c0f4] tracking-tighter italic">{t.maxPrice}</span>
                            <span className="text-sm font-black text-[#66c0f4]">${game.highestCardPrice.toFixed(2)}</span>
                          </div>
                          <div className="w-px h-6 bg-white/5"></div>
                          <div className="flex flex-col">
                            <span className="text-[9px] font-black uppercase text-green-400 tracking-tighter italic">{t.potentialProfit}</span>
                            <span className="text-sm font-black text-green-400">${game.droppableCardsValue.toFixed(2)}</span>
                          </div>
                          {game.foilCards.length > 0 && (
                            <>
                              <div className="w-px h-6 bg-white/5"></div>
                              <div className="flex flex-col">
                                <span className="text-[9px] font-black uppercase text-yellow-500 tracking-tighter italic">Foil Price</span>
                                <span className="text-sm font-black text-yellow-500">${Math.max(...game.foilCards.map(c => c.price)).toFixed(2)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <Button variant="ghost" size="icon" onClick={() => toggleGame(game.appId)} className={expandedGames.has(game.appId) ? 'rotate-180' : ''}>
                        <ChevronDown className="w-5 h-5 text-[#8f98a0]" />
                      </Button>
                    </div>

                    {expandedGames.has(game.appId) && (
                      <div className="px-4 pb-6 pt-2 border-t border-white/5 bg-black/20 animate-in slide-in-from-top-2 duration-300">
                        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3">
                          {game.normalCards.map((card, i) => (
                            <div key={i} className="group relative bg-[#171d25] rounded-xl p-2 border border-white/5 hover:border-[#66c0f4]/30 transition-all text-center">
                              <img src={card.imageUrl} alt={card.name} className="w-full aspect-square rounded-lg mb-2 shadow-inner" />
                              <p className="text-[9px] text-[#8f98a0] truncate mb-0.5">{card.name}</p>
                              <p className="text-[10px] font-black text-white">${card.price.toFixed(2)}</p>
                              {card.isFoil && (
                                <Badge className="absolute top-1 right-1 bg-yellow-500/20 text-yellow-500 border-none text-[8px] p-0.5 px-1 font-black">FOIL</Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
