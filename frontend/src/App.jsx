import { useEffect } from 'react'
import PredictionPage from './admin/prediction.jsx'

const PREDICTION_PATH = '/admin/prediction'

function App() {
  useEffect(() => {
    if (window.location.pathname !== PREDICTION_PATH) {
      window.history.replaceState(null, '', PREDICTION_PATH)
    }
  }, [])

  return <PredictionPage />
}

export default App
