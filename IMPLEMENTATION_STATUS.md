# 実装・検証状況（2026-10-22）

## 依存ファイルの配置

GitHub直下に追加されたRapier3D本体を `vendor/rapier.es.js` に配置しました。元ファイルとGit blob SHAが一致しており、内容を変更していません。

- バージョン：Rapier3D compat 0.17.3（WASM内蔵）
- サイズ：2,407,199 bytes
- Git blob SHA：`80b431749b3cdb168072e28e751d0e254da6dc0e`

Three.jsとQRCode.jsも同梱しているため、起動時にCDNへの通信は不要です。

## 実装済み

3D描画、Rapier物理、多層床と落下穴、3玉のゴール判定、傾き同期、タッチ／キー／センサー操作、ジャンプとスタン、敵3種類の巡回・視界・音探知、粘着床とゲート、合成音、録画、NGリプレイ、ログ保存・再生、グリッド編集、共存判定、Undo/Redo、階層ロック、URL/QR共有、IndexedDB履歴、お気に入り、PWAキャッシュ。

## 確認済み

- `npm test` 成功：共有データ検証、日本語ラウンドトリップ、FIFO、お気に入り保護。
- Nodeで実際のRapier WASMを初期化し、バージョン0.17.3を確認。
- **実際のRapierを使うChromiumブラウザ統合テストに成功**（390×844、スタブなし）。
  - ゲーム起動、矢印キー操作、横はみ出しなし。
  - 穴に置いた玉が物理演算でB2へ落下。
  - 場外落下のNG判定、失敗階層でのリプレイ。
  - 3個すべてのゴール判定、お気に入り保存。
  - QR生成、編集の共存拒否、Undo/Redo。
  - Service Workerのキャッシュ後、ネットワークを切断して再読み込み・起動。
- JavaScript構文チェックと `git diff --check` 成功。

検証コマンド（Playwrightは環境にインストール済みのものを利用）：

```sh
npm test
NODE_PATH=/workspace/ball-tools/node_modules CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

通常の開発環境では `npm install` と `npx playwright install chromium` の後、`npm run test:browser` で実行できます。HTTPサーバーは `npm run serve` で先に起動してください。

## 実機で未確認・未実装の点

iOS/Androidでの60fps・ジャイロ許可・録画形式は実機未確認です。精密な屈折と擦り傷、体積光、大玉によるギミック破壊は未実装です。録画の厳密な待ち時間0秒はMediaRecorderの最終チャンク確定を要するため保証しません。詳細はREADMEに記載しています。
