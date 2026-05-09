"""schema.attention_backend 字段 + migrate_legacy_attention 兼容性回归。

覆盖 schema layer + scripts cfg 加载层共用的 migration helper：
  - 老 cfg（xformers/flash_attn 双 bool）能映射成 attention_backend
  - 新 cfg（attention_backend）直接通过
  - 同时存在 → 优先 attention_backend，剥老字段
"""
from __future__ import annotations

import pytest

from studio.schema import (
    AttentionBackend,  # noqa: F401  re-export 烟雾测试
    GenerateConfig,
    RegAiConfig,
    TrainingConfig,
    migrate_legacy_attention,
)


# ---------------------------------------------------------------------------
# migrate_legacy_attention（dict 层 helper）
# ---------------------------------------------------------------------------


def test_migrate_legacy_xformers_true() -> None:
    """xformers=True 映射成 attention_backend="xformers"，剥老字段。"""
    out = migrate_legacy_attention({"xformers": True, "flash_attn": False})
    assert out == {"attention_backend": "xformers"}


def test_migrate_legacy_xformers_overrides_flash_attn() -> None:
    """xformers=True 优先于 flash_attn=True（与原 use_flash 优先级一致）。"""
    out = migrate_legacy_attention({"xformers": True, "flash_attn": True})
    assert out["attention_backend"] == "xformers"


def test_migrate_legacy_flash_attn_only() -> None:
    out = migrate_legacy_attention({"xformers": False, "flash_attn": True})
    assert out["attention_backend"] == "flash_attn"


def test_migrate_legacy_both_false() -> None:
    """xformers=False, flash_attn=False → "none"（用户主动关掉所有加速）。"""
    out = migrate_legacy_attention({"xformers": False, "flash_attn": False})
    assert out["attention_backend"] == "none"


def test_migrate_legacy_only_xformers_field() -> None:
    """只有 xformers 字段时 flash_attn 默认 True，xformers=False → "flash_attn"。"""
    out = migrate_legacy_attention({"xformers": False})
    assert out["attention_backend"] == "flash_attn"


def test_migrate_no_legacy_no_change() -> None:
    """没有任何 attention 字段时不增加 attention_backend（让 schema default 起作用）。"""
    out = migrate_legacy_attention({"width": 1024})
    assert "attention_backend" not in out


def test_migrate_new_field_strips_legacy() -> None:
    """attention_backend 已设 → 剥老字段，新字段优先（兼容期混发场景）。"""
    out = migrate_legacy_attention({
        "attention_backend": "none",
        "xformers": True,  # 应该被忽略 + 删
        "flash_attn": True,
    })
    assert out == {"attention_backend": "none"}


def test_migrate_non_dict_passthrough() -> None:
    """非 dict 直接 return 不动（pydantic model_validator(mode='before') 兼容）。"""
    assert migrate_legacy_attention(None) is None
    assert migrate_legacy_attention("notadict") == "notadict"
    assert migrate_legacy_attention(42) == 42


def test_migrate_idempotent() -> None:
    """重复调用结果不变。"""
    once = migrate_legacy_attention({"xformers": True})
    twice = migrate_legacy_attention(dict(once))
    assert once == twice == {"attention_backend": "xformers"}


# ---------------------------------------------------------------------------
# pydantic model_validator —— schema 层走 migrate 后能正确构造
# ---------------------------------------------------------------------------


def test_generate_config_legacy_xformers() -> None:
    """老 yaml { xformers: true } → GenerateConfig.attention_backend = "xformers"。"""
    g = GenerateConfig(transformer_path="", vae_path="", text_encoder_path="",
                       xformers=True, flash_attn=False)  # type: ignore[call-arg]
    assert g.attention_backend == "xformers"


def test_generate_config_legacy_double_false() -> None:
    g = GenerateConfig(transformer_path="", vae_path="", text_encoder_path="",
                       xformers=False, flash_attn=False)  # type: ignore[call-arg]
    assert g.attention_backend == "none"


def test_generate_config_default_is_flash_attn() -> None:
    """无字段 → 默认 flash_attn（与历史 flash_attn=True 默认一致）。"""
    g = GenerateConfig(transformer_path="", vae_path="", text_encoder_path="")
    assert g.attention_backend == "flash_attn"


def test_generate_config_new_field() -> None:
    g = GenerateConfig(transformer_path="", vae_path="", text_encoder_path="",
                       attention_backend="xformers")
    assert g.attention_backend == "xformers"


def test_reg_ai_config_legacy_compatibility() -> None:
    """RegAiConfig 同样支持老字段。"""
    r = RegAiConfig(xformers=True)  # type: ignore[call-arg]
    assert r.attention_backend == "xformers"


def test_training_config_legacy_compatibility() -> None:
    """TrainingConfig 同样兼容（schema 是单一权威源）。"""
    t = TrainingConfig(xformers=True)  # type: ignore[call-arg]
    assert t.attention_backend == "xformers"


@pytest.mark.parametrize("backend", ["none", "xformers", "flash_attn"])
def test_all_backends_validate(backend: str) -> None:
    """三个枚举值都能 validate。"""
    g = GenerateConfig(transformer_path="", vae_path="", text_encoder_path="",
                       attention_backend=backend)  # type: ignore[arg-type]
    assert g.attention_backend == backend


def test_invalid_backend_rejected() -> None:
    """无效 backend → ValidationError。"""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        GenerateConfig(transformer_path="", vae_path="", text_encoder_path="",
                       attention_backend="sdpa")  # type: ignore[arg-type]
