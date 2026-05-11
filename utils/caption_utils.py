"""
Caption 处理工具
- 读取 JSON 标签文件
- 标准化格式
- 分类 shuffle
"""
import json
import random
from pathlib import Path
from typing import Optional


def load_caption_json(json_path: Path) -> dict | None:
    """读取 JSON 标签文件"""
    if not json_path.exists():
        return None
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def normalize_caption_json(raw_json: dict) -> dict:
    """
    将 batch_tag.py 生成的 JSON 转换为标准格式
    
    标准格式按 Anima 官方顺序:
    quality → count → character → series → artist → appearance → tags → environment → nl
    """
    # 提取各部分
    fixed = raw_json.get("fixed", {})
    character_info = raw_json.get("character", {})
    character_text = ""
    if isinstance(character_info, dict):
        character_text = character_info.get(
            "full",
            ", ".join(
                t for t in (
                    character_info.get("name", ""),
                    character_info.get("variant", ""),
                ) if t
            ),
        )
    else:
        character_text = str(character_info or "")
    from_path = raw_json.get("from_path", {})
    ai_output = raw_json.get("ai_output", {})
    
    # 解析 quality（可能是 "newest, safe" 字符串）；简化格式允许顶层字段
    quality_str = fixed.get("quality", raw_json.get("quality", "newest, safe"))
    if isinstance(quality_str, str):
        quality = [t.strip() for t in quality_str.split(",") if t.strip()]
    else:
        quality = list(quality_str)
    
    # 合并 appearance（AI + from_path）
    appearance = []
    ai_appearance = ai_output.get("appearance", raw_json.get("appearance", []))
    if isinstance(ai_appearance, list):
        appearance.extend(ai_appearance)
    elif isinstance(ai_appearance, str):
        appearance.extend([t.strip() for t in ai_appearance.split(",") if t.strip()])
    appearance.extend(from_path.get("appearance", []))
    appearance.extend(from_path.get("extra_appearance", []))
    
    # 合并 tags（AI + from_path）
    tags = []
    ai_tags = ai_output.get("tags", raw_json.get("tags", []))
    if isinstance(ai_tags, list):
        tags.extend(ai_tags)
    elif isinstance(ai_tags, str):
        tags.extend([t.strip() for t in ai_tags.split(",") if t.strip()])
    tags.extend(from_path.get("tags", []))
    tags.extend(from_path.get("extra_tags", []))
    
    # environment
    environment = []
    ai_env = ai_output.get("environment", raw_json.get("environment", []))
    if isinstance(ai_env, list):
        environment.extend(ai_env)
    elif isinstance(ai_env, str):
        environment.extend([t.strip() for t in ai_env.split(",") if t.strip()])
    
    # 构建标准格式
    return {
        "meta": {
            "path": raw_json.get("path", ""),
            "source_path_parts": raw_json.get("path_parts", []),
        },
        "tags": {
            "quality": quality,                           # ["newest", "safe"]
            "count": ai_output.get("count", raw_json.get("count", "")),  # "1girl"
            "character": character_text,                  # "asahi sakayori"
            "series": fixed.get("series", raw_json.get("series", "")),  # "cosmic princess kaguya"
            "artist": fixed.get("artist", raw_json.get("artist", "")),  # "@spacetime kaguya"
            "appearance": appearance,                     # [...]
            "tags": tags,                                 # [...]
            "environment": environment,                   # [...]
            "nl": ai_output.get("nl", raw_json.get("nl", "")),  # "A boy..."
        }
    }


def dedupe_list(tags: list) -> list:
    """去重，保持顺序"""
    seen = set()
    result = []
    for tag in tags:
        tag_lower = tag.lower().strip()
        if tag_lower and tag_lower not in seen:
            seen.add(tag_lower)
            result.append(tag.strip())
    return result


