#!/bin/bash
# Mac上でDistroKid曲登録を実行するスクリプト

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Node.jsの確認
if ! command -v node &>/dev/null; then
  echo "❌ Node.js がインストールされていません。"
  echo "   https://nodejs.org からインストールしてください。"
  exit 1
fi

# 依存関係のインストール
if [ ! -d node_modules ]; then
  echo "📦 依存関係をインストール中..."
  npm install
fi

# Playwrightブラウザのインストール
if ! npx playwright --version &>/dev/null 2>&1; then
  echo "🌐 Playwrightブラウザをインストール中..."
  npx playwright install chromium
fi

# ファイルパスの設定
AUDIO_DIR="/Users/mai_goto/Distrokid/Just for me"

# WAVとPNGファイルを自動検出
AUDIO_FILE=$(find "$AUDIO_DIR" -name "*.wav" 2>/dev/null | head -1)
COVER_FILE=$(find "$AUDIO_DIR" -name "*.png" 2>/dev/null | head -1)

if [ -z "$AUDIO_FILE" ]; then
  echo "❌ WAVファイルが見つかりません: $AUDIO_DIR"
  exit 1
fi
if [ -z "$COVER_FILE" ]; then
  echo "❌ PNGファイルが見つかりません: $AUDIO_DIR"
  exit 1
fi

echo "✅ 音声ファイル: $AUDIO_FILE"
echo "✅ カバーアート: $COVER_FILE"
echo ""

# 実行
node distrokid.js \
  --title "Just for me" \
  --artist "${ARTIST_NAME:-Mai}" \
  --audio "$AUDIO_FILE" \
  --cover "$COVER_FILE" \
  --genre "Pop" \
  --language "Japanese"
