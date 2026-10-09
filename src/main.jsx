import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { generarPdfCotizacion, DATOS_EMPRESA } from './App.jsx'
import Grua from './Grua.jsx'
import './styles.css'

// Solo en desarrollo local (npm run dev): http://localhost:5173/?demo=grua muestra la sección
// Grúa sin iniciar sesión, para revisar el diseño. En el build de producción no existe.
const demoGrua = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === 'grua'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {demoGrua
      ? <main className="main" style={{ maxWidth: 1240, margin: '0 auto' }}><Grua generarPdf={generarPdfCotizacion} baseDireccion={DATOS_EMPRESA.direccion} /></main>
      : <App />}
  </React.StrictMode>,
)