def build_caption_from_json(
    json_data: dict,
    shuffle_appearance: bool = True,
    shuffle_tags: bool = True,
    shuffle_environment: bool = True,
    tag_dropout: float = 0.0,
) -> str:
    """
    从标准化 JSON 构建 caption
    
    Args:
        json_data: 标准化的 JSON 数据
        shuffle_appearance: 是否打乱 appearance 内部
        shuffle_tags: 是否打乱 tags 内部
        shuffle_environment: 是否打乱 environment 内部
        tag_dropout: 对 appearance/tags/environment 的丢弃概率 (0-1)
    
    Returns:
        最终的 caption 字符串
    """
    tags_dict = json_data.get("tags", {})
    
    # 固定部分（不打乱、不 dropout）
    parts = []
    
    # 1. quality
    quality = tags_dict.get("quality", [])
    if quality:
        parts.extend(quality)
    
    # 2. count
    count = tags_dict.get("count", "")
    if count:
        parts.append(count)
    
    # 3. character
    character = tags_dict.get("character", "")
    if character:
        parts.append(character)
    
    # 4. series
    series = tags_dict.get("series", "")
    if series:
        parts.append(series)
    
    # 5. artist
    artist = tags_dict.get("artist", "")
    if artist:
        parts.append(artist)
    
    # 可变部分（可打乱、可 dropout）
    def process_tag_list(tag_list: list, shuffle: bool, dropout: float) -> list:
        """处理标签列表：打乱 + dropout"""
        if not tag_list:
            return []
        
        result = list(tag_list)  # 复制
        
        # 打乱
        if shuffle:
            random.shuffle(result)
        
        # Dropout
        if dropout > 0:
            result = [t for t in result if random.random() > dropout]
            # 确保至少保留一个
            if not result and tag_list:
                result = [random.choice(tag_list)]
        
        return result
    
    # 6. appearance
    appearance = tags_dict.get("appearance", [])
    parts.extend(process_tag_list(appearance, shuffle_appearance, tag_dropout))
    
    # 7. tags
    tags = tags_dict.get("tags", [])
    parts.extend(process_tag_list(tags, shuffle_tags, tag_dropout))
    
    # 8. environment
    environment = tags_dict.get("environment", [])
    parts.extend(process_tag_list(environment, shuffle_environment, tag_dropout))
    
    # 去重
    parts = dedupe_list(parts)
    
    # 构建 caption
    caption = ", ".join(parts)
    
    # 9. nl（自然语言描述）
    nl = tags_dict.get("nl", "")
    if nl:
        caption = f"{caption}. {nl}"
    
    return caption


def load_and_build_caption(
    json_path: Path,
    shuffle: bool = True,
    tag_dropout: float = 0.0,
) -> str | None:
    """
    便捷函数：从 JSON 文件加载并构建 caption
    
    Args:
        json_path: JSON 文件路径
        shuffle: 是否分类打乱
        tag_dropout: dropout 概率
    
    Returns:
        caption 字符串，或 None（如果读取失败）
    """
    raw_json = load_caption_json(json_path)
    if raw_json is None:
        return None
    
    # 检查是否已经是标准格式
    if "tags" in raw_json and "meta" in raw_json:
        normalized = raw_json
    else:
        normalized = normalize_caption_json(raw_json)
    
    return build_caption_from_json(
        normalized,
        shuffle_appearance=shuffle,
        shuffle_tags=shuffle,
        shuffle_environment=shuffle,
        tag_dropout=tag_dropout,
    )


# ============================================================================
# 批量转换工具
# ============================================================================

def convert_json_to_standard(input_path: Path, output_path: Path = None) -> dict:
    """
    将单个 JSON 文件转换为标准格式
    
    Args:
        input_path: 输入 JSON 路径
        output_path: 输出路径（可选，默认覆盖原文件）
    
    Returns:
        标准化的 JSON 数据
    """
    raw_json = load_caption_json(input_path)
    if raw_json is None:
        raise ValueError(f"Cannot load JSON: {input_path}")
    
    normalized = normalize_caption_json(raw_json)
    
    if output_path is None:
        output_path = input_path
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
    
    return normalized


def batch_convert_json(
    data_dir: Path,
    in_place: bool = True,
    output_suffix: str = "_std",
) -> int:
    """
    批量转换目录下所有 JSON 文件为标准格式
    
    Args:
        data_dir: 数据目录
        in_place: 是否原地覆盖
        output_suffix: 非原地模式下的输出后缀
    
    Returns:
        转换的文件数量
    """
    count = 0
    for json_path in data_dir.rglob("*.json"):
        try:
            raw_json = load_caption_json(json_path)
            if raw_json is None:
                continue
            
            # 跳过已经是标准格式的
            if "tags" in raw_json and "meta" in raw_json:
                continue
            
            normalized = normalize_caption_json(raw_json)
            
            if in_place:
                output_path = json_path
            else:
                output_path = json_path.with_stem(json_path.stem + output_suffix)
            
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(normalized, f, ensure_ascii=False, indent=2)
            
            count += 1
        except Exception as e:
            print(f"Error converting {json_path}: {e}")
    
    return count


# ============================================================================
# CLI
# ============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Caption JSON 工具")
    parser.add_argument("action", choices=["convert", "test"], help="操作类型")
    parser.add_argument("--dir", type=str, help="数据目录")
    parser.add_argument("--file", type=str, help="单个文件")
    parser.add_argument("--in-place", action="store_true", help="原地覆盖")
    args = parser.parse_args()
    
    if args.action == "convert":
        if args.file:
            result = convert_json_to_standard(Path(args.file))
            print(json.dumps(result, ensure_ascii=False, indent=2))
        elif args.dir:
            count = batch_convert_json(Path(args.dir), in_place=args.in_place)
            print(f"Converted {count} files")
        else:
            print("Please specify --dir or --file")
    
    elif args.action == "test":
        if args.file:
            caption = load_and_build_caption(Path(args.file), shuffle=True)
            print(caption)
        else:
            print("Please specify --file")
