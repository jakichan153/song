#!/bin/bash
# Mac起動時に自動スタートするlaunchd設定を行います

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.distrokid.autowatcher"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$SCRIPT_DIR/logs"
NODE_PATH="$(which node)"

mkdir -p "$LOG_DIR"

echo "====== launchd セットアップ ======"
echo "スクリプトフォルダ: $SCRIPT_DIR"
echo "Node.js: $NODE_PATH"
echo ""

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${NODE_PATH}</string>
    <string>${SCRIPT_DIR}/watcher.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/watcher-stdout.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/watcher-stderr.log</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_PATH")</string>
  </dict>
</dict>
</plist>
EOF

# 既存のサービスを停止してから再起動
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "✅ launchd に登録しました: $PLIST_PATH"
echo ""
echo "コマンド一覧:"
echo "  停止:  launchctl unload ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo "  起動:  launchctl load   ~/Library/LaunchAgents/${PLIST_NAME}.plist"
echo "  状態:  launchctl list | grep distrokid"
echo "  ログ:  tail -f $LOG_DIR/watcher.log"
