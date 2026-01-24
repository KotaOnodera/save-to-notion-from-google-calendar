// スクリプトプロパティのキー定義。
const SCRIPT_PROPERTY_KEYS = {
  calendarId: 'CALENDAR_ID',
  notionDbId: 'NOTION_DB_ID',
  notionToken: 'NOTION_TOKEN',
  googleChatWebhookUrl: 'GOOGLE_CHAT_WEBHOOK_URL',
};

// Notionのプロパティ名（DBのスキーマに合わせて調整）。
const PROPERTY_NAMES = {
  title: 'Title',
  eventId: 'EventId',
  date: 'Date',
  location: 'Location',
  description: 'Description',
  type: 'Type',
  signature: 'Signature',
  updatedAt: 'UpdatedAt',
};

const NOTION_API_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

// メイン処理：GoogleカレンダーとNotionを双方向同期する。
// 競合時はGoogleカレンダーを優先。
function syncCalendarToNotion() {
  const config = getConfig_();
  const calendar = CalendarApp.getCalendarById(config.calendarId);
  if (!calendar) {
    throw new Error('Calendar not found. Check CALENDAR_ID.');
  }

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setMonth(rangeStart.getMonth() - 1);
  const rangeEnd = new Date(now);
  rangeEnd.setMonth(rangeEnd.getMonth() + 3);

  const events = calendar.getEvents(rangeStart, rangeEnd);
  // 既存ページをEventIdで引けるように事前ロード。
  const existingByEventId = fetchNotionPagesByEventId_(
    config.notionDbId,
    rangeStart,
    rangeEnd,
    config.notionToken
  );

  // 同期結果を詳細に追跡。
  const syncResult = {
    created: [],
    updatedNotion: [],
    updatedGCal: [],
    skipped: 0,
    failed: [],
  };

  events.forEach((event) => {
    const eventId = event.getId();
    if (!eventId) {
      return;
    }

    const eventTitle = event.getTitle() || 'Untitled';
    const eventDate = formatDateOnly_(event.getStartTime());
    const colorName = getEventColorName_(event);
    // GCalの現在データから署名を作成。
    const gcalSignature = buildSignature_(event, colorName);
    const existing = existingByEventId[eventId];

    if (!existing) {
      // 新規イベント：Notionに作成。
      const properties = buildNotionProperties_(event, gcalSignature, colorName);
      createNotionPage_(config.notionDbId, properties, config.notionToken);
      syncResult.created.push({ title: eventTitle, date: eventDate });
      return;
    }

    const storedSignature = existing.signature;

    if (gcalSignature !== storedSignature) {
      // GCalが変更された：GCal優先でNotionを更新。
      const properties = buildNotionProperties_(event, gcalSignature, colorName);
      updateNotionPage_(existing.pageId, properties, config.notionToken);
      syncResult.updatedNotion.push({ title: eventTitle, date: eventDate });
      return;
    }

    // GCalは変更なし：Notionの変更をチェック。
    const notionSignature = buildNotionPageSignature_(existing.page, eventId);

    if (notionSignature === storedSignature) {
      // 両方とも変更なし。
      syncResult.skipped += 1;
      return;
    }

    // Notionが変更された：GCalを更新。
    if (updateCalendarEvent_(calendar, eventId, existing.page)) {
      // GCal更新後、新しい署名を取得してNotionに保存。
      const updatedEvent = calendar.getEventById(eventId);
      const updatedColorName = getEventColorName_(updatedEvent);
      const newSignature = buildSignature_(updatedEvent, updatedColorName);
      updateNotionPageSignature_(existing.pageId, newSignature, config.notionToken);
      syncResult.updatedGCal.push({ title: eventTitle, date: eventDate });
    } else {
      Logger.log('Failed to update GCal event: ' + eventId);
      syncResult.failed.push({ title: eventTitle, date: eventDate, reason: 'GCal update failed' });
    }
  });

  Logger.log(
    'Created: %s, Updated Notion: %s, Updated GCal: %s, Skipped: %s, Failed: %s',
    syncResult.created.length,
    syncResult.updatedNotion.length,
    syncResult.updatedGCal.length,
    syncResult.skipped,
    syncResult.failed.length
  );

  // 同期結果をGoogle Chatに通知。
  sendSyncSummaryToGoogleChat_(syncResult, config.googleChatWebhookUrl);
}

// 1日1回のトリガーを作成（必要なら時刻は変更）。
function createDailyTrigger() {
  ScriptApp.newTrigger('syncCalendarToNotion')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
}

