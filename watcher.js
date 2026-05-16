#!/usr/bin/env node
/**
 * フォルダ監視デーモン
 *
 * watchDir（queue）に WAV + PNG を入れると自動でDistroKidに登録します。
 * サブフォルダ不要 — queue に直接ファイルを置くだけでOK。
 *
 * ファイル例:
 *   ~/Distrokid/queue/
 *     just-for-me.wav   ← 音声（WAV）
 *     cover.png         ← カバーアート
 *     meta.json         ← (省略可) { "title": "Just for me", "artist": "Mai", "genre": "J-Pop" }
 *
 * タイトルは meta.json の title → WAV ファイル名（拡張子なし）の順で決まります。
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { register } = require('./register');
const config = require('./config.json');

const AUDIO_EXTS = ['.wav', '.flac', '.mp3', '.aiff', '.aif'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];

// 処理中フラグ（二重起動防止）
let processing = false;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    const logPath = path.join(__dirname, config.logFile);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line + '\n');
  } catch {}
}

function findFile(dir, extensions) {
  try {
    return fs.readdirSync(dir)
      .find(f => extensions.includes(path.extname(f).toLowerCase()));
  } catch {
    return null;
  }
}

function loadMeta(dir) {
  const metaPath = path.join(dir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch { return {}; }
  }
  return {};
}

async function processQueue() {
  if (processing) return;

  const watchDir = config.watchDir;

  // WAVとPNGが両方揃っているか確認
  const audioFile = findFile(watchDir, AUDIO_EXTS);
  const coverFile = findFile(watchDir, IMAGE_EXTS);
  if (!audioFile || !coverFile) return;

  processing = true;
  log(`🎵 queue にファイルを検出 — 登録を開始します`);
  log(`   音声: ${audioFile} / カバー: ${coverFile}`);

  const meta = loadMeta(watchDir);
  const title = meta.title || path.basename(audioFile, path.extname(audioFile));
  const params = {
    title,
    artist: meta.artist || config.defaults.artist,
    genre: meta.genre || config.defaults.genre,
    subgenre: meta.subgenre || '',
    language: meta.language || config.defaults.language,
    releaseDate: meta.releaseDate || '',
    audioPath: path.join(watchDir, audioFile),
    coverPath: path.join(watchDir, coverFile),
  };

  try {
    const result = await register(params);

    // 成功 → done フォルダへ移動
    const destDir = path.join(config.doneDir, `${title}_${timestamp()}`);
    fs.mkdirSync(destDir, { recursive: true });
    moveFiles(watchDir, destDir, [audioFile, coverFile, 'meta.json']);
    log(`✅ 登録完了: "${title}" → done フォルダへ移動`);
    log(`   URL: ${result.url}`);

  } catch (err) {
    log(`❌ 登録失敗: "${title}" - ${err.message}`);

    // 失敗 → failed フォルダへ移動
    const failDir = path.join(config.failedDir, `${title}_${timestamp()}`);
    fs.mkdirSync(failDir, { recursive: true });
    moveFiles(watchDir, failDir, [audioFile, coverFile, 'meta.json']);
    log(`   failed フォルダへ移動しました: ${failDir}`);

  } finally {
    processing = false;
  }
}

function moveFiles(srcDir, destDir, filenames) {
  for (const name of filenames) {
    const src = path.join(srcDir, name);
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, path.join(destDir, name)); } catch {}
    }
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function startWatcher() {
  fs.mkdirSync(config.watchDir, { recursive: true });

  log('====== DistroKid 自動登録 監視デーモン 起動 ======');
  log(`監視フォルダ: ${config.watchDir}`);
  log('queue に WAV + PNG を入れると自動登録します。');
  log('終了するには Ctrl+C を押してください。\n');

  // 起動時に既存ファイルをスキャン
  processQueue();

  // chokidar でリアルタイム監視（queue 直下のみ、depth: 0）
  const watcher = chokidar.watch(config.watchDir, {
    depth: 0,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 },
    ignored: /(^|[\/\\])\../,
  });

  watcher.on('add', () => {
    // ファイルコピー完了を待ってからチェック
    setTimeout(() => processQueue(), 5000);
  });

  watcher.on('error', err => log(`監視エラー: ${err.message}`));

  process.on('SIGINT', () => {
    log('\n監視を停止しました。');
    watcher.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    watcher.close();
    process.exit(0);
  });
}

startWatcher();
