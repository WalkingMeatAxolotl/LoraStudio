#!/usr/bin/env python
"""
验证本地模型是否可以正常加载
测试 Qwen tokenizer/model 和 T5 tokenizer
"""
import os
import sys
from pathlib import Path

# 禁用联网（验证真正离线可用）
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

def test_t5_tokenizer():
    """测试 T5 tokenizer 加载"""
    print("=" * 60)
    print("1. Testing T5 Tokenizer...")
    print("=" * 60)
    
    from transformers import T5Tokenizer
    
    t5_path = Path(__file__).parent / "models" / "t5_tokenizer"
    print(f"   Path: {t5_path}")
    
    try:
        tokenizer = T5Tokenizer.from_pretrained(str(t5_path), local_files_only=True)
        print("   [OK] T5Tokenizer loaded successfully")
        
        # 测试 tokenize
        test_text = "masterpiece, best quality, 1girl, smile"
        tokens = tokenizer(test_text, return_tensors="pt")
        print(f"   [OK] Tokenize test: input_ids shape = {tokens.input_ids.shape}")
        return True
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False


def test_qwen_tokenizer():
    """测试 Qwen tokenizer 加载"""
    print("\n" + "=" * 60)
    print("2. Testing Qwen Tokenizer...")
    print("=" * 60)
    
    from transformers import AutoTokenizer
    
    qwen_path = Path(__file__).parent / "models" / "text_encoders"
    print(f"   Path: {qwen_path}")
    
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            str(qwen_path), 
            trust_remote_code=True,
            local_files_only=True
        )
        print("   [OK] AutoTokenizer loaded successfully")
        
        # 测试 tokenize
        test_text = "masterpiece, best quality, 1girl, smile"
        tokens = tokenizer(test_text, return_tensors="pt")
        print(f"   [OK] Tokenize test: input_ids shape = {tokens.input_ids.shape}")
        return True
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False


def test_qwen_model():
    """测试 Qwen 模型加载（仅检查能否加载，不运行推理）"""
    print("\n" + "=" * 60)
    print("3. Testing Qwen Model Loading...")
    print("=" * 60)
    
    import torch
    from transformers import AutoModelForCausalLM
    
    qwen_path = Path(__file__).parent / "models" / "text_encoders"
    print(f"   Path: {qwen_path}")
    
    try:
        # 只加载到 CPU，验证文件完整性
        model = AutoModelForCausalLM.from_pretrained(
            str(qwen_path),
            torch_dtype=torch.float16,
            trust_remote_code=True,
            local_files_only=True,
            device_map="cpu",
        )
        print(f"   [OK] AutoModelForCausalLM loaded successfully")
        print(f"   [OK] Model parameters: {sum(p.numel() for p in model.parameters()):,}")
        
        # 释放内存
        del model
        return True
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False


def test_encode_workflow():
    """测试 anima_train.py 中的 encode 函数"""
    print("\n" + "=" * 60)
    print("4. Testing encode_qwen + tokenize_t5 workflow...")
    print("=" * 60)
    
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, T5Tokenizer
    
    base_path = Path(__file__).parent / "models"
    qwen_path = base_path / "text_encoders"
    t5_path = base_path / "t5_tokenizer"
    
    try:
        # 加载 tokenizers
        qwen_tokenizer = AutoTokenizer.from_pretrained(
            str(qwen_path), trust_remote_code=True, local_files_only=True
        )
        t5_tokenizer = T5Tokenizer.from_pretrained(str(t5_path), local_files_only=True)
        
        # 测试 prompt
        test_prompt = "masterpiece, best quality, newest, safe, 1girl, komazawa_noi, spacetime_kaguya, long hair, smile"
        
        # Qwen tokenize
        qwen_inputs = qwen_tokenizer(
            test_prompt, return_tensors="pt", padding=True,
            truncation=True, max_length=512
        )
        print(f"   [OK] Qwen tokenize: input_ids shape = {qwen_inputs.input_ids.shape}")
        
        # T5 tokenize
        t5_inputs = t5_tokenizer(
            test_prompt, return_tensors="pt", padding="max_length",
            truncation=True, max_length=512
        )
        print(f"   [OK] T5 tokenize: input_ids shape = {t5_inputs.input_ids.shape}")
        
        return True
    except Exception as e:
        print(f"   [FAIL] {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "#" * 60)
    print("# Anima Trainer Local Model Validation")
    print("#" * 60 + "\n")
    
    results = []
    
    # 运行测试
    results.append(("T5 Tokenizer", test_t5_tokenizer()))
    results.append(("Qwen Tokenizer", test_qwen_tokenizer()))
    results.append(("Qwen Model", test_qwen_model()))
    results.append(("Encode Workflow", test_encode_workflow()))
    
    # 汇总
    print("\n" + "=" * 60)
    print("Summary:")
    print("=" * 60)
    
    all_passed = True
    for name, passed in results:
        status = "[PASS]" if passed else "[FAIL]"
        print(f"   {status} {name}")
        if not passed:
            all_passed = False
    
    print()
    if all_passed:
        print("All tests passed! Local models are ready for training.")
        return 0
    else:
        print("Some tests failed. Please check the errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
