#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');

async function register({ title, artist, genre, subgenre, language, releaseDate, audioPath, coverPath }) {
  if (!fs.existsSync(config.sessionFile)) {
    throw new Error(`セッションファイルがありません。先に node setup.js を実行してください。`);
  }

  const ssDir = path.join(__dirname, 'logs', 'screenshots');
  fs.mkdirSync(ssDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    slowMo: 300,
  });

  const context = await browser.newContext({
    storageState: config.sessionFile,
    viewport: { width: 1280, height: 900 },
    locale: 'ja-JP',
  });

  const page = await context.newPage();

  const ss = async (name) => {
    const p = path.join(ssDir, `${sanitizeFilename(title)}-${name}.png`);
    await page.screenshot({ path: p, fullPage: true });
    log(`  📸 ${name}: ${p}`);
  };

  try {
    log(`[登録開始] "${title}" - ${artist}`);

    await page.goto('https://distrokid.com/upload/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await ss('01-upload-page');

    if (page.url().includes('login') || page.url().includes('vip')) {
      throw new Error('セッションが切れています。node setup.js を再実行してください。');
    }

    // Single を選択
    await clickIfVisible(page, [
      'text=/^single$/i',
      '[data-type="single"]',
      'label:has-text("Single")',
      'button:has-text("Single")',
      'a:has-text("Single")',
    ]);
    await page.waitForTimeout(1500);
    await ss('02-after-single-select');

    // --- 音声ファイルアップロード ---
    log(`  音声アップロード中: ${path.basename(audioPath)}`);
    const audioUploaded = await tryAllFileInputs(page, audioPath, ['audio', 'wav', 'mp3', 'flac', 'song', 'track', 'file']);
    if (!audioUploaded) {
      await ss('03-audio-upload-fail');
      throw new Error(`音声のアップロードに失敗しました: ${audioPath}`);
    }
    await page.waitForTimeout(5000);
    await ss('04-after-audio-upload');
    await waitForUploadComplete(page);
    log(`  音声アップロード完了`);

    // --- メタデータ入力 ---
    await ss('05-before-metadata');

    // 曲名
    await fillInput(page, [
      'input[name="song_title"]', 'input[name="title"]',
      'input[placeholder*="title" i]', 'input[id*="title" i]',
    ], title);

    // アーティスト名
    await fillInput(page, [
      'input[name="artist_name"]', 'input[name="artist"]',
      'input[placeholder*="artist" i]', 'input[id*="artist" i]',
    ], artist);
    await page.waitForTimeout(800);
    const dropdown = page.locator('.autocomplete li, [class*="suggestion"] li').first();
    if (await dropdown.isVisible({ timeout: 1500 }).catch(() => false)) await dropdown.click();

    // 収益化チェックボックス
    log(`  収益化チェック`);
    await checkIfUnchecked(page, [
      'input[name*="monetize" i]',
      'input[id*="monetize" i]',
      'label:has-text("Monetize") input',
      'label:has-text("収益") input',
    ]);

    // 言語
    if (language) await selectOption(page, ['select[name="language"]', 'select[id*="lang" i]'], language);

    // メインジャンル
    if (genre) await selectOption(page, ['select[name="genre"]', 'select[id*="genre" i]'], genre);

    // 第2ジャンル（サブジャンル）
    if (subgenre) await selectOption(page, ['select[name="subgenre"]', 'select[id*="subgenre" i]'], subgenre);

    // リリース日
    if (releaseDate) await fillInput(page, ['input[name="release_date"]', 'input[type="date"]'], releaseDate);

    // シンガーソングライター名（名・姓）
    log(`  シンガーソングライター名入力`);
    const d = config.defaults;
    await fillInput(page, [
      'input[name*="singer_first" i]', 'input[name*="first_name" i]',
      'input[placeholder*="first" i]', 'input[id*="first" i]',
    ], d.singerFirstName);
    await fillInput(page, [
      'input[name*="singer_last" i]', 'input[name*="last_name" i]',
      'input[placeholder*="last" i]', 'input[id*="last" i]',
    ], d.singerLastName);

    log(`  曲情報入力完了`);
    await ss('06-after-metadata');

    // --- カバーアートアップロード ---
    log(`  カバーアートアップロード中: ${path.basename(coverPath)}`);
    const coverUploaded = await tryAllFileInputs(page, coverPath, ['cover', 'art', 'image', 'photo', 'artwork', 'file']);
    if (!coverUploaded) {
      await ss('07-cover-upload-fail');
      throw new Error(`カバーアートのアップロードに失敗しました: ${coverPath}`);
    }
    await page.waitForTimeout(3000);
    await waitForUploadComplete(page);
    log(`  カバーアートアップロード完了`);
    await ss('08-after-cover-upload');

    // --- Apple Music 追加要件 ---
    log(`  Apple Music 追加要件入力`);
    await fillAppleMusicFields(page, d);
    await ss('09-after-apple-music');

    // --- 重要事項チェックボックス（全て）---
    log(`  重要事項チェック`);
    await checkAllRequiredBoxes(page);
    await ss('10-before-submit');

    // --- 送信 ---
    const submitSelectors = [
      'button[type="submit"]', 'input[type="submit"]',
      'button:has-text("Submit")', 'button:has-text("Upload")',
      'button:has-text("Publish")', 'button:has-text("送信")',
      'button:has-text("Save")',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).last();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        submitted = true;
        log(`  送信ボタンクリック: ${sel}`);
        break;
      }
    }
    if (!submitted) throw new Error('送信ボタンが見つかりませんでした');

    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await ss('11-done');

    const finalUrl = page.url();
    log(`✅ 登録完了: ${finalUrl}`);
    return { success: true, url: finalUrl };

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

