# National Student Wireless Research Club（NSWRC）公式サイト

GitHub Pages で公開する静的サイトです。日本語の正式名称は「全国学生無線通信研究会」、英語名称は **National Student Wireless Research Club**、略称は **NSWRC** です。

## ページ構成

- `index.html` — トップページ
- `news.html` — お知らせ一覧
- `news/<slug>.html` — お知らせ個別ページ（ビルド生成物）
- `contact.html` — お問い合わせフォーム
- `content/news/*.md` — お知らせの原稿（ここだけ編集すればOK）
- `news-data.json` — 一覧・トップページ・記事表示用の生成データ
- `templates/news-article.html` — 個別ページの共通テンプレート
- `scripts/build-news.mjs` — Markdownから公開用データと記事ページを生成

## お知らせを追加する方法

お知らせは **Markdownファイルを1つ追加するだけ** で管理できます。JSONやHTMLを直接編集する必要はありません。

1. `content/news/` に `2026-11-20-event.md` のようなファイルを作成します。
2. 先頭にYAML形式のメタデータを書き、その下にMarkdown本文を書きます。

```markdown
---
date: 2026-11-20
slug: student-radio-meeting-2026
category: イベント
title: 学生無線家交流会を開催します
summary: 全国の学生無線家が集まり、活動や技術について交流します。
---

## 開催概要

学生無線家交流会を開催します。

- 日時：2026年11月20日
- 内容：交流・情報交換

詳細は[こちら](https://example.org)をご覧ください。
```

3. リポジトリのルートで `node scripts/build-news.mjs` を実行します。
4. 生成・更新された `news-data.json`、`docs/news-data.json`、記事HTMLを含めてコミットします。

**次回からはMarkdownファイルを追加・編集するだけ。** ビルドスクリプトが日付順の一覧データと個別記事ページを自動生成し、トップページの最新3件にも反映します。記事を削除する場合は元のMarkdownを削除して再ビルドしてください。

### メタデータ

| キー | 内容 |
| --- | --- |
| `date` | 公開日（YYYY-MM-DD） |
| `slug` | 記事URL用ID（半角英小文字・数字・ハイフン） |
| `category` | お知らせ / イベント / 活動報告 / 募集 など |
| `title` | 記事タイトル |
| `summary` | 一覧ページ用の概要 |

本文では見出し、太字、斜体、取り消し線、インラインコード、コードブロック、箇条書き、番号付きリスト、引用、水平線、HTTPSリンクを利用できます。

## 表示・スマートフォン対応

お知らせ一覧と個別記事は、PC・タブレット・スマートフォンの画面幅に合わせてレイアウトが切り替わります。狭い画面では一覧情報を縦方向に整理し、記事本文・コードブロック・前後記事リンクも画面からはみ出さないようにしています。

## GitHub Pages

GitHub Pages の公開元を `main` ブランチの `/docs` に設定する運用です。ビルド後は `docs/` 側の生成物が公開対象になります。ルート側も同じ内容に保ってください。

## お問い合わせフォーム

現在のフォームは入力検証と送信前の案内まで実装していますが、送信先は未設定です。実際に問い合わせを受信するには、フォーム受付サービスまたはサーバー側APIを接続し、送信先・個人情報の取り扱い・スパム対策を設定する必要があります。送信先が接続されるまでは、フォームから問い合わせが届くことはありません。


## 入会申込システム（Vercel + Supabase）

GitHub Pagesの公開サイトは維持し、Vercel上のAPIを通じてSupabaseへ申込情報を保存します。

- `application.html` — 入会申込フォーム
- `admin.html` — 管理者向け申込一覧・ステータス更新
- `api/applications.js` — 公開申込API
- `api/admin-applications.js` — 管理者専用API（一覧・審査状況・内部メモ・操作履歴）
- `supabase/migrations/202611140001_membership_applications.sql` — DBスキーマとRLS
- `supabase/migrations/202611140002_admin_audit_and_notes.sql` — 管理者用メモ欄と操作履歴
- `admin-config.js` — 管理画面用の公開Supabase URL / anon key（service role keyは禁止）

### 本番受付開始前の必須設定
1. Supabaseプロジェクトを用意し、migration SQLをSQL Editorで実行する。
2. Vercelの `nswrc-membership` プロジェクトに `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`ALLOWED_ORIGINS` を設定する。Service Role Keyはサーバー環境変数だけに保存する。
3. `admin-config.js` にSupabase URLとanon keyを設定する。これらは公開鍵だが、RLSとサーバー側権限検証を必須とする。
4. Supabase Authで管理者アカウントを作成し、信頼できる管理者が `app_metadata.role = "admin"` を設定する。ユーザー自身が変更可能なuser_metadataを権限判定に使わない。
5. `202611140002_admin_audit_and_notes.sql` をSupabase SQL Editorで実行し、内部メモ欄と操作履歴テーブルを追加する。
6. API・管理者ログイン・申込保存・ステータス更新・内部メモ・操作履歴をテストする。
7. 個人情報管理主体、連絡先、保存期間、削除手順、参加条件、会費を運営側で確定してから本番受付を開始する。

現在、環境変数・Supabaseプロジェクトは未設定のため、フォームは受付停止の応答を返します。メール自動返信・運営通知・レート制限・監視・バックアップは別途設定が必要です。


### 管理者ポータルの機能

- 概要：申込件数、審査状況、直近6か月の申込推移、最近の申込
- 入会申込管理：キーワード検索、審査状況・申込区分・受付日の絞り込み、ページ切替、CSV出力
- 申込詳細：申込情報の確認、管理者専用の内部メモ、審査状況の更新
- 操作履歴：審査状況と内部メモの変更履歴（追加migration適用後）
- 環境設定：表示件数、自動更新、ログイン後の初期画面
- デモ環境：架空のデータで画面を確認。デモの変更は保存されない

内部メモは申込者には公開されません。管理者API経由でのみ取得・更新し、データベースのRLSは有効のままにします。CSVには内部メモが含まれるため、出力ファイルも個人情報と同等に慎重に取り扱ってください。
