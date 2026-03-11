import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { TagDataProvider } from './TagDataContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TagDataProvider>
      <App />
    </TagDataProvider>
  </StrictMode>,
)
