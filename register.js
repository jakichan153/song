#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('./config.json');

async function register({ title, artist, genre, subgenre, secondaryGenre, language, releaseDate, audioPath, coverPath,
  songwriterFirstName, songwriterLastName, performerRole, performerName, producerRole, producerName }) {
  if (!fs.existsSync(config.sessionFile)) {
    throw new Error(`セッションファイルがありません。先に node setup.js を実行してください。`);
  }

  const ssDir = path.join(__dirname, 'logs', 'screenshots');
  fs.mkdirSync(ssDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false, // デバッグのためヘッドありで起動
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

    await page.goto('https://distrokid.com/new/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    await ss('01-upload-page');

    if (page.url().includes('login') || page.url().includes('vip')) {
      throw new Error('セッションが切れています。node setup.js を再実行してください。');
    }

    // ページ上の全file inputを列挙してログに出す
    const allInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => ({
        index: i,
        name: el.name,
        id: el.id,
        accept: el.accept,
        className: el.className.slice(0, 60),
      }));
    });
    log(`  ページ上のfile input一覧: ${JSON.stringify(allInputs)}`);

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

    // 再度file inputを列挙
    const inputsAfterSingle = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).map((el, i) => ({
        index: i, name: el.name, id: el.id, accept: el.accept,
      }));
    });
    log(`  Single選択後のfile input: ${JSON.stringify(inputsAfterSingle)}`);

    // --- 音声ファイルアップロード（全inputを順に試す）---
    log(`  音声アップロード中: ${path.basename(audioPath)}`);
    const audioUploaded = await tryAllFileInputs(page, audioPath, ['audio', 'wav', 'mp3', 'flac', 'song', 'track', 'file']);
    if (!audioUploaded) {
      await ss('03-audio-upload-fail');
      throw new Error(`音声のアップロードに失敗しました: ${audioPath}`);
    }
    await page.waitForTimeout(5000);
    await ss('04-after-audio-upload');

    // アップロード完了待ち
    await waitForUploadComplete(page);
    log(`  音声アップロード完了`);

    // --- メタデータ入力 ---
    await ss('05-before-metadata');

    // 全フォームフィールドをログ出力（デバッグ用）
    const allFormFields = await page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll('input:not([type="file"])')).map((el, i) => ({
        i, type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, value: el.value,
      })),
      selects: Array.from(document.querySelectorAll('select')).map((el, i) => ({
        i, name: el.name, id: el.id,
      })),
    }));
    log(`  フォームフィールド: ${JSON.stringify(allFormFields)}`);

    // アルバムタイトル
    await fillInput(page, ['input[name="albumtitle"]', '#albumTitleInput'], title);

    // トラックタイトル（name属性がUUIDを含む → placeholder で特定）
    await fillInput(page, ['input[name^="title_"]', 'input[placeholder*="曲名"]'], title);

    // 言語
    if (language) await selectOption(page, ['select[name="language"]', '#language'], language);

    // ジャンル（第1）
    if (genre) await selectOption(page, ['select[name="genre1"]', '#genrePrimary'], genre);

    // ジャンル（第2）
    if (secondaryGenre) await selectOption(page, ['select[name="genre2"]', '#genreSecondary'], secondaryGenre);

    // ソングライター
    if (songwriterFirstName) await fillInput(page, ['input[name="songwriter_real_name_first1"]'], songwriterFirstName);
    if (songwriterLastName)  await fillInput(page, ['input[name="songwriter_real_name_last1"]'],  songwriterLastName);

    // Apple クレジット - 演奏者
    if (performerRole) await selectOption(page, ['#track-1-performer-1-role'], performerRole);
    if (performerName) await fillInput(page,   ['#track-1-performer-1-name', 'input[name="performer-name"]'], performerName);

    // Apple クレジット - プロデューサー
    if (producerRole) await selectOption(page, ['#track-1-producer-1-role'], producerRole);
    if (producerName) await fillInput(page,   ['#track-1-producer-1-name', 'input[name="producer-name"]'], producerName);

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

    // --- 送信 ---
    await ss('09-before-submit');
    const submitSelectors = [
      'button:has-text("続ける")',
      'input[value="続ける"]',
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

    await page.waitForTimeout(4000);
    await ss('10-done');

    // エラーダイアログが出ていないか確認
    const errorVisible = await page.locator('[role="dialog"]:has-text("エラー"), .modal-body:has-text("エラー")').first()
      .isVisible({ timeout: 3000 }).catch(() => false);
    if (errorVisible) {
      const errorText = await page.locator('[role="dialog"], .modal-body').first()
        .innerText().catch(() => '不明なエラー');
      throw new Error(`送信後にエラーダイアログが表示されました: ${errorText}`);
    }

    const finalUrl = page.url();
    log(`✅ 登録完了: ${finalUrl}`);
    return { success: true, url: finalUrl };

  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }
}

// ページ上の全file inputを順に試してアップロード
async function tryAllFileInputs(page, filePath, preferredKeywords) {
  // まず属性でフィルタして優先的に試す
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
    language: get('--language') || cfg.defaults.language,
    releaseDate: get('--release-date') || '',
    audioPath: path.resolve(get('--audio')),
    coverPath: path.resolve(get('--cover')),
  }).catch(err => { console.error(err.message); process.exit(1); });
}