// スクリプトプロパティから設定を取得。
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  const calendarId = props.getProperty(SCRIPT_PROPERTY_KEYS.calendarId);
  const notionDbId = props.getProperty(SCRIPT_PROPERTY_KEYS.notionDbId);
  const notionToken = props.getProperty(SCRIPT_PROPERTY_KEYS.notionToken);
  const googleChatWebhookUrl = props.getProperty(SCRIPT_PROPERTY_KEYS.googleChatWebhookUrl);

  if (!calendarId || !notionDbId || !notionToken) {
    throw new Error('Missing script properties: CALENDAR_ID, NOTION_DB_ID, NOTION_TOKEN');
  }

  return {
    calendarId: calendarId,
    notionDbId: notionDbId,
    notionToken: notionToken,
    googleChatWebhookUrl: googleChatWebhookUrl || '',
  };
}

// 指定期間のNotionページを取得しEventIdでマップ化。
function fetchNotionPagesByEventId_(dbId, rangeStart, rangeEnd, token) {
  const map = {};
  let cursor = null;

  const startDate = formatDateOnly_(rangeStart);
  const endDate = formatDateOnly_(rangeEnd);

  do {
    const payload = {
      page_size: 100,
      filter: {
        and: [
          {
            property: PROPERTY_NAMES.date,
            date: {
              on_or_after: startDate,
            },
          },
          {
            property: PROPERTY_NAMES.date,
            date: {
              on_or_before: endDate,
            },
          },
        ],
      },
    };

    if (cursor) {
      payload.start_cursor = cursor;
    }

    const response = notionRequest_('post', '/databases/' + dbId + '/query', payload, token);
    response.results.forEach((page) => {
      const eventId = getTextFromProperty_(page.properties[PROPERTY_NAMES.eventId]);
      if (!eventId) {
        return;
      }
      const signature = getTextFromProperty_(page.properties[PROPERTY_NAMES.signature]);
      map[eventId] = {
        pageId: page.id,
        signature: signature || '',
        page: page,
      };
    });

    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  return map;
}

// カレンダーイベントからNotionのプロパティを構築。
function buildNotionProperties_(event, signature, colorName) {
  const props = {};
  const title = event.getTitle() || 'Untitled';
  const description = event.getDescription() || '';
  const location = event.getLocation() || '';
  const isAllDay = event.isAllDayEvent();
  const start = event.getStartTime();
  const end = event.getEndTime();

  addTitleProperty_(props, PROPERTY_NAMES.title, title);
  addRichTextProperty_(props, PROPERTY_NAMES.eventId, event.getId());
  addDateRangeProperty_(props, PROPERTY_NAMES.date, start, end, isAllDay);
  addRichTextProperty_(props, PROPERTY_NAMES.location, location);
  addRichTextProperty_(props, PROPERTY_NAMES.description, description);
  addSelectProperty_(props, PROPERTY_NAMES.type, colorName);
  addRichTextProperty_(props, PROPERTY_NAMES.signature, signature);
  addDateProperty_(props, PROPERTY_NAMES.updatedAt, new Date(), false);

  return props;
}

// 差分判定用の署名を作成。
function buildSignature_(event, colorName) {
  const payload = {
    id: event.getId(),
    title: event.getTitle() || '',
    start: toNotionDateValue_(event.getStartTime(), event.isAllDayEvent()),
    end: toNotionDateValue_(event.getEndTime(), event.isAllDayEvent()),
    location: event.getLocation() || '',
    description: event.getDescription() || '',
    color: colorName || '',
    allDay: event.isAllDayEvent(),
  };

  const json = JSON.stringify(payload);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    json,
    Utilities.Charset.UTF_8
  );
  return digest.map(byteToHex_).join('');
}

// EventColorをNotionのSelect用名称に変換。
function getEventColorName_(event) {
  const color = event.getColor();
  if (!color) {
    return '';
  }

  const keys = Object.keys(CalendarApp.EventColor);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (CalendarApp.EventColor[key] === color) {
      return key;
    }
  }

  return String(color);
}

// Notion DBに新規ページを作成。
function createNotionPage_(dbId, properties, token) {
  const payload = {
    parent: { database_id: dbId },
    properties: properties,
  };
  notionRequest_('post', '/pages', payload, token);
}

// 既存のNotionページを更新。
function updateNotionPage_(pageId, properties, token) {
  const payload = {
    properties: properties,
  };
  notionRequest_('patch', '/pages/' + pageId, payload, token);
}

