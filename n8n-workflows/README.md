# n8n Workflow: GROWI Mention Notification

GROWI のグローバル通知（ページ編集）を受け取り、前回リビジョンとの差分から `@mention` を抽出して、該当ユーザーにチャット通知を送るワークフロー。

## ワークフロー全体像

```
[Webhook] → [Parse Notification] → [Fetch Latest 2 Revisions] → [Extract Mentions from Diff] → [Has Targets?]
                                                                                                      │
                                                                              ┌───────────────────────┤
                                                                              ▼ Yes                    ▼ No
                                                                  [Split into Targets]           [Skip]
                                                                         │
                                                              ┌──────────┴──────────┐
                                                              ▼                     ▼
                                                      [Slack DM]         [GROWI In-App]
```

## 各ノードの詳細

### 1. Webhook (GROWI Global Notification)

GROWI の「グローバル通知設定 > Slack」で、通常の Slack Webhook URL の代わりにこの n8n Webhook URL を設定する。

GROWI が送信するペイロード:

```json
{
  "channel": "#general",
  "username": "GROWI",
  "text": ":bell: <https://growi.example.com/user/alice|alice> edited <https://growi.example.com/64a1b2c3d4e5f6|/path/to/page>",
  "attachments": "[{\"color\":\"#263a3c\",\"text\":\"\",\"mrkdwn_in\":[\"text\"]}]"
}
```

### 2. Parse Notification

Slack 形式メッセージから以下を正規表現で抽出:

| 変数 | 説明 | 例 |
|------|------|-----|
| `editor` | 編集したユーザー名 | `alice` |
| `pageId` | ページ ID (MongoID) | `64a1b2c3d4e5f6` |
| `pagePath` | ページパス | `/path/to/page` |
| `baseUrl` | GROWI のベース URL | `https://growi.example.com` |

### 3. Fetch Latest 2 Revisions

GROWI API でページの最新2リビジョンを取得:

```
GET {baseUrl}/_api/v3/revisions/list?pageId={pageId}&limit=2
Authorization: Bearer {API_TOKEN}
```

レスポンス:

```json
{
  "revisions": [
    { "_id": "...", "body": "current body...", "author": { "username": "alice" } },
    { "_id": "...", "body": "previous body...", "author": { "username": "bob" } }
  ],
  "totalCount": 42
}
```

**必要な設定**: GROWI 管理者の API Token を n8n の Credentials に登録する。

### 4. Extract Mentions from Diff (核心ロジック)

```javascript
// 差分計算 (行単位)
const prevLines = new Set(previousBody.split('\n'));
const currentLines = currentBody.split('\n');
const addedLines = currentLines.filter(line => !prevLines.has(line));
const diffText = addedLines.join('\n');

// @メンション抽出 (差分のみから)
const mentionPattern = /\B@[\w@.-]+/g;
const mentions = diffText.match(mentionPattern) || [];
const mentionedUsernames = [...new Set(mentions.map(m => m.slice(1)))];

// コントリビューター抽出 (リビジョン著者)
const contributors = [...new Set(
  revisions.map(r => r.author?.username).filter(Boolean)
)];

// 統合・重複排除・編集者本人を除外
const allTargets = [...new Set([...contributors, ...mentionedUsernames])]
  .filter(u => u !== editor);

// 通知メッセージ構築
const message = `📝 @${editor} が [${pagePath}](${pageUrl}) を編集しました\n`
  + `👥 関係者: ${allTargets.map(u => '@' + u).join(' ')}`;
```

### 5. Send Chat Notification

通知先の選択肢:

| 方式 | n8n ノード | 説明 |
|------|-----------|------|
| **Slack DM** | `n8n-nodes-base.slack` | `chat.postMessage` で `@username` に DM 送信 |
| **Slack Channel** | `n8n-nodes-base.slack` | 特定チャンネルに関係者をメンションして投稿 |
| **メール** | `n8n-nodes-base.emailSend` | GROWI API でユーザーのメールアドレスを取得して送信 |
| **Mattermost** | `n8n-nodes-base.mattermost` | Mattermost チャンネル/DM に通知 |

## セットアップ手順

1. **n8n にワークフローをインポート**: `growi-mention-notification.json` を n8n にインポート
2. **Credentials 設定**:
   - GROWI API Token (管理者ユーザーの `Settings > API Settings` から取得)
   - Slack Bot Token (Slack DM 通知を使う場合)
3. **GROWI 側の設定**:
   - `管理 > グローバル通知設定` で新しい通知を追加
   - トリガーパス: `/*` (全ページ) または特定パス
   - トリガーイベント: `PAGE_EDIT` にチェック
   - 通知先の Slack Webhook URL に n8n の Webhook URL を設定
4. **ワークフローを有効化**

## 制限事項・注意点

- GROWI のグローバル通知 Slack メッセージは Slack メッセージフォーマット (`<url|text>`) で送信されるため、Parse ノードはこの形式を前提としている
- 差分計算は行単位の簡易比較 (行の追加のみ検出)。より正確な差分が必要な場合は `diff` ライブラリを n8n の Code ノードに追加する
- `limit=2` で最新2リビジョンのみ取得するため、全コントリビューターを取得するには `limit` を増やすか別途 API コールが必要
- GROWI には外部から in-app 通知を作成する公開 API がないため、通知先は Slack/メール等の外部チャネルを使う
