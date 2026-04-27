# AnimaStudio

训练监控、配置编辑与任务队列的 Web 面板。后端 FastAPI + SQLite，前端 React + Vite。

## 目录结构

```
studio/
├── server.py        # FastAPI 守护进程入口
├── paths.py         # 路径常量
├── web/             # React + Vite 前端源码
│   ├── package.json
│   ├── src/
│   └── dist/        # npm run build 产物（被 server.py 挂在 /studio）
└── README.md
```

运行时数据写到仓库根目录下的 `studio_data/`（SQLite + 用户保存的 config + 任务日志），已加入 `.gitignore`。

## 启动

### 后端守护进程

```bash
# 依赖已在 requirements.txt（fastapi / uvicorn / pydantic / pyyaml）
python -m studio.server
# → http://127.0.0.1:8765
```

参数：

```bash
python -m studio.server --host 0.0.0.0 --port 8765 --reload
```

### 前端

开发模式（热重载）：

```bash
cd studio/web
npm install            # 首次
npm run dev            # → http://127.0.0.1:5173/studio/
```

Vite dev server 会把 `/api`、`/samples` 反代到后端。

生产构建（产物给后端挂在 `/studio`）：

```bash
cd studio/web
npm run build          # 输出到 studio/web/dist/
# 后端不用重启，刷新浏览器即可（服务端启动时检测 dist/ 是否存在）
```

## 当前阶段（P1）

- [x] FastAPI 骨架（`/api/health`、`/api/state`、`/samples/{name}`）
- [x] 旧监控页保留在 `/`
- [x] React 工程骨架（Vite + TS + Tailwind）
- [x] 训练侧 `--no-monitor` 已可用，使用 Studio 时跑训练加这个 flag

## 后续阶段

- **P2** 配置 schema + CRUD（`anima_train.py` 的 argparse 改用同一份 schema 自动生成）
- **P3** 任务队列 + supervisor + SSE
- **P4** 数据集浏览 + JSON 导入导出
- **P5** 一键启动脚本、字段说明 tooltip、错误提示

详见仓库根的 plan。
