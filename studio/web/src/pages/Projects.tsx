// 占位：PP1 才会真正实现 Project 列表与建项流程。
// PP0 这里只是把根路由从「监控」让给「项目」入口，让侧栏分组生效。
export default function ProjectsPage() {
  return (
    <div className="max-w-2xl mx-auto mt-12 text-center space-y-4">
      <h1 className="text-2xl font-semibold text-slate-100">项目</h1>
      <p className="text-slate-400">
        Pipeline 流水线（项目 → 下载 → 筛选 → 打标 → 正则集 → 训练）将在 PP1 接入。
      </p>
      <p className="text-slate-500 text-sm">
        在此之前，可以从左侧「工具」菜单进入：
        <br />
        <span className="text-slate-300">预设</span>（编辑训练配置）·
        <span className="text-slate-300"> 监控</span>（看正在跑的任务）·
        <span className="text-slate-300"> 设置</span>（API key / 服务端点）·
        <span className="text-slate-300"> 队列</span>（任务调度）。
      </p>
    </div>
  )
}
