// src/App.jsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function App() {
  // Peta State
  const mapContainer = useRef(null)
  const map = useRef(null)
  const [lng] = useState(112.74)
  const [lat] = useState(-7.25)
  const [zoom] = useState(13)

  // Mesin Audio State
  const [uiState, setUiState] = useState('idle') // 'idle' | 'recording' | 'preview'
  const [timeLeft, setTimeLeft] = useState(5)
  const [audioUrl, setAudioUrl] = useState(null)
  const [audioBlob, setAudioBlob] = useState(null)
  const [selectedColor, setSelectedColor] = useState('')

  // Referensi Audio & Animasi
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const audioContextRef = useRef(null)

  // --- LOGIKA PETA (Tetap Sama) ---
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
    map.current.on('load', () => geolocate.trigger())
  }, [lng, lat, zoom])

  // --- LOGIKA MESIN AUDIO ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      setUiState('recording')
      setTimeLeft(5)
      audioChunksRef.current = []

      // Setup AudioContext untuk Visualisasi Canvas
      const AudioContext = window.AudioContext || window.webkitAudioContext
      audioContextRef.current = new AudioContext()
      const analyser = audioContextRef.current.createAnalyser()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyser)
      analyser.fftSize = 256
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      // Fungsi Menggambar Waveform
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

      // Inisialisasi MediaRecorder (Prioritas format Opus untuk ukuran super kecil)
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm'
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(audioBlob)
        setAudioBlob(audioBlob)
        setAudioUrl(url)
        setUiState('preview')
        
        // Bersihkan stream dan animasi
        stream.getTracks().forEach(track => track.stop())
        cancelAnimationFrame(animationRef.current)
        if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close()
      }

      mediaRecorder.start()

      // Penghenti Otomatis Detik ke-5
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
      console.error("Akses mikrofon ditolak atau gagal:", err)
      alert("Sistem membutuhkan akses mikrofon untuk merekam jejak.")
    }
  }

  const cancelMemory = () => {
    setUiState('idle')
    setAudioBlob(null)
    setAudioUrl(null)
    setSelectedColor('')
  }

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* OVERLAY: Tampil hanya saat IDLE */}
      {uiState === 'idle' && (
        <>
          <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md text-white p-4 rounded-xl border border-gray-800 shadow-lg text-sm z-10">
            <p className="font-bold mb-3 text-gray-200">Aura Emosi</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-yellow-400 shadow-[0_0_8px_#facc15]"></span> Bahagia</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]"></span> Sedih</div>
              <div className="flex items-center gap-3"><span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]"></span> Marah</div>
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

      {/* OVERLAY: Merekam Audio */}
      {uiState === 'recording' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <h2 className="text-white text-2xl font-bold mb-4">Merekam...</h2>
          <div className="text-red-500 text-5xl font-mono mb-8 font-bold animate-pulse">{timeLeft}s</div>
          <canvas ref={canvasRef} width="300" height="100" className="bg-transparent mb-8"></canvas>
          <p className="text-gray-400 text-sm">Bicaralah ke mikrofon...</p>
        </div>
      )}

      {/* OVERLAY: Preview & Pilih Aura */}
      {uiState === 'preview' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-end pb-12 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-2xl shadow-2xl w-11/12 max-w-md flex flex-col items-center">
            <h3 className="text-white font-bold mb-4">Pratinjau Jejak</h3>
            
            {/* Audio Player Bawaan HTML5 */}
            {audioUrl && <audio src={audioUrl} controls className="w-full mb-6" />}

            <h4 className="text-gray-300 text-sm mb-3">Pilih Aura Emosimu:</h4>
            <div className="flex gap-4 mb-8">
              {['#facc15', '#3b82f6', '#ef4444', '#a855f7', '#34d399', '#9ca3af'].map(color => (
                <button 
                  key={color} 
                  onClick={() => setSelectedColor(color)}
                  className={`w-8 h-8 rounded-full transition-all ${selectedColor === color ? 'scale-125 ring-2 ring-white' : 'opacity-60 hover:opacity-100'}`}
                  style={{ backgroundColor: color, boxShadow: selectedColor === color ? `0 0 15px ${color}` : 'none' }}
                />
              ))}
            </div>

            <div className="flex w-full gap-4">
              <button onClick={cancelMemory} className="flex-1 py-3 rounded-lg text-white bg-gray-700 hover:bg-gray-600 font-semibold transition-colors">Batal</button>
              <button 
                disabled={!selectedColor}
                className="flex-1 py-3 rounded-lg text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors shadow-[0_0_15px_rgba(37,99,235,0.5)]">
                Kirim Jejak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}