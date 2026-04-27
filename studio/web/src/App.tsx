import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import LogPage from './pages/Log'
import ProjectsPage from './pages/Projects'
import QueuePage from './pages/Queue'
import MonitorPage from './pages/tools/Monitor'
import PresetsPage from './pages/tools/Presets'
import SettingsPage from './pages/tools/Settings'

export default function App() {
  return (
    <BrowserRouter basename="/studio">
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 px-8 py-6 overflow-auto h-screen">
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/queue/:id/log" element={<LogPage />} />
            <Route path="/tools/presets" element={<PresetsPage />} />
            <Route path="/tools/monitor" element={<MonitorPage />} />
            <Route path="/tools/settings" element={<SettingsPage />} />
            {/* 旧 → 新 路由兼容（PP0 重构）。下个 minor 版本删除。 */}
            <Route
              path="/configs"
              element={<Navigate to="/tools/presets" replace />}
            />
            <Route
              path="/monitor"
              element={<Navigate to="/tools/monitor" replace />}
            />
            <Route path="/datasets" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
