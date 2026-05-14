#!/usr/bin/env node

/**
 * DistroKid シングル登録自動化スクリプト
 * Googleアカウントログイン対応
 *
 * 使い方:
 *   node distrokid.js \
 *     --title "Just for me" \
 *     --artist "アーティスト名" \
 *     --audio "/Users/mai_goto/Distrokid/Just for me/song.wav" \
 *     --cover "/Users/mai_goto/Distrokid/Just for me/cover.png" \
 *     [--genre "Pop"] \
 *     [--release-date 2026-06-01]
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    title: '',
    artist: '',
    audio: '',
    cover: '',
    genre: 'Pop',
    subgenre: '',
    releaseDate: '',
    language: 'Japanese',
    headless: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--title':        opts.title       = args[++i]; break;
      case '--artist':       opts.artist      = args[++i]; break;
      case '--audio':        opts.audio       = path.resolve(args[++i]); break;
      case '--cover':        opts.cover       = path.resolve(args[++i]); break;
      case '--genre':        opts.genre       = args[++i]; break;
      case '--subgenre':     opts.subgenre    = args[++i]; break;
      case '--release-date': opts.releaseDate = args[++i]; break;
      case '--language':     opts.language    = args[++i]; break;
      case '--headless':     opts.headless    = true; break;
    }
  }

  const required = ['title', 'artist', 'audio', 'cover'];
  const missing = required.filter(k => !opts[k]);
  if (missing.length > 0) {
    console.error('引数が足りません: ' + missing.map(k => '--' + k).join(', '));
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(opts.audio)) {
    console.error(`音声ファイルが見つかりません: ${opts.audio}`);
    process.exit(1);
  }
  if (!fs.existsSync(opts.cover)) {
    console.error(`カバーアートが見つかりません: ${opts.cover}`);
    process.exit(1);
  }

  return opts;
}

function printUsage() {
  console.error(`
使い方:
  node distrokid.js \\
    --title "Just for me" \\
    --artist "アーティスト名" \\
    --audio "/path/to/song.wav" \\
    --cover "/path/to/cover.png" \\
    [--genre "Pop"] \\
    [--release-date 2026-06-01] \\
    [--language "Japanese"]
`);
}

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function loginWithGoogle(page) {
  console.log('\n[1/6] DistroKid を開いています...');
  await page.goto('https://distrokid.com/vip/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // すでにログイン済みか確認
  if (page.url().includes('/app') || page.url().includes('/upload') || page.url().includes('/bank')) {
    console.log('      既にログイン済みです。');
    return;
  }

  // Googleログインボタンを探してクリック
  const googleBtn = page.locator([
    'a[href*="google"]',
    'button:has-text("Google")',
    'a:has-text("Google")',
    '[data-provider="google"]',
    'a:has-text("Continue with Google")',
    'a:has-text("Sign in with Google")',
  ].join(', ')).first();

  if (await googleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('      Googleログインボタンをクリックします...');
    await googleBtn.click();
  } else {
    // ログインページへ移動
    await page.goto('https://distrokid.com/login/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const googleBtn2 = page.locator([
      'a[href*="google"]',
      'button:has-text("Google")',
      'a:has-text("Google")',
      'a:has-text("Continue with Google")',
    ].join(', ')).first();
    if (await googleBtn2.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('      Googleログインボタンをクリックします...');
      await googleBtn2.click();
    }
  }

  console.log('\n=================================================');
  console.log('  ブラウザでGoogleログイン画面が開きました。');
  console.log('  Googleアカウントでログインしてください。');
  console.log('  ログイン完了後、このターミナルで Enter を押してください。');
  console.log('=================================================\n');
  await waitForEnter('ログイン完了後 → Enter: ');

  // ログイン後のURLを確認
  const currentUrl = page.url();
  if (currentUrl.includes('distrokid.com/vip') || currentUrl.includes('login')) {
    // リダイレクト待ち
    await page.waitForURL('**/distrokid.com/**', { timeout: 10000 }).catch(() => {});
  }
  console.log('      ログイン完了。');
}

async function navigateToUpload(page) {
  console.log('[2/6] アップロードページへ移動中...');
  await page.goto('https://distrokid.com/upload/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // ログインが切れていたら再確認
  if (page.url().includes('login') || page.url().includes('vip')) {
    console.log('\n⚠️  ログインが必要です。ブラウザでログインしてください。');
    await waitForEnter('ログイン完了後 → Enter: ');
    await page.goto('https://distrokid.com/upload/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
  }

  // "Single" を選択（UIに応じて）
  const singleSelectors = [
    'text=/^single$/i',
    '[data-type="single"]',
    'label:has-text("Single")',
    'button:has-text("Single")',
    'a:has-text("Single")',
  ];
  for (const sel of singleSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1000);
      break;
    }
  }

  console.log('      アップロードページへ移動しました。');
}

async function fillSongInfo(page, opts) {
  console.log('[3/6] 曲情報を入力中...');

  // タイトル入力
  const titleSelectors = [
    'input[name="song_title"]',
    'input[name="title"]',
    'input[placeholder*="title" i]',
    'input[placeholder*="タイトル"]',
    'input[id*="title" i]',
  ];
  let filled = false;
  for (const sel of titleSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.clear();
      await el.fill(opts.title);
      filled = true;
      break;
    }
  }
  if (!filled) {
    console.warn('      ⚠️  タイトル入力欄が見つかりませんでした。手動で入力してください。');
  }

  // アーティスト名
  const artistSelectors = [
    'input[name="artist_name"]',
    'input[name="artist"]',
    'input[placeholder*="artist" i]',
    'input[placeholder*="アーティスト"]',
    'input[id*="artist" i]',
  ];
  for (const sel of artistSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.clear();
      await el.fill(opts.artist);
      await page.waitForTimeout(800);
      // オートコンプリートドロップダウンを処理
      const dropdown = page.locator('.autocomplete li, [class*="suggestion"] li, [class*="dropdown"] li').first();
      if (await dropdown.isVisible({ timeout: 2000 }).catch(() => false)) {
        await dropdown.click();
      }
      break;
    }
  }

  // ジャンル
  if (opts.genre) {
    const genreSelectors = ['select[name="genre"]', 'select[id*="genre" i]', 'select[name*="genre" i]'];
    for (const sel of genreSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.selectOption({ label: opts.genre }).catch(() =>
          el.selectOption({ value: opts.genre }).catch(() => {})
        );
        break;
      }
    }
  }

  // サブジャンル
  if (opts.subgenre) {
    const el = page.locator('select[name="subgenre"], select[id*="subgenre" i]').first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.selectOption({ label: opts.subgenre }).catch(() => {});
    }
  }

  // 言語
  if (opts.language) {
    const langEl = page.locator('select[name="language"], select[id*="lang" i]').first();
    if (await langEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      await langEl.selectOption({ label: opts.language }).catch(() =>
        langEl.selectOption({ value: opts.language }).catch(() => {})
      );
    }
  }

  // リリース日
  if (opts.releaseDate) {
    const dateEl = page.locator('input[name="release_date"], input[type="date"]').first();
    if (await dateEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dateEl.fill(opts.releaseDate);
    }
  }

  console.log('      曲情報の入力完了。');
}

async function uploadAudio(page, audioPath) {
  console.log(`[4/6] 音声ファイルをアップロード中... (${path.basename(audioPath)})`);

  const audioSelectors = [
    'input[type="file"][accept*="audio"]',
    'input[type="file"][name*="audio"]',
    'input[type="file"][name*="wav"]',
    'input[type="file"][name*="song"]',
    'input[type="file"]',
  ];

  let uploaded = false;
  for (const sel of audioSelectors) {
    const inputs = page.locator(sel);
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      try {
        await el.setInputFiles(audioPath);
        uploaded = true;
        break;
      } catch {}
    }
    if (uploaded) break;
  }

  if (!uploaded) {
    console.warn('      ⚠️  ファイル入力欄が見つかりませんでした。');
    console.warn('         ブラウザで手動でWAVファイルを選択してください。');
    await waitForEnter('WAVファイル選択完了後 → Enter: ');
    return;
  }

  // アップロード完了を待つ
  console.log('      アップロード中... (大きいファイルは数分かかることがあります)');
  await page.waitForTimeout(3000);

  // プログレスバーが消えるまで待つ
  const progressSels = ['.progress-bar', '.upload-progress', '[class*="progress"]', '[class*="uploading"]'];
  for (const sel of progressSels) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.waitFor({ state: 'hidden', timeout: 300000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(2000);
  console.log('      音声ファイルのアップロード完了。');
}

async function uploadCover(page, coverPath) {
  console.log(`[5/6] カバーアートをアップロード中... (${path.basename(coverPath)})`);

  const coverSelectors = [
    'input[type="file"][accept*="image"]',
    'input[type="file"][name*="cover"]',
    'input[type="file"][name*="art"]',
    'input[type="file"][name*="image"]',
    'input[type="file"][name*="photo"]',
  ];

  let uploaded = false;
  for (const sel of coverSelectors) {
    const inputs = page.locator(sel);
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      try {
        await el.setInputFiles(coverPath);
        uploaded = true;
        break;
      } catch {}
    }
    if (uploaded) break;
  }

  if (!uploaded) {
    console.warn('      ⚠️  カバーアート入力欄が見つかりませんでした。');
    console.warn('         ブラウザで手動でPNGファイルを選択してください。');
    await waitForEnter('カバーアート選択完了後 → Enter: ');
    return;
  }

  console.log('      アップロード中...');
  await page.waitForTimeout(3000);
  const progressSels = ['.progress-bar', '.upload-progress', '[class*="progress"]'];
  for (const sel of progressSels) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.waitFor({ state: 'hidden', timeout: 120000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1000);
  console.log('      カバーアートのアップロード完了。');
}

async function confirmAndSubmit(page) {
  console.log('[6/6] 送信前の確認...');

  const screenshotPath = path.join(process.cwd(), 'before-submit.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`\n   📸 送信前スクリーンショット保存: ${screenshotPath}`);
  console.log('   ブラウザで内容を確認してください。');
  console.log('   問題なければ Enter を押すと送信します。');
  console.log('   キャンセルする場合は Ctrl+C を押してください。\n');

  await waitForEnter('送信する → Enter / キャンセル → Ctrl+C: ');

  // 送信ボタンをクリック
  const submitSelectors = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Submit"):visible',
    'button:has-text("Upload"):visible',
    'button:has-text("送信"):visible',
    'button:has-text("Publish"):visible',
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

  if (!submitted) {
    console.warn('   ⚠️  送信ボタンが見つかりませんでした。');
    console.warn('      ブラウザで手動で送信してください。');
    await waitForEnter('送信完了後 → Enter: ');
    return page.url();
  }

  // 完了ページを待つ
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const url = page.url();
  console.log('\n✅ 登録完了！');
  console.log('   URL:', url);

  const doneScreenshot = path.join(process.cwd(), 'after-submit.png');
  await page.screenshot({ path: doneScreenshot, fullPage: true });
  console.log(`   📸 完了スクリーンショット: ${doneScreenshot}`);

  return url;
}

async function main() {
  const opts = parseArgs();

  console.log('\n====== DistroKid 曲登録自動化 ======');
  console.log('タイトル    :', opts.title);
  console.log('アーティスト:', opts.artist);
  console.log('音声ファイル:', opts.audio);
  console.log('カバーアート:', opts.cover);
  console.log('ジャンル    :', opts.genre);
  console.log('言語        :', opts.language);
  if (opts.releaseDate) console.log('リリース日  :', opts.releaseDate);
  console.log('=====================================\n');

  // Mac用: システムのChromiumかChromeを使う
  const execPaths = [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', // Linux (このサーバー)
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Mac Chrome
    '/Applications/Chromium.app/Contents/MacOS/Chromium',           // Mac Chromium
  ].filter(p => {
    try { fs.accessSync(p); return true; } catch { return false; }
  });

  const launchOptions = {
    headless: opts.headless,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    // Mac上では executablePath 不要（Playwrightが自動検出）
  };
  if (execPaths.length > 0) {
    launchOptions.executablePath = execPaths[0];
  }

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('  [browser]', msg.text());
  });

  try {
    await loginWithGoogle(page);
    await navigateToUpload(page);
    await fillSongInfo(page, opts);
    await uploadAudio(page, opts.audio);
    await uploadCover(page, opts.cover);
    await confirmAndSubmit(page);

  } catch (err) {
    console.error('\n❌ エラーが発生しました:', err.message);
    const errScreenshot = path.join(process.cwd(), 'error.png');
    await page.screenshot({ path: errScreenshot, fullPage: true }).catch(() => {});
    console.error(`   📸 エラー時のスクリーンショット: ${errScreenshot}`);
    process.exit(1);
  } finally {
    console.log('\nブラウザを閉じます。Enter を押してください。');
    await waitForEnter('');
    await browser.close();
  }
}

main();
