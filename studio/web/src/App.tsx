import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import ConfigsPage from './pages/Configs'
import LogPage from './pages/Log'
import MonitorPage from './pages/Monitor'
import Placeholder from './pages/Placeholder'
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
            <Route
              path="/datasets"
              element={
                <Placeholder
                  title="数据集"
                  phase="P4"
                  description="P4 阶段会扫描 dataset/ 目录，按 Kohya 风格 N_xxx 子目录显示样本数、caption 类型分布、缩略图。"
                />
              }
            />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
