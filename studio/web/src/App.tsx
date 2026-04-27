import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import ConfigsPage from './pages/Configs'
import DatasetsPage from './pages/Datasets'
import LogPage from './pages/Log'
import MonitorPage from './pages/Monitor'
import QueuePage from './pages/Queue'

export default function App() {
  return (
    <BrowserRouter basename="/studio">
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 px-8 py-6 overflow-auto h-screen">
          <Routes>
            <Route path="/" element={<MonitorPage />} />
            <Route path="/configs" element={<ConfigsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/queue/:id/log" element={<LogPage />} />
            <Route path="/datasets" element={<DatasetsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
