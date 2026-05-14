#!/usr/bin/env node
/**
 * DistroKidへの曲登録処理
 * watcher.jsから呼び出されます
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');

async function register({ title, artist, genre, subgenre, language, releaseDate, audioPath, coverPath }) {
  if (!fs.existsSync(config.sessionFile)) {
    throw new Error(`セッションファイルがありません。先に node setup.js を実行してください。`);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    storageState: config.sessionFile,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
  });

  const page = await context.newPage();

  try {
    // アップロードページへ
    log(`[登録開始] "${title}" - ${artist}`);
    await page.goto('https://distrokid.com/upload/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // セッション切れチェック
    if (page.url().includes('login') || page.url().includes('vip')) {
      throw new Error('セッションが切れています。node setup.js を再実行してください。');
    }

    // Singleを選択
    await clickIfVisible(page, [
      'text=/^single$/i',
      '[data-type="single"]',
      'label:has-text("Single")',
      'button:has-text("Single")',
      'a:has-text("Single")',
    ]);
    await page.waitForTimeout(1000);

    // タイトル入力
    await fillInput(page, [
      'input[name="song_title"]',
      'input[name="title"]',
      'input[placeholder*="title" i]',
      'input[id*="title" i]',
    ], title);

    // アーティスト名
    await fillInput(page, [
      'input[name="artist_name"]',
      'input[name="artist"]',
      'input[placeholder*="artist" i]',
      'input[id*="artist" i]',
    ], artist);
    await page.waitForTimeout(600);
    // オートコンプリートが出たら閉じる
    const dropdown = page.locator('.autocomplete li, [class*="suggestion"] li').first();
    if (await dropdown.isVisible({ timeout: 1500 }).catch(() => false)) {
      await dropdown.click();
    }

    // ジャンル
    if (genre) {
      await selectOption(page, ['select[name="genre"]', 'select[id*="genre" i]'], genre);
    }
    if (subgenre) {
      await selectOption(page, ['select[name="subgenre"]', 'select[id*="subgenre" i]'], subgenre);
    }

    // 言語
    if (language) {
      await selectOption(page, ['select[name="language"]', 'select[id*="lang" i]'], language);
    }

    // リリース日
    if (releaseDate) {
      await fillInput(page, ['input[name="release_date"]', 'input[type="date"]'], releaseDate);
    }

    log(`  曲情報入力完了`);

    // 音声ファイルアップロード
    await uploadFile(page, [
      'input[type="file"][accept*="audio"]',
      'input[type="file"][name*="audio"]',
      'input[type="file"][name*="wav"]',
      'input[type="file"][name*="song"]',
    ], audioPath, '音声');

    // カバーアートアップロード
    await uploadFile(page, [
      'input[type="file"][accept*="image"]',
      'input[type="file"][name*="cover"]',
      'input[type="file"][name*="art"]',
      'input[type="file"][name*="image"]',
    ], coverPath, 'カバーアート');

    // スクリーンショット（確認用）
    const ssDir = path.join(__dirname, 'logs', 'screenshots');
    fs.mkdirSync(ssDir, { recursive: true });
    const ssPath = path.join(ssDir, `${sanitizeFilename(title)}-before-submit.png`);
    await page.screenshot({ path: ssPath, fullPage: true });
    log(`  送信前スクリーンショット: ${ssPath}`);

    // 送信
    const submitSelectors = [
      'button[type="submit"]:visible',
      'input[type="submit"]:visible',
      'button:has-text("Submit")',
      'button:has-text("Upload")',
      'button:has-text("Publish")',
      'button:has-text("送信")',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).last();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        submitted = true;
        break;
      }
    }
    if (!submitted) throw new Error('送信ボタンが見つかりませんでした');

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    const doneSs = path.join(ssDir, `${sanitizeFilename(title)}-done.png`);
    await page.screenshot({ path: doneSs, fullPage: true });
    log(`✅ 登録完了: ${finalUrl}`);

    return { success: true, url: finalUrl };

  } finally {
    await browser.close();
  }
}

async function clickIfVisible(page, selectors) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      return true;
    }
  }
  return false;
}

async function fillInput(page, selectors, value) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.clear();
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function selectOption(page, selectors, value) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.selectOption({ label: value }).catch(() =>
        el.selectOption({ value }).catch(() => {})
      );
      return true;
    }
  }
  return false;
}

async function uploadFile(page, selectors, filePath, label) {
  log(`  ${label}アップロード中: ${path.basename(filePath)}`);
  for (const sel of selectors) {
    const inputs = page.locator(sel);
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      try {
        await inputs.nth(i).setInputFiles(filePath);
        // プログレスバーが消えるまで待つ
        await page.waitForTimeout(3000);
        const progress = page.locator('.progress-bar, [class*="progress"], [class*="uploading"]').first();
        if (await progress.isVisible({ timeout: 2000 }).catch(() => false)) {
          await progress.waitFor({ state: 'hidden', timeout: 300000 });
        }
        await page.waitForTimeout(1000);
        log(`  ${label}アップロード完了`);
        return true;
      } catch {}
    }
  }
  throw new Error(`${label}のアップロードに失敗しました: ${filePath}`);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9぀-鿿＀-￯_-]/g, '_').slice(0, 50);
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  const logDir = path.dirname(path.join(__dirname, config.logFile));
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(__dirname, config.logFile), line + '\n');
}

module.exports = { register };

// 直接実行時（テスト用）
if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const cfg = require('./config.json');
  register({
    title: get('--title') || 'Test Song',
    artist: get('--artist') || cfg.defaults.artist,
    genre: get('--genre') || cfg.defaults.genre,
    language: get('--language') || cfg.defaults.language,
    releaseDate: get('--release-date') || '',
    audioPath: path.resolve(get('--audio')),
    coverPath: path.resolve(get('--cover')),
  }).catch(err => { console.error(err.message); process.exit(1); });
}
