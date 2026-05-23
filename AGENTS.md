# Repository Guidelines

## Project Structure & Module Organization

This Google Apps Script project synchronizes Google Calendar and a Notion database.

- `Code.js`: production sync logic, configuration lookup, Notion API helpers, trigger setup, and Google Chat notifications.
- `Tests.js`: GAS-native unit tests and fake calendar events.
- `appsscript.json`: manifest using Apps Script V8 and `Asia/Tokyo`.
- `README.md`: setup instructions for Notion, script properties, triggers, and notifications.
- `CLAUDE.md`: agent-facing architecture and workflow notes.

## Build, Test, and Development Commands

There is no local build. Run GAS functions in the Apps Script editor unless noted.

- `runTests()`: runs all tests in `Tests.js`; success logs `All tests passed.`
- `syncCalendarToNotion()`: runs sync manually after script properties and permissions are configured.
- `createDailyTrigger()`: creates the daily 03:00 local-time trigger.
- `clasp push`: pushes local files to the Apps Script project.
- `clasp pull`: pulls remote Apps Script changes into this repository.

## Coding Style & Naming Conventions

Use plain JavaScript compatible with Apps Script V8. Follow the current style: two-space indentation, semicolons, `const`/`let`, and single quotes. Keep constants in `UPPER_SNAKE_CASE` or grouped objects such as `SCRIPT_PROPERTY_KEYS` and `PROPERTY_NAMES`.

Private helpers use a trailing underscore, for example `buildSignature_()` and `notionRequest_()`. Test functions use the `test_...` prefix. Keep comments short and useful; existing comments are primarily Japanese, so match nearby language.

## Testing Guidelines

Add or update tests in `Tests.js` for signature generation, date normalization, Notion property mapping, sync summaries, and conflict-sensitive behavior. Use `makeFakeEvent_()` instead of real calendar data when possible. New tests must be called from `runTests()` and named `test_<unit>_<expectedBehavior>()`.

Because tests depend on GAS services such as `Utilities`, `Session`, and `CalendarApp`, verify them in the Apps Script editor or an equivalent GAS runtime.

## Commit & Pull Request Guidelines

The history currently contains only `initial commit`, so use concise, imperative messages going forward, for example `add sync summary tests` or `fix all-day date normalization`.

Pull requests should include a short description, required script property or Notion schema changes, `runTests()` evidence, and operational impact such as trigger or notification changes. Include screenshots or logs only when they clarify Apps Script authorization, triggers, or Google Chat behavior.

## Security & Configuration Tips

Do not commit secrets. Configure `CALENDAR_ID`, `NOTION_DB_ID`, `NOTION_TOKEN`, and optional `GOOGLE_CHAT_WEBHOOK_URL` as Apps Script properties. Treat Notion tokens and webhook URLs as credentials. When changing sync logic, preserve the conflict rule: Google Calendar wins when both sides changed.
