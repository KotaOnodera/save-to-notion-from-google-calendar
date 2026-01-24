# GoogleカレンダーとNotionの双方向同期（GAS）

GoogleカレンダーとNotionのデータベースを双方向で日次同期します。
競合時（両方で変更された場合）はGoogleカレンダーを優先します。

## セットアップ

1. Notionインテグレーションを作成し、対象DBを共有します。
2. Google Apps Scriptのスクリプトプロパティに以下を設定します。
   - `CALENDAR_ID`
   - `NOTION_DB_ID`
   - `NOTION_TOKEN`
   - `GOOGLE_CHAT_WEBHOOK_URL`（任意）
3. Notion DBに以下のプロパティを作成します（必要なら`PROPERTY_NAMES`で名称を変更）。
   - `Title`（タイトル）
   - `EventId`（リッチテキスト）
   - `Date`（日付）→ 開始・終了を日付範囲で保存
   - `Location`（リッチテキスト）
   - `Description`（リッチテキスト）
   - `Type`（セレクト）→ カレンダー色名
   - `Signature`（リッチテキスト）
   - `UpdatedAt`（日付）
4. `syncCalendarToNotion` を手動実行して認可し、トリガーを設定します。

## トリガー

以下を1回実行すると日次トリガーを作成します（ローカル03:00）。

```
createDailyTrigger()
```

## テスト

`runTests()` を実行すると以下の内容を検証します。

- 署名がタイトル変更で変わること
- カレンダーの色名が取得できること
- 終日イベントが日付のみで保存されること
- GCalとNotionの署名が同じデータで一致すること
- 同期サマリーメッセージが正しく構築されること

## Google Chat通知

同期完了後、変更があった場合にGoogle Chatへサマリーを送信します。

### 設定方法

1. Google Chatでスペースを開き、Webhookを作成します。
2. Webhook URLをスクリプトプロパティ `GOOGLE_CHAT_WEBHOOK_URL` に設定します。

### 通知内容

- 新規作成されたイベント（イベント名・日付）
- GCal→Notion方向で更新されたイベント
- Notion→GCal方向で更新されたイベント
- 失敗したイベント（あれば）
- スキップ数

変更がない場合（全てスキップ）や、Webhook URLが未設定の場合は通知しません。

## 同期の動作

- **GCalで変更** → Notionに反映
- **Notionで変更** → GCalに反映
- **両方で変更** → GCal優先（Notionを上書き）
- **新規イベント** → GCalからNotionに作成

## 注意事項

- 同期対象は「過去1ヶ月〜未来3ヶ月」です。
- 既存ページは `EventId` で突合し、`Signature` で変更を検知します。
- カレンダー色は `CalendarApp.EventColor` の名称（例: `PALE_BLUE`）を保存します。
  任意のラベルにしたい場合は `getEventColorName_` をマッピング変更してください。
- Notionで色（Type）を変更してもGCalには反映されません。
