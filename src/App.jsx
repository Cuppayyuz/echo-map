// src/App.jsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase } from './lib/supabase'
import * as turf from '@turf/turf'

export default function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const [lng, setLng] = useState(112.74)
  const [lat, setLat] = useState(-7.25)
  const [zoom] = useState(13)

  const [uiState, setUiState] = useState('idle')
  const [timeLeft, setTimeLeft] = useState(5)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const [selectedColor, setSelectedColor] = useState('')
  
  const [turnstileToken, setTurnstileToken] = useState(null)
  const [isUploading, setIsUploading] = useState(false)

  const [resonanceAlert, setResonanceAlert] = useState(null)
  const lastResonatedId = useRef(null)

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const audioContextRef = useRef(null)

  // ==========================================
  // 🔮 STATE DATA & FILTER
  // ==========================================
  const [activeFilter, setActiveFilter] = useState('all')
  const [memoriesData, setMemoriesData] = useState([]) 
  const [isMapLoaded, setIsMapLoaded] = useState(false) // Penanda GPU siap

  const moodFilters = [
    { label: 'Semua', color: 'all' },
    { label: 'Bahagia', color: '#facc15' },
    { label: 'Sedih', color: '#3b82f6' },
    { label: 'Marah', color: '#ef4444' },
    { label: 'Rindu', color: '#a855f7' },
    { label: 'Tenang', color: '#34d399' },
    { label: 'Hampa', color: '#9ca3af' }
  ]

  const getMoodName = (hex) => {
    const mood = moodFilters.find(m => m.color === hex)
    return mood ? mood.label : 'Sebuah emosi'
  }

  // ==========================================
  // 📥 PENGAMBILAN DATA
  // ==========================================
  const loadMemories = async () => {
    const { data, error } = await supabase.from('memories').select('id, warna, audio_url, lokasi')
    if (error) {
      console.error("Gagal memuat jejak memori:", error)
      return
    }

    // Ekstrak & bersihkan koordinat PostGIS
    const cleanedData = data.map(item => {
      let coords = []
      if (typeof item.lokasi === 'object' && item.lokasi.coordinates) {
        coords = item.lokasi.coordinates
      } else if (typeof item.lokasi === 'string') {
        const match = item.lokasi.match(/POINT\(([^ ]+) ([^)]+)\)/)
        if (match) coords = [parseFloat(match[1]), parseFloat(match[2])]
      }
      return { ...item, cleanCoords: coords }
    }).filter(item => item.cleanCoords.length === 2)

    setMemoriesData(cleanedData)
  }

  // ==========================================
  // 🛰️ MESIN RENDER MAPLIBRE (CLUSTERING & HEATMAP)
  // ==========================================
  useEffect(() => {
    if (!isMapLoaded || !map.current) return

    // Saring data berdasarkan filter warna
    const filteredData = activeFilter === 'all' 
      ? memoriesData 
      : memoriesData.filter(item => item.warna === activeFilter)

    // Format ulang menjadi standar pemetaan global (GeoJSON)
    const geojson = {
      type: 'FeatureCollection',
      features: filteredData.map(item => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: item.cleanCoords },
        properties: { id: item.id, warna: item.warna, audio_url: item.audio_url }
      }))
    }

    const sourceId = 'memories-source'

    if (map.current.getSource(sourceId)) {
      // Jika sumber data sudah ada, cukup timpa dengan data baru
      map.current.getSource(sourceId).setData(geojson)
    } else {
      // Injeksi data awal ke Mesin GPU Peta
      map.current.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50 // Radius penggabungan (50px)
      })

      // LAPISAN 1: Awan Aura Gabungan (Blur & Glow)
      map.current.addLayer({
        id: 'clusters',
        type: 'circle',
        source: sourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#ffffff', 
          'circle-radius': ['step', ['get', 'point_count'], 25, 10, 35, 50, 45], // Makin banyak data, makin besar awannya
          'circle-blur': 0.3,
          'circle-opacity': 0.8
        }
      })

      // LAPISAN 2: Angka Jumlah Memori
      map.current.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: sourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 14
        },
        paint: { 'text-color': '#000000' }
      })

      // LAPISAN 3: Titik Memori Satuan (Tidak Digabung)
      map.current.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: sourceId,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'warna'],
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-blur': 0.2
        }
      })

      // INTERAKSI: Klik pada Awan Aura (Zoom-in otomatis)
      map.current.on('click', 'clusters', (e) => {
        const features = map.current.queryRenderedFeatures(e.point, { layers: ['clusters'] })
        const clusterId = features[0].properties.cluster_id
        map.current.getSource(sourceId).getClusterExpansionZoom(clusterId, (err, targetZoom) => {
          if (err) return
          map.current.easeTo({ center: features[0].geometry.coordinates, zoom: targetZoom + 1 })
        })
      })

      // INTERAKSI: Klik pada Titik Satuan (Putar Audio)
      map.current.on('click', 'unclustered-point', (e) => {
        const audioUrl = e.features[0].properties.audio_url
        if (window.currentMemoryAudio) window.currentMemoryAudio.pause()
        const audio = new Audio(audioUrl)
        window.currentMemoryAudio = audio
        audio.play()
      })

      // Ubah kursor jadi telunjuk (Pointer) saat mengenai titik
      map.current.on('mouseenter', 'clusters', () => map.current.getCanvas().style.cursor = 'pointer')
      map.current.on('mouseleave', 'clusters', () => map.current.getCanvas().style.cursor = '')
      map.current.on('mouseenter', 'unclustered-point', () => map.current.getCanvas().style.cursor = 'pointer')
      map.current.on('mouseleave', 'unclustered-point', () => map.current.getCanvas().style.cursor = '')
    }
  }, [memoriesData, activeFilter, isMapLoaded])

  // ==========================================
  // 🗺️ INISIALISASI PETA
  // ==========================================
  useEffect(() => {
    if (map.current) return
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [lng, lat],
      zoom: zoom,
      attributionControl: false
    })

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: false
    })
    
    map.current.addControl(geolocate, 'top-left')
    
    geolocate.on('geolocate', (e) => {
      const currentLng = e.coords.longitude
      const currentLat = e.coords.latitude
      setLng(currentLng)
      setLat(currentLat)

      if (memoriesData.length > 0) {
        const userPoint = turf.point([currentLng, currentLat])
        let nearest = null
        let minDistance = Infinity

        memoriesData.forEach(item => {
          if (item.cleanCoords) {
            const memoryPoint = turf.point(item.cleanCoords)
            const distance = turf.distance(userPoint, memoryPoint, { units: 'meters' })
            if (distance < 50 && distance < minDistance) {
              minDistance = distance
              nearest = item
            }
          }
        })

        if (nearest && lastResonatedId.current !== nearest.id) {
          lastResonatedId.current = nearest.id
          if (navigator.vibrate) navigator.vibrate([200, 100, 200])
          
          const mood = getMoodName(nearest.warna)
          setResonanceAlert(`Resonansi: Seseorang pernah meninggalkan jejak ${mood} di dekat sini.`)
          setTimeout(() => setResonanceAlert(null), 6000)
        }
      }
    })

    map.current.on('load', () => {
      setIsMapLoaded(true) // Beri tahu sistem bahwa GPU siap merender
      geolocate.trigger()
      loadMemories()
    })
  }, [lng, lat, zoom, memoriesData]) // Menambahkan memoriesData agar radar GPS selalu menggunakan data terbaru

  // --- LOGIKA REKAMAN & UPLOAD TETAP SAMA ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setUiState('recording')
      setTimeLeft(5)
      audioChunksRef.current = []

      const AudioContext = window.AudioContext || window.webkitAudioContext
      audioContextRef.current = new AudioContext()
      const analyser = audioContextRef.current.createAnalyser()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyser)
      analyser.fftSize = 256
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      const drawWaveform = () => {
        if (!canvasRef.current) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        const width = canvas.width
        const height = canvas.height

        animationRef.current = requestAnimationFrame(drawWaveform)
        analyser.getByteFrequencyData(dataArray)

        ctx.clearRect(0, 0, width, height)
        const barWidth = (width / bufferLength) * 2.5
        let x = 0

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = dataArray[i] / 2
          ctx.fillStyle = `rgb(${barHeight + 100}, 50, 50)`
          ctx.fillRect(x, height - barHeight, barWidth, barHeight)
          x += barWidth + 1
        }
      }
      drawWaveform()

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(audioBlob)
        setAudioBlob(audioBlob)
        setAudioUrl(url)
        setUiState('preview')
        
        stream.getTracks().forEach(track => track.stop())
        cancelAnimationFrame(animationRef.current)
        if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close()
      }

      mediaRecorder.start()

      let counter = 5
      const timer = setInterval(() => {
        counter -= 1
        setTimeLeft(counter)
        if (counter <= 0) {
          clearInterval(timer)
          if (mediaRecorder.state === 'recording') mediaRecorder.stop()
        }
      }, 1000)
    } catch (err) {
      console.error("Akses mikrofon ditolak:", err)
      alert("Sistem membutuhkan akses mikrofon untuk merekam jejak.")
    }
  }

  const cancelMemory = () => {
    setUiState('idle')
    setAudioBlob(null)
    setAudioUrl(null)
    setSelectedColor('')
    setTurnstileToken(null)
  }

  const uploadMemory = async () => {
    if (!audioBlob || !selectedColor || !turnstileToken) return
    setIsUploading(true)

    try {
      const { data: authData, error: authErr } = await supabase.auth.signInAnonymously()
      if (authErr) throw new Error("Gagal membuat sesi anonim.")
      
      const userId = authData.user.id
      const formData = new FormData()
      formData.append("audio", audioBlob, `memory.webm`)
      formData.append("turnstileToken", turnstileToken)
      formData.append("userId", userId)

      const workerResponse = await fetch("https://echo-api.echo-map.workers.dev", {
        method: "POST",
        body: formData
      })

      if (!workerResponse.ok) {
        const errText = await workerResponse.text()
        throw new Error(errText)
      }

      const { audio_url } = await workerResponse.json()

      const { error: dbError } = await supabase
        .from('memories')
        .insert({
          user_id: userId,
          lokasi: `POINT(${lng} ${lat})`,
          warna: selectedColor,
          audio_url: audio_url
        })

      if (dbError) throw dbError

      alert("Jejak berhasil ditinggalkan! 🚀")
      cancelMemory() 
      loadMemories()
    } catch (error) {
      console.error("Upload gagal:", error)
      alert(error.message || "Koneksi terputus. Pastikan sinyalmu bagus dan coba lagi ya!")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* UI: POP-UP NOTIFIKASI RESONANSI */}
      {resonanceAlert && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 w-11/12 max-w-sm animate-bounce">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 p-4 rounded-2xl shadow-[0_0_30px_rgba(255,255,255,0.1)] flex items-center gap-4">
            <div className="text-2xl animate-pulse">✨</div>
            <p className="text-white text-sm font-semibold tracking-wide drop-shadow-md">
              {resonanceAlert}
            </p>
          </div>
        </div>
      )}

      {uiState === 'idle' && (
        <>
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[90%] max-w-md z-10 overflow-x-auto no-scrollbar">
            <div className="flex gap-2 bg-black/50 backdrop-blur-md p-2 rounded-2xl border border-gray-800 shadow-lg w-max mx-auto">
              {moodFilters.map(filter => (
                <button
                  key={filter.label}
                  onClick={() => setActiveFilter(filter.color)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-2
                    ${activeFilter === filter.color 
                      ? 'bg-white/20 text-white ring-1 ring-white/50' 
                      : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`}
                >
                  {filter.color !== 'all' && (
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: filter.color, boxShadow: `0 0 8px ${filter.color}` }}></span>
                  )}
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="absolute top-20 right-4 bg-black/60 backdrop-blur-md text-white p-4 rounded-xl border border-gray-800 shadow-lg text-sm z-10 hidden md:block">
            <p className="font-bold mb-3 text-gray-200">Aura Emosi</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-yellow-400 shadow-[0_0_8px_#facc15]"></span> Bahagia</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span> Sedih</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]"></span> Marah</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-purple-500 shadow-[0_0_8px_#a855f7]"></span> Rindu</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span> Tenang</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-gray-400 shadow-[0_0_8px_#9ca3af]"></span> Hampa</div>
            </div>
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
            <button onClick={startRecording} className="w-18 h-18 bg-white/10 backdrop-blur border-2 border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 transition-all group">
              <div className="w-12 h-12 bg-red-600 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.8)] group-hover:scale-95 transition-transform"></div>
            </button>
            <span className="text-white text-xs font-semibold tracking-wider text-shadow-md">REKAM JEJAK</span>
          </div>
        </>
      )}

      {uiState === 'recording' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <h2 className="text-white text-2xl font-bold mb-4">Merekam...</h2>
          <div className="text-red-500 text-5xl font-mono mb-8 font-bold animate-pulse">{timeLeft}s</div>
          <canvas ref={canvasRef} width="300" height="100" className="bg-transparent mb-8"></canvas>
        </div>
      )}

      {uiState === 'preview' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-12 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-2xl w-11/12 max-w-md flex flex-col items-center">
            
            {isUploading ? (
               <div className="py-10 flex flex-col items-center animate-pulse">
                 <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                 <p className="text-white font-semibold">Menitipkan memori...</p>
               </div>
            ) : (
              <>
                <h3 className="text-white font-bold mb-4">Pratinjau Jejak</h3>
                {audioUrl && <audio src={audioUrl} controls className="w-full mb-6" />}

                <h4 className="text-gray-300 text-sm mb-3">Pilih Aura Emosimu:</h4>
                <div className="flex gap-4 mb-6">
                  {['#facc15', '#3b82f6', '#ef4444', '#a855f7', '#34d399', '#9ca3af'].map(color => (
                    <button 
                      key={color} 
                      onClick={() => setSelectedColor(color)}
                      className={`w-8 h-8 rounded-full transition-all ${selectedColor === color ? 'scale-125 ring-2 ring-white' : 'opacity-60 hover:opacity-100'}`}
                      style={{ backgroundColor: color, boxShadow: selectedColor === color ? `0 0 15px ${color}` : 'none' }}
                    />
                  ))}
                </div>

                <div className="hidden">
                  <Turnstile 
                    siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY} 
                    onSuccess={(token) => setTurnstileToken(token)}
                  />
                </div>

                <div className="flex w-full gap-4 mt-4">
                  <button onClick={cancelMemory} className="flex-1 py-3 rounded-lg text-white bg-gray-700 hover:bg-gray-600 font-semibold transition-colors">Batal</button>
                  <button 
                    onClick={uploadMemory}
                    disabled={!selectedColor || !turnstileToken}
                    className="flex-1 py-3 rounded-lg text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors shadow-[0_0_15px_rgba(37,99,235,0.5)]">
                    Kirim Jejak
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}