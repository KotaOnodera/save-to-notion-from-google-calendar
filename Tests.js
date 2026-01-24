// ---- テスト（GAS内の簡易テスト関数） ----

// テストをまとめて実行する。
function runTests() {
  test_buildSignature_changesOnTitle();
  test_getEventColorName();
  test_buildNotionProperties_allDayDate();
  test_buildNotionPageSignature_matchesGCalSignature();
  test_buildNotionPageSignature_normalizesUtcDate();
  test_buildSyncSummaryMessage_containsAllSections();
  test_buildSyncSummaryMessage_emptyWhenNoChanges();
  Logger.log('All tests passed.');
}

// 署名がタイトル変更で変わることを確認。
function test_buildSignature_changesOnTitle() {
  const base = makeFakeEvent_({
    id: 'event-1',
    title: 'Title A',
    start: new Date('2024-01-01T10:00:00+09:00'),
    end: new Date('2024-01-01T11:00:00+09:00'),
    allDay: false,
  });
  const colorName = 'PALE_BLUE';
  const sig1 = buildSignature_(base, colorName);

  const changed = makeFakeEvent_({
    id: 'event-1',
    title: 'Title B',
    start: new Date('2024-01-01T10:00:00+09:00'),
    end: new Date('2024-01-01T11:00:00+09:00'),
    allDay: false,
  });
  const sig2 = buildSignature_(changed, colorName);

  assertNotEqual_(sig1, sig2, 'signature should change when title changes');
}

// カレンダーの色名が取得できることを確認。
function test_getEventColorName() {
  const color = CalendarApp.EventColor.PALE_BLUE;
  const fake = makeFakeEvent_({ color: color });
  const name = getEventColorName_(fake);
  assertEqual_(name, 'PALE_BLUE', 'color name should match enum key');
}

// 終日イベントが日付のみで保存されることを確認。
function test_buildNotionProperties_allDayDate() {
  const start = new Date('2024-02-01T00:00:00+09:00');
  const end = new Date('2024-02-02T00:00:00+09:00');
  const fake = makeFakeEvent_({
    id: 'event-2',
    title: 'All Day',
    start: start,
    end: end,
    allDay: true,
  });
  const props = buildNotionProperties_(fake, 'sig', 'PALE_GREEN');
  const dateProperty = props[PROPERTY_NAMES.date].date;

  assertEqual_(dateProperty.start, formatDateOnly_(start), 'all-day start should be date-only');
  assertEqual_(dateProperty.end, formatDateOnly_(end), 'all-day end should be date-only');
}

// GCalとNotionの署名が同じデータで一致することを確認。
function test_buildNotionPageSignature_matchesGCalSignature() {
  const eventId = 'event-3';
  const title = 'Meeting';
  const start = new Date('2024-03-01T14:00:00+09:00');
  const end = new Date('2024-03-01T15:00:00+09:00');
  const location = 'Room A';
  const description = 'Weekly sync';
  const colorName = 'PALE_BLUE';

  // GCalイベントから署名を作成。
  const fakeEvent = makeFakeEvent_({
    id: eventId,
    title: title,
    start: start,
    end: end,
    location: location,
    description: description,
    allDay: false,
  });
  const gcalSignature = buildSignature_(fakeEvent, colorName);

  // 同じデータを持つNotionページを模擬。
  const fakePage = {
    properties: {},
  };
  fakePage.properties[PROPERTY_NAMES.title] = {
    type: 'title',
    title: [{ plain_text: title }],
  };
  fakePage.properties[PROPERTY_NAMES.date] = {
    date: {
      start: formatDateTime_(start),
      end: formatDateTime_(end),
    },
  };
  fakePage.properties[PROPERTY_NAMES.location] = {
    type: 'rich_text',
    rich_text: [{ plain_text: location }],
  };
  fakePage.properties[PROPERTY_NAMES.description] = {
    type: 'rich_text',
    rich_text: [{ plain_text: description }],
  };
  fakePage.properties[PROPERTY_NAMES.type] = {
    type: 'select',
    select: { name: colorName },
  };

  const notionSignature = buildNotionPageSignature_(fakePage, eventId);

  assertEqual_(
    notionSignature,
    gcalSignature,
    'Notion signature should match GCal signature for same data'
  );
}

