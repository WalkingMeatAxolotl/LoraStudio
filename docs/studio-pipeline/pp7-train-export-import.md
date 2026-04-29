# PP7 — 训练集导出 / 导入

**状态**：✅ 已完成（代码就绪，等手测后 commit）
**前置依赖**：PP1（projects/versions 数据模型）、PP4（train/ + caption .txt）
**收尾环节**：解决「云上 Studio 项目易丢失」的痛点 —— 把已花费大量人力的「打标后训练集」从一台 Studio 实例搬到另一台

## 背景

云上 Studio 实例（RunPod 之类）会因镜像被回收 / 实例被销毁而丢失项目数据。
最终的 LoRA `.safetensors` 已经能从 Queue 详情页一键下载，**真正怕丢的是「打标后的 train/」** —— 用户在 ④ 标签编辑那一步往往要花数小时手工调 caption。

PP7 加一个最小闭环：

- ⬇️ 在版本 tab 旁加「导出训练集」 → 流式 zip 下载到本地
- ⬆️ 在项目列表页加「导入训练集」 → 上传 zip → 自动建新项目 + v1，stage 落到 `tagging`，用户可继续 ⑤/⑥

## 范围

**只导出 `train/` 一档**（含未打标的图）。不带 download/、reg/、samples/、output/、monitor_state、config.yaml、DB 历史 jobs/tasks。
- `output/*.safetensors` 已有 `/api/queue/{id}/outputs.zip` 端点，本 PP **不动**
- reg/ 由打标后的 train/ 决定可重生，不带
- config.yaml 跨机器复用价值低（base model / output_dir 等绝对路径都得重写），新项目让用户自己派 preset

## zip 结构

```
{slug}-{label}.train.zip
├── manifest.json
└── train/
    └── {N}_data/         # 原样保留 N（multi-concept 项目时数字有意义）
        ├── *.png/*.jpg/*.webp/...
        └── *.txt         # 可选；缺失算 untagged
```

**manifest.json**：
```json
{
  "schema_version": 1,
  "exported_at": 1777xxx,
  "source": {
    "title": "Cosmic Kaguya",
    "version_label": "v1",
    "slug": "cosmic-kaguya"
  },
  "stats": {
    "image_count": 50,
    "tagged_count": 48,
    "untagged_count": 2,
    "concepts": [{ "folder": "1_data", "image_count": 50 }]
  }
}
```

## 导入语义

- slug = `slugify(manifest.source.title)`，冲突 → 自动加 `-imported-{ts}` 后缀（ts 取秒级 epoch）
- 新建 project，`stage='tagging'`、`note='imported from {original_title}'`
- 新建 version `v1`，`stage='tagging'`、`config_name=None`
- 解压到 `versions/v1/train/{N}_data/`，目录名照搬 manifest 里的
- `download/` 不创建任何文件（保留空目录）
- 返回新建的 project_id，前端跳转到 `/projects/{id}`

## 设计决定

| # | 决定 | 备注 |
|---|---|---|
| 1 | 只导当前 active version | 多 version 用户切 active 后再导 |
| 2 | 带未打标的图 | 用户也许只想搬图回去再打标；manifest 里标 `untagged_count` |
| 3 | `{N}_data` 目录名原样保留 | multi-concept 时数字有意义；导入也照搬 |
| 4 | 一次性 PP（不切 sub-PP） | 范围小，service+HTTP+UI 单 commit |
| 5 | zip 用 `ZIP_STORED`（不压缩） | PNG 已压缩态，再压浪费 CPU；与 `outputs.zip` 一致 |
| 6 | 后端走 tempfile + `BackgroundTasks` 清理 | 复用 `outputs.zip` 模式 |
| 7 | 前端 fetch+blob 触发下载 | 而不是 `<a download>` 直链；这样能显示 loading 状态（后端打 zip 几秒到几十秒不等） |
| 8 | 同步把 QueueDetail 的 outputs.zip 也切到 fetch+blob | 复用 download 帮手；统一交互 |
| 9 | zip slip 防护：拒绝绝对路径 / `..` / 非 `train/` 前缀 | 标准防御 |
| 10 | 不带 DB rows（jobs/tasks 历史） | pid/log_path 跨机器无意义；新项目即可 |

## 实施清单

### 服务层 `studio/services/train_io.py`（新）

```python
def export_train(
    conn: sqlite3.Connection, version_id: int, dest: Path
) -> dict[str, Any]:
    """打包 version 的 train/ + manifest.json 到 dest（zip 文件路径）。

    返回 {"manifest": {...}, "size_bytes": int}。
    dest 父目录必须已存在；写入用 ZIP_STORED。
    """

def import_train(
    conn: sqlite3.Connection, zip_path: Path
) -> dict[str, Any]:
    """从 zip 解出新建 project + v1，返回 {project, version, stats}。

    冲突时 slug 自动加 -imported-{ts} 后缀。
    zip slip 防护：拒绝绝对路径 / .. / 非 train/ 前缀。
    """
```

### HTTP 端点（加到 `studio/server.py`）

- `GET /api/projects/{pid}/versions/{vid}/train.zip` — 同步打 zip 到 tempfile + `BackgroundTasks` 清理 + `FileResponse`
- `POST /api/projects/import-train` (multipart `file=`) — 接收上传，转 service，回 `{project_id, project, stats}`

### 前端

1. `api/client.ts`：
   - 新增 `downloadBlob(url, filename)` 帮手 — fetch + blob + temp `<a>` 触发下载（让调用方用 `setLoading` 包起来）
   - 新增 `versionTrainZipUrl(pid, vid)` / `importTrainProject(formData)`
   - 把 `taskOutputsZipUrl` 的调用方迁移到 `downloadBlob`（统一 loading）
2. `pages/project/Layout.tsx`：在 sidebar 的 VersionTabs 下方加一行操作条：「⬇️ 导出训练集」按钮带 loading 状态
3. `pages/Projects.tsx`：header 右侧加「⬆️ 导入训练集」按钮 → 隐藏 file input → 上传 → loading → 跳新项目
4. `pages/QueueDetail.tsx`：「⤓ 全量 zip」改 onClick 调 `downloadBlob` + loading

## 验收手测剧本

1. 项目 A（已打标 v1）→ 点「导出训练集」→ 浏览器收到 `{slug}-v1.train.zip`
2. 在另一台机器（或同台清空后）项目列表 → 点「导入训练集」→ 选上面的 zip
3. 跳到新项目页，stage = tagging；④ 标签编辑能看到全部图 + caption
4. 边界：
   - 空 train/ 应报错「无可导出文件」
   - zip slip 文件应被拒绝（手工伪造一个测试）
   - slug 冲突时自动后缀
   - 导出过程中页面按钮显示「打包中...」
