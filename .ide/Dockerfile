# AnimaLoraStudio — Docker image
# Built automatically via .github/workflows/build-docker.yml
# Published to: ghcr.io/<owner>/<repo>:latest

FROM nvidia/cuda:12.9.0-cudnn-devel-ubuntu24.04

ENV TZ=Asia/Shanghai
ENV DEBIAN_FRONTEND=noninteractive
ENV PIP_NO_CACHE_DIR=1

EXPOSE 8765

# 1. 系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3-tk \
        git-lfs \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        python3-venv \
        python3 \
        python-is-python3 \
        python3-pip \
        zip \
        unzip \
        wget \
        curl \
        git \
        python3-dev \
        build-essential \
        ninja-build \
        ca-certificates \
        gnupg \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# 3. Git LFS
RUN git lfs install --system

# 4. 预建虚拟环境（studio.sh 启动时优先使用 /opt/venv）
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 5. PyTorch（cu128 匹配 CUDA 12.9）
RUN pip install --no-cache-dir \
        torch \
        torchvision \
        --index-url https://download.pytorch.org/whl/cu128

# 6. Python 依赖
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# 7. 预缓存前端 node_modules（避免容器首次启动时重跑 npm install）
COPY studio/web/package*.json /opt/studio-web/
RUN cd /opt/studio-web && npm ci

WORKDIR /workspace
