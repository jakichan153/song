#!/usr/bin/env node
/**
 * 初回セットアップ: DistroKidにGoogleでログインしてセッションを保存
 * 一度だけ実行すれば、以降は自動登録が全自動で動きます
 *
 * 実行: node setup.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config.json');

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  console.log('====== DistroKid 初回セットアップ ======');
  console.log('Googleアカウントでログインしてセッションを保存します。');
  console.log('これは一度だけ実行すれば OK です。\n');

  // フォルダ作成
  for (const dir of [config.watchDir, config.doneDir, config.failedDir, path.dirname(config.logFile)]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // システムのChromeを使う（GoogleがPlaywright Chromiumをブロックするため）
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
  });

  const page = await context.newPage();

  console.log('ブラウザを開いています...\n');
  await page.goto('https://distrokid.com/vip/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Googleログインボタンを探す
  const googleSelectors = [
    'a[href*="google"]',
    'button:has-text("Google")',
    'a:has-text("Google")',
    'a:has-text("Continue with Google")',
    'a:has-text("Sign in with Google")',
  ];
  for (const sel of googleSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      break;
    }
  }

  console.log('=================================================');
  console.log('  ブラウザが開きました。');
  console.log('  Googleアカウントでログインしてください。');
  console.log('  DistroKidのホーム画面が表示されたら');
  console.log('  このターミナルで Enter を押してください。');
  console.log('=================================================\n');

  await waitForEnter('ログイン完了後 → Enter: ');

  // セッション保存
  await context.storageState({ path: config.sessionFile });
  console.log(`\n✅ セッションを保存しました: ${config.sessionFile}`);

  await browser.close();

  console.log('\n====== セットアップ完了 ======');
  console.log('次のコマンドで自動監視を開始できます:');
  console.log('  node watcher.js');
  console.log('\nMac起動時に自動スタートするには:');
  console.log('  ./install-launchd.sh');
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
