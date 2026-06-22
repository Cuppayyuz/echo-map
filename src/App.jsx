// src/App.jsx
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css' // Wajib agar UI peta (seperti tombol zoom) tidak hancur

export default function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  
  // Titik tengah default kita atur di koordinat 112.74, -7.25 (Surabaya) 
  // sebelum GPS mendeteksi lokasi presisi perangkat.
  const [lng] = useState(112.74)
  const [lat] = useState(-7.25)
  const [zoom] = useState(13)

  useEffect(() => {
    if (map.current) return // Cegah inisialisasi ganda pada mode Strict React

    // 1. Render Peta dengan mode gelap gratis (Carto Dark Matter)
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [lng, lat],
      zoom: zoom,
      attributionControl: false // Menyembunyikan kredit agar UI lebih bersih
    })

    // 2. Tambahkan Kontrol GPS bawaan MapLibre
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showAccuracyCircle: false // Matikan lingkaran biru besar yang mengganggu visual
    })
    
    map.current.addControl(geolocate, 'top-left')

    // 3. Otomatis picu pencarian lokasi saat peta selesai dimuat
    map.current.on('load', () => {
      geolocate.trigger()
    })

  }, [lng, lat, zoom])

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden font-sans">
      
      {/* Kanvas Peta MapLibre */}
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

      {/* OVERLAY UI */}
      
      {/* Legend Warna Aura */}
      <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md text-white p-4 rounded-xl border border-gray-800 shadow-lg text-sm z-10">
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

      {/* Tombol Aksi Utama (Rekam) */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
        <button className="w-18 h-18 bg-white/10 backdrop-blur border-2 border-white/20 rounded-full flex items-center justify-center hover:bg-white/20 transition-all group">
          <div className="w-12 h-12 bg-red-600 rounded-full shadow-[0_0_20px_rgba(220,38,38,0.8)] group-hover:scale-95 transition-transform"></div>
        </button>
        <span className="text-white text-xs font-semibold tracking-wider text-shadow-md">REKAM JEJAK</span>
      </div>

    </div>
  )
}