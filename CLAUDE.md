# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

GoogleカレンダーとNotionデータベースを双方向で日次同期するGoogle Apps Script（GAS）プロジェクト。競合時はGoogleカレンダー優先。V8ランタイム、タイムゾーンはAsia/Tokyo。

## コマンド

**テスト実行:**

```javascript
runTests()
```

GASエディタで実行し、全ユニットテストを実行。

**手動同期:**

```javascript
syncCalendarToNotion()
```

カレンダーからNotionへの同期を即座に実行。

**日次トリガー設定:**

```javascript
createDailyTrigger()
```

毎日3:00に同期を実行するトリガーを作成。

**claspでデプロイ:**

```bash
clasp push    # ローカルの変更をGASにプッシュ
clasp pull    # リモートの変更をプル
```

## アーキテクチャ

### データフロー（双方向同期）

1. `syncCalendarToNotion()`がGoogleカレンダーからイベントを取得（過去1ヶ月〜未来3ヶ月）
2. 既存のNotionページを`EventId`でインデックス化して事前ロード
3. 各イベントに対してGCalとNotion両方のSHA-256署名を生成
4. 署名を比較して同期方向を決定：
   - GCal署名が変更 → Notionを更新（GCal優先）
   - GCal署名が同じでNotion署名が変更 → GCalを更新
   - 両方同じ → スキップ
   - 新規 → Notionに作成

### 主要関数

- `buildSignature_(event, colorName)` - GCalイベントから変更検知用SHA-256ハッシュを生成
- `buildNotionPageSignature_(page, eventId)` - Notionページから変更検知用SHA-256ハッシュを生成
- `buildNotionProperties_(event, signature, colorName)` - カレンダーイベントをNotionプロパティにマッピング
- `updateCalendarEvent_(calendar, eventId, notionPage)` - NotionデータでGCalイベントを更新
- `fetchNotionPagesByEventId_(dbId, rangeStart, rangeEnd, token)` - ページネーション対応でNotionをクエリ
- `getEventColorName_(event)` - `CalendarApp.EventColor`列挙型を文字列名に変換

### 設定
スクリプトプロパティ（GASエディタで設定）:

- `CALENDAR_ID` - 同期元のGoogleカレンダーID
- `NOTION_DB_ID` - 同期先のNotionデータベースID
- `NOTION_TOKEN` - Notionインテグレーショントークン
- `GOOGLE_CHAT_WEBHOOK_URL` - （任意）同期完了通知を送信するGoogle Chat Webhook URL

### Google Chat通知
同期完了後、変更があった場合にGoogle Chatへサマリーを送信。通知内容:
- 新規作成されたイベント
- GCal→Notion方向で更新されたイベント
- Notion→GCal方向で更新されたイベント
- 失敗したイベント（あれば）

変更がない場合（全てスキップ）は通知しない。`GOOGLE_CHAT_WEBHOOK_URL`が未設定の場合も通知しない。

### Notionプロパティスキーマ
`PROPERTY_NAMES`定数で定義: Title, EventId, Date（日付範囲）, Location, Description, Type（色）, Signature, UpdatedAt

### テスト
テストは`makeFakeEvent_()`を使用して、実際のカレンダーデータなしでモックイベントを作成。
