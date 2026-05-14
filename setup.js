#!/usr/bin/env node
/**
 * 初回セットアップ: DistroKidにGoogleでログインしてセッションを保存
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
  console.log('====== DistroKid セットアップ ======');
  console.log('Googleアカウントでログインしてセッションを保存します。\n');

  for (const dir of [config.watchDir, config.doneDir, config.failedDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 永続プロファイルフォルダ（ここにChromeのセッションが保存される）
  const profileDir = path.join(__dirname, 'chrome-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  // --enable-automation を除去してChromeを起動（Googleのbot検知を回避）
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
  });

  const page = await context.newPage();

  // navigator.webdriver を隠す
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('Chromeを開いています...\n');
  await page.goto('https://distrokid.com/vip/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // すでにログイン済みか確認
  const alreadyLoggedIn = !page.url().includes('vip') ||
    await page.locator('a[href*="upload"], a[href*="bank"], .logged-in').isVisible({ timeout: 3000 }).catch(() => false);

  if (alreadyLoggedIn) {
    console.log('すでにログイン済みです。');
  } else {
    // Googleログインボタンを探してクリック
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

    console.log('================================================');
    console.log('  Chromeが開きました。');
    console.log('  Googleアカウントでログインしてください。');
    console.log('  DistroKidのダッシュボードが表示されたら');
    console.log('  このターミナルで Enter を押してください。');
    console.log('================================================\n');

    await waitForEnter('ログイン完了後 → Enter: ');
  }

  // セッションをJSONで保存（register.jsが使用）
  await context.storageState({ path: config.sessionFile });
  console.log(`\n✅ セッション保存: ${config.sessionFile}`);

  await context.close();

  console.log('\n====== セットアップ完了 ======');
  console.log('監視デーモンを再起動してください:');
  console.log('  launchctl unload ~/Library/LaunchAgents/com.distrokid.autowatcher.plist');
  console.log('  launchctl load   ~/Library/LaunchAgents/com.distrokid.autowatcher.plist');
}

main().catch(err => {
  console.error('エラー:', err.message);
  process.exit(1);
});