// Notion APIリクエストの共通処理。
function notionRequest_(method, path, payload, token) {
  const options = {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_API_VERSION,
    },
    muteHttpExceptions: true,
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(NOTION_BASE_URL + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Notion API error ' + code + ': ' + text);
  }

  return text ? JSON.parse(text) : {};
}

// Notionプロパティを組み立てるヘルパー。
function addTitleProperty_(props, name, value) {
  if (!name) {
    return;
  }
  props[name] = {
    title: value ? [{ text: { content: value } }] : [],
  };
}

// Notionプロパティを組み立てるヘルパー。
function addRichTextProperty_(props, name, value) {
  if (!name) {
    return;
  }
  if (!value) {
    props[name] = { rich_text: [] };
    return;
  }
  props[name] = {
    rich_text: [{ text: { content: value } }],
  };
}

// Notionプロパティを組み立てるヘルパー。
function addSelectProperty_(props, name, value) {
  if (!name) {
    return;
  }
  if (!value) {
    props[name] = { select: null };
    return;
  }
  props[name] = {
    select: { name: value },
  };
}

// Notionプロパティを組み立てるヘルパー（単一日付）。
function addDateProperty_(props, name, date, isAllDay) {
  if (!name) {
    return;
  }
  props[name] = {
    date: {
      start: toNotionDateValue_(date, isAllDay),
    },
  };
}

// Notionプロパティを組み立てるヘルパー（日付範囲）。
function addDateRangeProperty_(props, name, startDate, endDate, isAllDay) {
  if (!name) {
    return;
  }
  props[name] = {
    date: {
      start: toNotionDateValue_(startDate, isAllDay),
      end: toNotionDateValue_(endDate, isAllDay),
    },
  };
}

// 日付形式をNotion向けに正規化。
function toNotionDateValue_(date, isAllDay) {
  if (!date) {
    return null;
  }
  if (isAllDay) {
    return formatDateOnly_(date);
  }
  return formatDateTime_(date);
}