// Apple Music 演奏者・プロデューサー入力
async function fillAppleMusicFields(page, d) {
  // 演奏者ロール選択（Audio）
  await selectOption(page, [
    'select[name*="performer_role" i]',
    'select[id*="performer_role" i]',
    'select[name*="performer_type" i]',
  ], d.applePerformerRole);

  // 演奏者名
  await fillInput(page, [
    'input[name*="performer_name" i]',
    'input[id*="performer_name" i]',
    'input[placeholder*="performer" i]',
  ], d.applePerformerName);

  // プロデューサーロール選択
  await selectOption(page, [
    'select[name*="producer_role" i]',
    'select[id*="producer_role" i]',
    'select[name*="producer_type" i]',
  ], d.appleProducerRole);

  // プロデューサー名
  await fillInput(page, [
    'input[name*="producer_name" i]',
    'input[id*="producer_name" i]',
    'input[placeholder*="producer" i]',
  ], d.appleProducerName);
}

// 重要事項の必須チェックボックスを全てチェック
async function checkAllRequiredBoxes(page) {
  // 未チェックのcheckboxを全て取得してチェック
  const unchecked = page.locator('input[type="checkbox"]:not(:checked)');
  const count = await unchecked.count();
  for (let i = 0; i < count; i++) {
    try {
      await unchecked.nth(i).check({ force: true });
    } catch {}
  }
}

// チェックボックスが未チェックなら入れる
async function checkIfUnchecked(page, selectors) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      const checked = await el.isChecked().catch(() => false);
      if (!checked) await el.check({ force: true });
      return true;
    }
  }
  return false;
}

// ページ上の全file inputを順に試してアップロード
async function tryAllFileInputs(page, filePath, preferredKeywords) {
  const allInputInfo = await page.evaluate((keywords) => {
    return Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => {
      const text = `${el.name} ${el.id} ${el.accept} ${el.className}`.toLowerCase();
      const score = keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
      return { index: i, score };
    }).sort((a, b) => b.score - a.score);
  }, preferredKeywords);

  for (const { index } of allInputInfo) {
    try {
      const el = page.locator('input[type="file"]').nth(index);
      await el.setInputFiles(filePath);
      return true;
    } catch {}
  }
  return false;
}

async function waitForUploadComplete(page) {
  await page.waitForTimeout(2000);
  const progressSels = ['.progress-bar', '[class*="progress"]', '[class*="uploading"]', '[class*="loading"]'];
  for (const sel of progressSels) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.waitFor({ state: 'hidden', timeout: 300000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1000);
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

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9぀-鿿_-]/g, '_').slice(0, 50);
}

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  const logPath = path.join(__dirname, config.logFile);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, line + '\n');
}

module.exports = { register };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i+1] : null; };
  const cfg = require('./config.json');
  register({
    title: get('--title') || 'Test',
    artist: get('--artist') || cfg.defaults.artist,
    genre: get('--genre') || cfg.defaults.genre,
    subgenre: get('--subgenre') || cfg.defaults.subgenre,
    language: get('--language') || cfg.defaults.language,
    releaseDate: get('--release-date') || '',
    audioPath: path.resolve(get('--audio')),
    coverPath: path.resolve(get('--cover')),
  }).catch(err => { console.error(err.message); process.exit(1); });
}
