# hf-mirror.com 复查清单（0.8.2 hotfix 遗留）

**创建于** 2026-05-17
**触发版本** 0.8.2 hotfix
**当前状态** 🔴 hf-mirror.com 在所有已测 `huggingface_hub` 版本（0.25 / 0.30 / 0.34 / 1.14）下下载均失败。preset 已从 UI 隐藏，默认 endpoint 已切回 HF 官方源。

---

## 现象

UI / CLI 走 `huggingface_hub.hf_hub_download(endpoint="https://hf-mirror.com")` 时全部失败：

```
huggingface_hub.errors.FileMetadataError:
  Distant resource does not seem to be on huggingface.co.
  It is possible that a configuration issue prevents you from downloading
  resources from https://huggingface.co. Please check your firewall and proxy
  settings and make sure your SSL certificates are updated.
```

库内部逻辑：HEAD 响应里 `X-Repo-Commit` 拿不到 → `commit_hash is None` → 抛上面这个错（见 `huggingface_hub/file_download.py:_get_metadata_or_catch_error`）。

## 根因（截至 2026-05-17 已确定）

- **不是上游回归**：0.25.2（requests 时代）也同样挂，所以**不是** httpx 切换 / 跨域 redirect 不跟随的问题。
- **是 hf-mirror 服务端的改动**：curl 跟 redirect 拿 bytes 完全 OK（200，字节数对），但 `huggingface_hub` 读不出 `commit_hash`。说明响应链里某一跳的 header 跟 hub 期望的对不上 —— 怀疑是 hf-mirror 308 跳回 huggingface.co 的中间响应不带 hub 校验所需的 header。
- 上游 PR [`huggingface/huggingface_hub#4071`](https://github.com/huggingface/huggingface_hub/pull/4071)（JFrog 工程师 2026-04 提的）添加 opt-in 的 cross-domain HEAD redirect follow，**未合并**。即便合了也是 opt-in（需 env `HF_HUB_ALLOWED_HEAD_REDIRECT_HOSTS`），单纯升级 hub **不会自动修好** hf-mirror。

## 复测命令（每次复查跑这个）

在主 venv 里跑：

```powershell
$py = "G:\AnimaLoraStudio\venv\Scripts\python.exe"
$code = @"
import time
from pathlib import Path
from huggingface_hub import hf_hub_download
for ep in ['https://hf-mirror.com', 'https://huggingface.co']:
    t0 = time.time()
    try:
        p = hf_hub_download(repo_id='google/t5-v1_1-xxl',
                            filename='tokenizer_config.json',
                            endpoint=ep, force_download=True)
        print(f'[OK  {(time.time()-t0)*1000:.0f}ms] {ep}  size={Path(p).stat().st_size}')
    except Exception as e:
        print(f'[ERR {(time.time()-t0)*1000:.0f}ms] {ep}  {type(e).__name__}: {str(e)[:120]}')
"@
& $py -c $code
```

**判定**：hf-mirror 行打印 `[OK ...]` 且字节数 = 1857 → 服务复活；仍 `[ERR ...]` → 继续等。

附 curl 对比探针（确认是 hub 客户端问题还是 mirror 服务真挂）：

```powershell
foreach ($u in @(
  'https://hf-mirror.com/google/t5-v1_1-xxl/resolve/main/tokenizer_config.json',
  'https://huggingface.co/google/t5-v1_1-xxl/resolve/main/tokenizer_config.json'
)) {
  & curl.exe -sSL -o NUL -w "HTTP %{http_code} | size=%{size_download} | redirects=%{num_redirects}`n" $u
}
```

两边都 `HTTP 200 | size=1857` = mirror 服务本身活着，问题在 hub 客户端 ↔ mirror 的元数据兼容。

## 复活后该恢复哪些位置

如果上面探针 hf-mirror 也 `[OK]` 了，按这个清单回滚 hotfix：

1. **`studio/secrets.py`** — `HuggingFaceConfig.endpoint` 默认值视情况：
   - 国内用户仍占主导 → 改回 `"https://hf-mirror.com"`
   - 项目重心已转海外（看 README / 监控）→ 保留 `""`
2. **`studio/web/src/pages/tools/Settings.tsx`** — `HF_ENDPOINT_PRESETS` 加回 `{ value: 'https://hf-mirror.com', label: 'hf-mirror.com', hint: '国内推荐（社区维护反代）' }`，与默认值同步调整顶部 hint
3. **`studio/web/src/pages/tools/Settings.tsx`** — `helpTooltip` 文案恢复"国内推荐 hf-mirror，海外推荐官方源"风格
4. **`studio/web/src/pages/tools/Settings.test.tsx`** — `initialServerState.huggingface.endpoint` mock 视默认值变更同步
5. **`README.md`** — 「2. 在 Studio 里下载模型」段恢复 hf-mirror 描述（原文见 git log），删除 0.8.2 hotfix 警示段
6. **`docs/architecture/studio-pipeline.md`** — `secrets.jsonc` 示例 endpoint 改回 `"https://hf-mirror.com"`（如果默认值复原），删 hotfix 注释
7. **`tools/download_models.py`** — epilog 文本恢复"首装是 hf-mirror.com"，删 0.8.2 注
8. **本文件** — 移到 `docs/todo/archive/` 或直接删，CHANGELOG 加 entry 说明恢复

## 推荐复查节奏

- **2 周一次**（2026-05-31 / 2026-06-14 / 2026-06-28 ...）跑上面的复测命令
- **触发性复查**：上游 PR #4071 合并并发版（订阅 GitHub 通知）时，单独评估 `HF_HUB_ALLOWED_HEAD_REDIRECT_HOSTS` env 是否能就地修好
- **3 个月仍不通**（2026-08-17 后）认真考虑 hf-mirror 是否要长期 deprecate，preset 即便可恢复也不再列为推荐源

## 上游 / 社区跟踪点

- [`huggingface/huggingface_hub` PR #4071](https://github.com/huggingface/huggingface_hub/pull/4071) — cross-domain HEAD redirect opt-in（open，2026-04）
- [hf-mirror.com](https://hf-mirror.com/) — 主页若有公告 / 维护说明会写在这里
- 没有发现 hf-mirror 维护方的 GitHub / 邮件渠道；只能被动等。
