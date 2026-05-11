from __future__ import annotations

from studio.schema import TrainingConfig


def test_schema_accepts_lucid_and_keeps_stylek_alias() -> None:
    lucid = TrainingConfig.model_validate({"lora_type": "lucid"})
    stylek = TrainingConfig.model_validate({"lora_type": "stylek"})

    assert lucid.lora_type == "lucid"
    assert stylek.lora_type == "stylek"
    assert lucid.lucid_min_rank_ratio == 0.1
    assert lucid.lucid_lora_plus_ratio == 16.0


def test_lucid_schema_carries_advanced_ui_metadata() -> None:
    schema = TrainingConfig.model_json_schema()
    props = schema["properties"]

    assert props["lucid_min_rank_ratio"]["ui_level"] == "basic"
    assert props["lucid_qk_rank_ratio"]["ui_level"] == "advanced"
    assert props["lucid_qk_rank_ratio"]["show_when"] == "lora_type==lucid"
    assert props["lora_type"]["deprecated_options"] == {"stylek": "已由 LucidLoRA 取代"}
    assert props["stylek_min_rank"]["deprecated"] is True