// 日付（yyyy-MM-dd）へ整形。
function formatDateOnly_(date) {
  const timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

// 日時（ISO）へ整形。
function formatDateTime_(date) {
  const timeZone = Session.getScriptTimeZone();
  return Utilities.formatDate(date, timeZone, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

// Notionプロパティから文字列を抽出。
function getTextFromProperty_(property) {
  if (!property) {
    return '';
  }
  if (property.type === 'title') {
    return property.title.map((item) => item.plain_text).join('');
  }
  if (property.type === 'rich_text') {
    return property.rich_text.map((item) => item.plain_text).join('');
  }
  if (property.type === 'select') {
    return property.select ? property.select.name : '';
  }
  return '';
}

// バイト配列を16進文字列に変換。
function byteToHex_(byte) {
  const value = (byte + 256) % 256;
  return ('0' + value.toString(16)).slice(-2);
}

// Notionページデータから署名を作成（双方向同期用）。
function buildNotionPageSignature_(page, eventId) {
  const props = page.properties;
  const title = getTextFromProperty_(props[PROPERTY_NAMES.title]) || '';
  const dateProperty = props[PROPERTY_NAMES.date]?.date;
  const startRaw = dateProperty?.start || '';
  const endRaw = dateProperty?.end || '';
  const location = getTextFromProperty_(props[PROPERTY_NAMES.location]) || '';
  const description = getTextFromProperty_(props[PROPERTY_NAMES.description]) || '';
  const colorName = getTextFromProperty_(props[PROPERTY_NAMES.type]) || '';

  // 日付形式から終日イベントかを判定。
  const isAllDay = startRaw && !startRaw.includes('T');

  // Notion APIの日付形式をGCal署名と同じ形式に正規化。
  const start = normalizeNotionDate_(startRaw, isAllDay);
  const end = normalizeNotionDate_(endRaw, isAllDay);

  const payload = {
    id: eventId,
    title: title,
    start: start,
    end: end,
    location: location,
    description: description,
    color: colorName,
    allDay: isAllDay,
  };

  const json = JSON.stringify(payload);
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    json,
    Utilities.Charset.UTF_8
  );
  return digest.map(byteToHex_).join('');
}

// Notion APIの日付文字列をGCal署名と同じ形式に正規化。
function normalizeNotionDate_(dateStr, isAllDay) {
  if (!dateStr) {
    return '';
  }
  const date = new Date(dateStr);
  return toNotionDateValue_(date, isAllDay);
}

// NotionページのデータでGoogleカレンダーイベントを更新。
function updateCalendarEvent_(calendar, eventId, notionPage) {
  const event = calendar.getEventById(eventId);
  if (!event) {
    Logger.log('Event not found in calendar: ' + eventId);
    return false;
  }

  const props = notionPage.properties;
  const title = getTextFromProperty_(props[PROPERTY_NAMES.title]) || 'Untitled';
  const dateProperty = props[PROPERTY_NAMES.date]?.date;
  const startStr = dateProperty?.start;
  const endStr = dateProperty?.end || startStr;
  const location = getTextFromProperty_(props[PROPERTY_NAMES.location]) || '';
  const description = getTextFromProperty_(props[PROPERTY_NAMES.description]) || '';

  event.setTitle(title);
  event.setLocation(location);
  event.setDescription(description);

  if (startStr) {
    const isAllDay = !startStr.includes('T');
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (isAllDay) {
      event.setAllDayDates(startDate, endDate);
    } else {
      event.setTime(startDate, endDate);
    }
  }

  return true;
}

// Notionページの署名のみを更新（Notion→GCal同期後）。
function updateNotionPageSignature_(pageId, signature, token) {
  const props = {};
  addRichTextProperty_(props, PROPERTY_NAMES.signature, signature);
  addDateProperty_(props, PROPERTY_NAMES.updatedAt, new Date(), false);
  updateNotionPage_(pageId, props, token);
}

// 同期結果のサマリーをGoogle Chatに送信。
function sendSyncSummaryToGoogleChat_(syncResult, webhookUrl) {
  if (!webhookUrl) {
    Logger.log('Google Chat Webhook URL is not configured. Skipping notification.');
    return;
  }

  const totalChanges =
    syncResult.created.length +
    syncResult.updatedNotion.length +
    syncResult.updatedGCal.length;

  // 変更がない場合は通知しない。
  if (totalChanges === 0 && syncResult.failed.length === 0) {
    Logger.log('No changes to report. Skipping Google Chat notification.');
    return;
  }

  const message = buildSyncSummaryMessage_(syncResult);

  const payload = {
    text: message,
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(webhookUrl, options);
  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    Logger.log('Failed to send Google Chat notification: ' + code + ' - ' + response.getContentText());
  } else {
    Logger.log('Google Chat notification sent successfully.');
  }
}

// 同期サマリーメッセージを構築。
function buildSyncSummaryMessage_(syncResult) {
  const timeZone = Session.getScriptTimeZone();
  const timestamp = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd HH:mm:ss');

  const lines = [];
  lines.push('📅 *カレンダー同期完了* (' + timestamp + ')');
  lines.push('');

  // サマリー行。
  lines.push(
    '📊 *サマリー*: 新規 ' +
      syncResult.created.length +
      ' / GCal→Notion ' +
      syncResult.updatedNotion.length +
      ' / Notion→GCal ' +
      syncResult.updatedGCal.length +
      ' / スキップ ' +
      syncResult.skipped
  );

  // 新規作成。
  if (syncResult.created.length > 0) {
    lines.push('');
    lines.push('🆕 *新規作成* (' + syncResult.created.length + '件)');
    syncResult.created.forEach(function (item) {
      lines.push('  • ' + item.date + ' ' + item.title);
    });
  }

  // GCal→Notion更新。
  if (syncResult.updatedNotion.length > 0) {
    lines.push('');
    lines.push('📤 *GCal→Notion更新* (' + syncResult.updatedNotion.length + '件)');
    syncResult.updatedNotion.forEach(function (item) {
      lines.push('  • ' + item.date + ' ' + item.title);
    });
  }

  // Notion→GCal更新。
  if (syncResult.updatedGCal.length > 0) {
    lines.push('');
    lines.push('📥 *Notion→GCal更新* (' + syncResult.updatedGCal.length + '件)');
    syncResult.updatedGCal.forEach(function (item) {
      lines.push('  • ' + item.date + ' ' + item.title);
    });
  }

  // 失敗。
  if (syncResult.failed.length > 0) {
    lines.push('');
    lines.push('❌ *失敗* (' + syncResult.failed.length + '件)');
    syncResult.failed.forEach(function (item) {
      lines.push('  • ' + item.date + ' ' + item.title + ' - ' + item.reason);
    });
  }

  return lines.join('\n');
}