// Notion APIがUTC形式で返しても署名が一致することを確認。
function test_buildNotionPageSignature_normalizesUtcDate() {
  const eventId = 'event-4';
  const title = 'UTC Test';
  // JST 2024-03-01 14:00 = UTC 2024-03-01 05:00
  const start = new Date('2024-03-01T14:00:00+09:00');
  const end = new Date('2024-03-01T15:00:00+09:00');
  const location = '';
  const description = '';
  const colorName = '';

  // GCalイベントから署名を作成。
  const fakeEvent = makeFakeEvent_({
    id: eventId,
    title: title,
    start: start,
    end: end,
    location: location,
    description: description,
    allDay: false,
  });
  const gcalSignature = buildSignature_(fakeEvent, colorName);

  // Notion APIが返すUTC形式（ミリ秒付き）を模擬。
  const fakePage = {
    properties: {},
  };
  fakePage.properties[PROPERTY_NAMES.title] = {
    type: 'title',
    title: [{ plain_text: title }],
  };
  fakePage.properties[PROPERTY_NAMES.date] = {
    date: {
      start: '2024-03-01T05:00:00.000Z',
      end: '2024-03-01T06:00:00.000Z',
    },
  };
  fakePage.properties[PROPERTY_NAMES.location] = {
    type: 'rich_text',
    rich_text: [],
  };
  fakePage.properties[PROPERTY_NAMES.description] = {
    type: 'rich_text',
    rich_text: [],
  };
  fakePage.properties[PROPERTY_NAMES.type] = {
    type: 'select',
    select: null,
  };

  const notionSignature = buildNotionPageSignature_(fakePage, eventId);

  assertEqual_(
    notionSignature,
    gcalSignature,
    'Notion signature with UTC date should match GCal signature'
  );
}

// テスト用の疑似イベントを生成する。
function makeFakeEvent_(overrides) {
  const data = Object.assign(
    {
      id: 'event-id',
      title: 'Title',
      description: '',
      location: '',
      start: new Date(),
      end: new Date(),
      allDay: false,
      color: CalendarApp.EventColor.PALE_BLUE,
    },
    overrides || {}
  );

  return {
    getId: function () {
      return data.id;
    },
    getTitle: function () {
      return data.title;
    },
    getDescription: function () {
      return data.description;
    },
    getLocation: function () {
      return data.location;
    },
    getStartTime: function () {
      return data.start;
    },
    getEndTime: function () {
      return data.end;
    },
    isAllDayEvent: function () {
      return data.allDay;
    },
    getColor: function () {
      return data.color;
    },
  };
}

function assertEqual_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error('Assertion failed: ' + message + ' (actual=' + actual + ', expected=' + expected + ')');
  }
}

function assertNotEqual_(actual, expected, message) {
  if (actual === expected) {
    throw new Error('Assertion failed: ' + message + ' (actual=' + actual + ', expected=' + expected + ')');
  }
}

function assertTrue_(condition, message) {
  if (!condition) {
    throw new Error('Assertion failed: ' + message);
  }
}

// 同期サマリーメッセージに各セクションが含まれることを確認。
function test_buildSyncSummaryMessage_containsAllSections() {
  const syncResult = {
    created: [{ title: 'New Event', date: '2024-01-15' }],
    updatedNotion: [{ title: 'Updated to Notion', date: '2024-01-16' }],
    updatedGCal: [{ title: 'Updated to GCal', date: '2024-01-17' }],
    skipped: 5,
    failed: [{ title: 'Failed Event', date: '2024-01-18', reason: 'GCal update failed' }],
  };

  const message = buildSyncSummaryMessage_(syncResult);

  assertTrue_(message.includes('カレンダー同期完了'), 'should include header');
  assertTrue_(message.includes('サマリー'), 'should include summary');
  assertTrue_(message.includes('新規作成'), 'should include created section');
  assertTrue_(message.includes('New Event'), 'should include created event title');
  assertTrue_(message.includes('GCal→Notion更新'), 'should include updatedNotion section');
  assertTrue_(message.includes('Updated to Notion'), 'should include updatedNotion event title');
  assertTrue_(message.includes('Notion→GCal更新'), 'should include updatedGCal section');
  assertTrue_(message.includes('Updated to GCal'), 'should include updatedGCal event title');
  assertTrue_(message.includes('失敗'), 'should include failed section');
  assertTrue_(message.includes('Failed Event'), 'should include failed event title');
  assertTrue_(message.includes('スキップ 5'), 'should include skipped count');
}

// 変更がない場合でもサマリー行は出力されることを確認。
function test_buildSyncSummaryMessage_emptyWhenNoChanges() {
  const syncResult = {
    created: [],
    updatedNotion: [],
    updatedGCal: [],
    skipped: 10,
    failed: [],
  };

  const message = buildSyncSummaryMessage_(syncResult);

  assertTrue_(message.includes('カレンダー同期完了'), 'should include header');
  assertTrue_(message.includes('サマリー'), 'should include summary');
  assertTrue_(message.includes('新規 0'), 'should show 0 created');
  assertTrue_(message.includes('スキップ 10'), 'should show skipped count');
  assertTrue_(!message.includes('新規作成'), 'should not include created section when empty');
  assertTrue_(!message.includes('GCal→Notion更新'), 'should not include updatedNotion section when empty');
}
