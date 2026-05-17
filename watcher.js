#!/usr/bin/env node
/**
 * フォルダ監視デーモン
 *
 * watchDir 以下にサブフォルダを作り、WAV + PNG を入れると自動でDistroKidに登録します。
 * フォルダ名 = 曲タイトル（meta.jsonで上書き可）
 *
 * フォルダ例:
 *   ~/Distrokid/queue/Just for me/
 *     just-for-me.wav   ← 音声（WAV）
 *     cover.png         ← カバーアート
 *     meta.json         ← (省略可) { "artist": "Mai", "genre": "J-Pop" }
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { register } = require('./register');
const config = require('./config.json');

const AUDIO_EXTS = ['.wav', '.flac', '.mp3', '.aiff', '.aif'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];

// 処理中のフォルダ（二重起動防止）
const processing = new Set();

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

function loadMeta(songDir) {
  const metaPath = path.join(songDir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch { return {}; }
  }
  return {};
}

async function processFolder(songDir) {
  if (processing.has(songDir)) return;

  // WAVとPNGが両方揃っているか確認
  const audioFile = findFile(songDir, AUDIO_EXTS);
  const coverFile = findFile(songDir, IMAGE_EXTS);
  if (!audioFile || !coverFile) return;

  processing.add(songDir);
  const title = path.basename(songDir);
  log(`📂 新しいフォルダを検出: "${title}"`);
  log(`   音声: ${audioFile} / カバー: ${coverFile}`);

  // メタ情報の読み込み（フォルダ内の meta.json を優先）
  const meta = loadMeta(songDir);
  const params = {
    title: meta.title || title,
    artist: meta.artist || config.defaults.artist,
    genre: meta.genre || config.defaults.genre,
    subgenre: meta.subgenre || '',
    language: meta.language || config.defaults.language,
    releaseDate: meta.releaseDate || '',
    audioPath: path.join(songDir, audioFile),
    coverPath: path.join(songDir, coverFile),
    secondaryGenre: meta.secondaryGenre || config.defaults.secondaryGenre || '',
    songwriterFirstName: meta.songwriterFirstName || config.defaults.songwriterFirstName || '',
    songwriterLastName: meta.songwriterLastName || config.defaults.songwriterLastName || '',
    performerRole: meta.performerRole || config.defaults.performerRole || '',
    performerName: meta.performerName || config.defaults.performerName || '',
    producerRole: meta.producerRole || config.defaults.producerRole || '',
    producerName: meta.producerName || config.defaults.producerName || '',
  };

  try {
    const result = await register(params);

    // 成功 → done フォルダへ移動
    const destDir = path.join(config.doneDir, `${title}_${timestamp()}`);
    fs.mkdirSync(config.doneDir, { recursive: true });
    fs.renameSync(songDir, destDir);
    log(`✅ 登録完了: "${title}" → done フォルダへ移動`);
    log(`   URL: ${result.url}`);

  } catch (err) {
    log(`❌ 登録失敗: "${title}" - ${err.message}`);

    // 失敗 → failed フォルダへ移動
    const failDir = path.join(config.failedDir, `${title}_${timestamp()}`);
    fs.mkdirSync(config.failedDir, { recursive: true });
    try { fs.renameSync(songDir, failDir); } catch {}
    log(`   failed フォルダへ移動しました: ${failDir}`);

  } finally {
    processing.delete(songDir);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function startWatcher() {
  fs.mkdirSync(config.watchDir, { recursive: true });

  log('====== DistroKid 自動登録 監視デーモン 起動 ======');
  log(`監視フォルダ: ${config.watchDir}`);
  log('WAV + PNG が揃ったフォルダを検出したら自動登録します。');
  log('終了するには Ctrl+C を押してください。\n');

  // 既存フォルダをスキャン
  try {
    for (const entry of fs.readdirSync(config.watchDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const fullPath = path.join(config.watchDir, entry.name);
        processFolder(fullPath);
      }
    }
  } catch {}

  // chokidar でリアルタイム監視
  const watcher = chokidar.watch(config.watchDir, {
    depth: 1,           // サブフォルダ1階層まで
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 }, // 書き込み完了を待つ
    ignored: /(^|[\/\\])\../, // 隠しファイル無視
  });

  watcher.on('add', (filePath) => {
    const songDir = path.dirname(filePath);
    if (songDir === config.watchDir) return; // ルート直下は無視
    // 少し待ってからチェック（ファイルコピー完了を待つ）
    setTimeout(() => processFolder(songDir), 5000);
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
