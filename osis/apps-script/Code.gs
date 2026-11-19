const DATA_SHEET_NAMES_ = ['events', 'feedback', 'settings'];
const MAX_EVENTS_ = 200;
const MAX_FEEDBACK_ = 5000;
const MAX_ANSWER_LENGTH_ = 2000;
const MAX_POSTER_BYTES_ = 10 * 1024 * 1024;
const BEFORE_QUESTIONS_ = [
  'Apa yang kamu harapkan dari acara ini?',
  'Kegiatan apa yang ingin kamu lihat?',
  'Apa yang perlu diperhatikan OSIS sebelum acara dimulai?',
  'Apa saranmu agar acara berjalan baik?'
];
const SESSION_TTL_SECONDS_ = 1800;
const LOGIN_WINDOW_SECONDS_ = 900;
const LOGIN_GLOBAL_ATTEMPT_LIMIT_ = 30;
const LOGIN_MAX_CONCURRENT_ = 3;
const LOGIN_IN_FLIGHT_TTL_SECONDS_ = 60;
const PASSWORD_HASH_VERSION_ = 'pbkdf2-sha256-v1';
const LEGACY_PASSWORD_HASH_VERSION_ = 'legacy-sha256-v1';
const PASSWORD_KDF_ITERATIONS_ = 20000; // 20.000 iterasi = ~2-3 detik di Apps Script, tetap aman karena ada rate limiter 8 percobaan

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Kritik & Saran')
    .addItem('Siapkan database', 'initializeBackend')
    .addItem('Atur akun operator', 'openAdminSetup')
    .addToUi();
}

function initializeBackend() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Buka Apps Script dari Google Sheet yang akan dipakai.');

  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensureSheets_(spreadsheet);
  if (!properties.getProperty('ADMIN_EMAIL') && !properties.getProperty('SETUP_TOKEN')) {
    properties.setProperty('SETUP_TOKEN', Utilities.getUuid() + Utilities.getUuid());
  }
  spreadsheet.toast('Database siap. Gunakan menu Kritik & Saran untuk mengatur akun operator.');
}

function openAdminSetup() {
  initializeBackend();
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('ADMIN_EMAIL')) {
    SpreadsheetApp.getUi().alert('Akun operator sudah dibuat. Untuk mengubah kata sandi, gunakan Portal OSIS.');
    return;
  }

  const template = HtmlService.createTemplateFromFile('AdminSetup');
  template.setupToken = properties.getProperty('SETUP_TOKEN');
  SpreadsheetApp.getUi().showModalDialog(
    template.evaluate().setWidth(420).setHeight(420),
    'Atur akun operator'
  );
}

function saveAdminFromSetup(setupToken, email, password) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const properties = PropertiesService.getScriptProperties();
    if (!setupToken || setupToken !== properties.getProperty('SETUP_TOKEN')) {
      throw new Error('Sesi setup tidak berlaku. Tutup dialog lalu buka kembali dari menu Google Sheet.');
    }
    if (properties.getProperty('ADMIN_EMAIL')) throw new Error('Akun operator sudah dibuat.');

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Masukkan alamat email yang valid.');
    }
    if (normalizedPassword.length < 12 || normalizedPassword.length > 256) {
      throw new Error('Kata sandi harus antara 12 dan 256 karakter.');
    }

    const salt = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperties({
      ADMIN_EMAIL: normalizedEmail,
      ADMIN_PASSWORD_SALT: salt,
      ADMIN_PASSWORD_HASH: hashPasswordPbkdf2_(normalizedPassword, salt, PASSWORD_KDF_ITERATIONS_),
      ADMIN_PASSWORD_HASH_VERSION: PASSWORD_HASH_VERSION_,
      ADMIN_PASSWORD_ITERATIONS: String(PASSWORD_KDF_ITERATIONS_)
    });
    properties.deleteProperty('SETUP_TOKEN');
    return 'Akun operator berhasil dibuat.';
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  if (!PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')) {
    return HtmlService.createHtmlOutput('Database belum disiapkan. Jalankan Siapkan database dari Google Sheet.');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Kritik & Saran — SMA Yos Sudarso Karawang')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  let request;
  try {
    request = JSON.parse(e && e.postData && e.postData.contents || '');
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Permintaan API tidak valid.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Permintaan API tidak valid.' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(api(request.name, request.args))
    .setMimeType(ContentService.MimeType.JSON);
}

function api(name, args) {
  try {
    const data = dispatch_(String(name || ''), args && typeof args === 'object' ? args : {});
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  } catch (error) {
    console.error('Apps Script API gagal:', error);
    return JSON.stringify({ ok: false, error: String(error.message || 'Operasi database gagal.') });
  }
}

function dispatch_(name, args) {
  switch (name) {
    case 'get_data':
      return readData_();
    case 'admin_login':
      return login_(args);
    case 'admin_logout':
      logout_(args.p_token);
      return true;
    case 'is_admin':
      return Boolean(getSession_(args.p_token));
    case 'admin_change_password':
      requireAdmin_(args.p_token);
      return changePassword_(args.p_password);
    case 'submit_feedback':
      return submitFeedback_(args);
    case 'admin_save_data':
      requireAdmin_(args.p_token);
      throw new Error('Simpan data penuh sudah tidak didukung. Muat ulang halaman sebelum mengubah event.');
    case 'admin_save_event':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        const state = readData_();
        state.events = normalizeEvents_(state.events);
        const submitted = normalizeEvents_([args.p_event])[0];
        const index = state.events.findIndex(function (event) { return event.id === submitted.id; });

        if (index >= 0) {
          const current = state.events[index];
          if (typeof args.p_original_open_before !== 'boolean' ||
              submitted.openBefore === args.p_original_open_before) {
            submitted.openBefore = current.openBefore;
          }
          if (typeof args.p_original_open_after !== 'boolean' ||
              submitted.openAfter === args.p_original_open_after) {
            submitted.openAfter = current.openAfter;
          }
          submitted.open = submitted.openBefore || submitted.openAfter;
          state.events[index] = submitted;
        } else {
          state.events.unshift(submitted);
        }

        state.settings = normalizeSettings_(state.settings);
        writeData_(state);
        return true;
      });
    case 'admin_set_event_phase':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        const phase = String(args.p_phase || '');
        if (phase !== 'before' && phase !== 'after') throw new Error('Tahap formulir tidak valid.');
        if (typeof args.p_open !== 'boolean') throw new Error('Status formulir tidak valid.');

        const state = readData_();
        state.events = normalizeEvents_(state.events);
        const event = state.events.find(function (item) { return item.id === String(args.p_event_id || ''); });
        if (!event) throw new Error('Event tidak ditemukan.');

        if (phase === 'before') event.openBefore = args.p_open;
        else event.openAfter = args.p_open;
        event.open = event.openBefore || event.openAfter;
        state.settings = normalizeSettings_(state.settings);
        writeData_(state);
        return true;
      });
    case 'admin_delete_event':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        const state = readData_();
        state.events = state.events.filter(function (event) { return event.id !== args.p_event_id; });
        state.feedback = state.feedback.filter(function (item) { return item.eventId !== args.p_event_id; });
        writeData_(state);
        return true;
      });
    case 'admin_reply_feedback':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        const state = readData_();
        const item = state.feedback.find(function (feedback) { return feedback.id === args.p_feedback_id; });
        if (!item) throw new Error('Masukan tidak ditemukan.');
        item.reply = String(args.p_reply || '').trim();
        item.replyAt = Date.now();
        writeData_(state);
        return true;
      });
    case 'admin_delete_feedback':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        const state = readData_();
        state.feedback = state.feedback.filter(function (item) { return item.id !== args.p_feedback_id; });
        writeData_(state);
        return true;
      });
    case 'admin_import_data':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        writeData_(normalizeState_(args.p_data));
        return true;
      });
    case 'admin_wipe_data':
      requireAdmin_(args.p_token);
      return withLock_(function () {
        writeData_(emptyState_());
        return true;
      });
    default:
      throw new Error('Operasi database tidak dikenal.');
  }
}

function login_(args) {
  const properties = PropertiesService.getScriptProperties();
  const email = String(args.p_email || '').trim().toLowerCase();
  const password = String(args.p_password || '');
  if (email.length > 254 || password.length > 256) throw new Error('Email atau kata sandi salah.');
  const throttleKey = 'login_' + sha256_(email);
  const globalThrottleKey = 'login_global';
  const inFlightKey = 'login_in_flight';
  const cache = CacheService.getScriptCache();
  withLock_(function () {
    const attempts = Number(cache.get(throttleKey) || 0);
    const globalAttempts = Number(cache.get(globalThrottleKey) || 0);
    const inFlight = Number(cache.get(inFlightKey) || 0);
    if (attempts >= 8 || globalAttempts >= LOGIN_GLOBAL_ATTEMPT_LIMIT_ || inFlight >= LOGIN_MAX_CONCURRENT_) {
      throw new Error('Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    }
    cache.put(throttleKey, String(attempts + 1), LOGIN_WINDOW_SECONDS_);
    cache.put(globalThrottleKey, String(globalAttempts + 1), LOGIN_WINDOW_SECONDS_);
    cache.put(inFlightKey, String(inFlight + 1), LOGIN_IN_FLIGHT_TTL_SECONDS_);
  });

  try {
    const salt = properties.getProperty('ADMIN_PASSWORD_SALT');
    const expectedHash = properties.getProperty('ADMIN_PASSWORD_HASH');
    const storedEmail = properties.getProperty('ADMIN_EMAIL');
    const storedVersion = properties.getProperty('ADMIN_PASSWORD_HASH_VERSION') || LEGACY_PASSWORD_HASH_VERSION_;
    const storedIterations = storedVersion === PASSWORD_HASH_VERSION_
      ? passwordHashIterations_(properties)
      : null;
    let actualHash = '';
    if (salt && storedVersion === PASSWORD_HASH_VERSION_) {
      actualHash = hashPasswordPbkdf2_(password, salt, storedIterations);
    } else if (salt && storedVersion === LEGACY_PASSWORD_HASH_VERSION_) {
      actualHash = hashPasswordLegacy_(password, salt);
    } else if (storedVersion !== PASSWORD_HASH_VERSION_ && storedVersion !== LEGACY_PASSWORD_HASH_VERSION_) {
      throw new Error('Versi hash kata sandi tidak didukung.');
    }

    if (!salt || email !== storedEmail || !constantTimeEqual_(actualHash, expectedHash)) {
      throw new Error('Email atau kata sandi salah.');
    }
    const shouldUpgradeHash = storedVersion === LEGACY_PASSWORD_HASH_VERSION_ ||
      (storedIterations !== null && storedIterations < PASSWORD_KDF_ITERATIONS_);
    const upgradedHash = shouldUpgradeHash
      ? hashPasswordPbkdf2_(password, salt, PASSWORD_KDF_ITERATIONS_)
      : '';

    return withLock_(function () {
      if (properties.getProperty('ADMIN_EMAIL') !== storedEmail ||
          properties.getProperty('ADMIN_PASSWORD_SALT') !== salt ||
          properties.getProperty('ADMIN_PASSWORD_HASH') !== expectedHash ||
          (properties.getProperty('ADMIN_PASSWORD_HASH_VERSION') || LEGACY_PASSWORD_HASH_VERSION_) !== storedVersion ||
          (storedIterations !== null && (properties.getProperty('ADMIN_PASSWORD_ITERATIONS') || '') !== '' &&
           properties.getProperty('ADMIN_PASSWORD_ITERATIONS') !== String(storedIterations))) {
        throw new Error('Email atau kata sandi salah.');
      }

      if (shouldUpgradeHash) {
        properties.setProperties({
          ADMIN_PASSWORD_HASH: upgradedHash,
          ADMIN_PASSWORD_HASH_VERSION: PASSWORD_HASH_VERSION_,
          ADMIN_PASSWORD_ITERATIONS: String(PASSWORD_KDF_ITERATIONS_)
        });
      }

      cache.remove(throttleKey);
      const token = Utilities.getUuid() + Utilities.getUuid();
      const sessionVersion = properties.getProperty('ADMIN_SESSION_VERSION') || '0';
      cache.put('session_' + token, JSON.stringify({ email: email, version: sessionVersion }), SESSION_TTL_SECONDS_);
      return token;
    });
  } finally {
    withLock_(function () {
      const inFlight = Number(cache.get(inFlightKey) || 0);
      if (inFlight <= 1) cache.remove(inFlightKey);
      else cache.put(inFlightKey, String(inFlight - 1), LOGIN_IN_FLIGHT_TTL_SECONDS_);
    });
  }
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('session_' + String(token));
}

function getSession_(token) {
  if (!token || String(token).length > 100) return '';
  const cached = CacheService.getScriptCache().get('session_' + String(token));
  if (!cached) return '';

  const properties = PropertiesService.getScriptProperties();
  const currentVersion = properties.getProperty('ADMIN_SESSION_VERSION') || '0';
  try {
    const session = JSON.parse(cached);
    if (!session || typeof session.email !== 'string' || String(session.version) !== currentVersion) return '';
    return session.email;
  } catch (error) {
    return properties.getProperty('ADMIN_SESSION_VERSION') ? '' : cached;
  }
}

function requireAdmin_(token) {
  if (!getSession_(token)) throw new Error('Sesi operator berakhir. Silakan login kembali.');
}

function changePassword_(password) {
  const nextPassword = String(password || '');
  if (nextPassword.length < 12 || nextPassword.length > 256) {
    throw new Error('Kata sandi baru harus antara 12 dan 256 karakter.');
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const hash = hashPasswordPbkdf2_(nextPassword, salt, PASSWORD_KDF_ITERATIONS_);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const currentVersion = Number(properties.getProperty('ADMIN_SESSION_VERSION') || 0);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
      throw new Error('Versi sesi operator tidak valid.');
    }
    properties.setProperties({
      ADMIN_PASSWORD_SALT: salt,
      ADMIN_PASSWORD_HASH: hash,
      ADMIN_PASSWORD_HASH_VERSION: PASSWORD_HASH_VERSION_,
      ADMIN_PASSWORD_ITERATIONS: String(PASSWORD_KDF_ITERATIONS_),
      ADMIN_SESSION_VERSION: String(currentVersion + 1)
    });
    return true;
  } finally {
    lock.releaseLock();
  }
}

function submitFeedback_(args) {
  return withLock_(function () {
    const state = readData_();
    const id = String(args.p_id || '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('ID masukan tidak valid.');
    if (state.feedback.some(function (item) { return item.id === id; })) return true;

    const phase = String(args.p_phase || 'after');
    if (phase !== 'before' && phase !== 'after') throw new Error('Tahap masukan tidak valid.');
    const event = state.events.find(function (item) { return item.id === args.p_event_id; });
    const phaseOpen = event && (phase === 'before'
      ? (typeof event.openBefore === 'boolean' ? event.openBefore : event.open === true)
      : (typeof event.openAfter === 'boolean' ? event.openAfter : event.open === true));
    if (!event || !phaseOpen) throw new Error('Formulir ' + (phase === 'before' ? 'sebelum' : 'sesudah') + ' acara sudah ditutup atau tidak tersedia.');
    if (state.feedback.length >= MAX_FEEDBACK_) throw new Error('Batas jumlah masukan telah tercapai.');

    const questions = phase === 'before'
      ? normalizeQuestions_(Array.isArray(event.questionsBefore) && event.questionsBefore.length
        ? event.questionsBefore
        : BEFORE_QUESTIONS_)
      : normalizeQuestions_(Array.isArray(event.questions) && event.questions.length
        ? event.questions
        : emptyState_().settings.questionsDefault);
    const answers = args.p_answers;
    if (!Array.isArray(answers) || answers.length !== questions.length) {
      throw new Error('Jawaban formulir tidak valid.');
    }
    const normalizedAnswers = answers.map(function (answer, index) {
      const question = questions[index];
      const text = String(answer && answer.a || '').trim();
      if (!text) throw new Error('Setiap jawaban harus diisi.');
      if (text.length > MAX_ANSWER_LENGTH_) throw new Error('Setiap jawaban maksimal 2.000 karakter.');
      return { q: question, a: text };
    });
    state.feedback.unshift({
      id: id,
      eventId: event.id,
      phase: phase,
      answers: normalizedAnswers,
      at: Date.now(),
      reply: ''
    });
    writeData_(state);
    return true;
  });
}

function normalizeState_(data) {
  if (!data || typeof data !== 'object') throw new Error('Format cadangan tidak valid.');
  return {
    events: normalizeEvents_(data.events),
    feedback: normalizeFeedback_(data.feedback, data.events),
    settings: normalizeSettings_(data.settings)
  };
}

function normalizeEvents_(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS_) throw new Error('Daftar event tidak valid atau melebihi 200 event.');
  return events.map(function (event) {
    if (!event || typeof event !== 'object') throw new Error('Data event tidak valid.');
    const item = {
      id: String(event.id || ''),
      title: String(event.title || '').trim(),
      date: String(event.date || ''),
      emoji: String(event.emoji || '🎉').slice(0, 8),
      desc: String(event.desc || '').trim(),
      poster: normalizePoster_(event.poster),
      questionsBefore: normalizeQuestions_(Array.isArray(event.questionsBefore) && event.questionsBefore.length ? event.questionsBefore : BEFORE_QUESTIONS_),
      questions: normalizeQuestions_(Array.isArray(event.questions) && event.questions.length ? event.questions : emptyState_().settings.questionsDefault),
      openBefore: typeof event.openBefore === 'boolean' ? event.openBefore : event.open === true,
      openAfter: typeof event.openAfter === 'boolean' ? event.openAfter : event.open === true,
      created: Number(event.created) || Date.now()
    };
    item.open = item.openBefore || item.openAfter;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(item.id)) throw new Error('ID event tidak valid.');
    if (!item.title) throw new Error('Nama event wajib diisi.');
    return item;
  });
}

function normalizeQuestions_(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('Pertanyaan event tidak valid.');
  return questions.map(function (question) {
    const text = String(question || '').replace(/^\s*\d+\s*[.)-]\s*/, '').trim();
    if (!text) throw new Error('Pertanyaan tidak boleh kosong.');
    return text;
  });
}

function normalizeFeedback_(feedback, events) {
  if (!Array.isArray(feedback) || feedback.length > MAX_FEEDBACK_) throw new Error('Daftar masukan tidak valid atau terlalu besar.');
  const eventIds = new Set((Array.isArray(events) ? events : []).map(function (event) { return event.id; }));
  return feedback.map(function (entry) {
    if (!entry || typeof entry !== 'object' || !eventIds.has(entry.eventId)) throw new Error('Masukan mengacu pada event yang tidak ada.');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(entry.id || ''))) throw new Error('ID masukan tidak valid.');
    const answers = entry.answers;
    if (!Array.isArray(answers) || !answers.length) throw new Error('Jawaban masukan tidak valid.');
    return {
      id: String(entry.id),
      eventId: String(entry.eventId),
      answers: answers.map(function (answer) {
        const question = String(answer && answer.q || '').replace(/^\s*\d+\s*[.)-]\s*/, '').trim();
        const text = String(answer && answer.a || '').trim();
        if (!question || !text) throw new Error('Isi masukan tidak valid.');
        return { q: question, a: text };
      }),
      phase: entry.phase === 'before' ? 'before' : 'after',
      at: Number(entry.at) || Date.now(),
      reply: String(entry.reply || ''),
      replyAt: Number(entry.replyAt) || undefined
    };
  });
}

function normalizeSettings_(settings) {
  const questions = settings && settings.questionsDefault;
  return { questionsDefault: normalizeQuestions_(Array.isArray(questions) && questions.length ? questions : [
    'Bagaimana pendapatmu tentang acara ini?',
    'Apa yang paling kamu sukai?',
    'Apa yang perlu diperbaiki?',
    'Apa saranmu untuk acara berikutnya?'
  ]) };
}

function normalizePoster_(poster) {
  if (!poster) return '';
  const value = String(poster);
  const match = value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (match) {
    if (match[2].length > Math.ceil(MAX_POSTER_BYTES_ / 3) * 4) {
      throw new Error('Ukuran poster maksimal 10 MB.');
    }
    const bytes = Utilities.base64Decode(match[2]);
    if (bytes.length > MAX_POSTER_BYTES_) throw new Error('Ukuran poster maksimal 10 MB.');
    const blob = Utilities.newBlob(
      bytes,
      'image/' + match[1],
      'poster-' + Utilities.getUuid() + '.' + (match[1] === 'jpeg' ? 'jpg' : match[1])
    );
    const file = DriveApp.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (error) {
      file.setTrashed(true);
      throw new Error('Google Drive organisasi tidak mengizinkan poster publik. Minta admin Google mengizinkan berbagi file dengan link.');
    }
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  }
  if (/^https:\/\/drive\.google\.com\/uc\?export=view&id=[A-Za-z0-9_-]+$/.test(value)) return value;
  throw new Error('Format poster tidak valid.');
}

function readData_() {
  const spreadsheet = getSpreadsheet_();
  const events = readJsonRows_(spreadsheet.getSheetByName('events'));
  const feedback = readJsonRows_(spreadsheet.getSheetByName('feedback'));
  const settingsSheet = spreadsheet.getSheetByName('settings');
  const settingsText = settingsSheet.getRange('A2').getDisplayValue();
  const settings = settingsText ? JSON.parse(settingsText) : {};
  return { events: events, feedback: feedback, settings: normalizeSettings_(settings) };
}

function writeData_(state) {
  const spreadsheet = getSpreadsheet_();
  writeJsonRows_(spreadsheet.getSheetByName('events'), state.events);
  writeJsonRows_(spreadsheet.getSheetByName('feedback'), state.feedback);
  const settingsSheet = spreadsheet.getSheetByName('settings');
  settingsSheet.getRange('A2').setValue(JSON.stringify(state.settings));
  SpreadsheetApp.flush();
}

function emptyState_() {
  return {
    events: [],
    feedback: [],
    settings: {
      questionsDefault: [
        'Bagaimana pendapatmu tentang acara ini?',
        'Apa yang paling kamu sukai?',
        'Apa yang perlu diperbaiki?',
        'Apa saranmu untuk acara berikutnya?'
      ]
    }
  };
}

function ensureSheets_(spreadsheet) {
  DATA_SHEET_NAMES_.forEach(function (name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    if (!sheet.getRange('A1').getValue()) sheet.getRange('A1').setValue('json');
  });
  const settings = spreadsheet.getSheetByName('settings');
  if (!settings.getRange('A2').getValue()) settings.getRange('A2').setValue(JSON.stringify(emptyState_().settings));
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Database belum disiapkan. Jalankan Siapkan database dari Google Sheet.');
  return SpreadsheetApp.openById(id);
}

function readJsonRows_(sheet) {
  if (!sheet) throw new Error('Tab database tidak ditemukan. Jalankan Siapkan database dari Google Sheet.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    .map(function (row) { return row[0]; })
    .filter(function (value) { return typeof value === 'string' && value.trim(); })
    .map(function (value) { return JSON.parse(value); });
}

function writeJsonRows_(sheet, values) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 1).clearContent();
  if (values.length) {
    const rows = values.map(function (value) { return [JSON.stringify(value)]; });
    sheet.getRange(2, 1, rows.length, 1).setValues(rows);
  }
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function hashPasswordLegacy_(password, salt) {
  let value = String(salt) + ':' + String(password);
  for (let i = 0; i < 1200; i++) value = sha256_(value);
  return value;
}

function hashPasswordPbkdf2_(password, salt, iterations) {
  const passwordBytes = Utilities.newBlob(String(password)).getBytes();
  const saltBytes = Utilities.newBlob(String(salt)).getBytes().concat([0, 0, 0, 1]);
  let block = Utilities.computeHmacSha256Signature(saltBytes, passwordBytes);
  const result = block.slice();

  for (let round = 1; round < iterations; round++) {
    block = Utilities.computeHmacSha256Signature(block, passwordBytes);
    for (let index = 0; index < result.length; index++) {
      const left = (result[index] + 256) % 256;
      const right = (block[index] + 256) % 256;
      const value = left ^ right;
      result[index] = value > 127 ? value - 256 : value;
    }
  }
  return Utilities.base64Encode(result);
}

function passwordHashIterations_(properties) {
  const raw = properties.getProperty('ADMIN_PASSWORD_ITERATIONS');
  // Jika property belum ada (akun lama sebelum update keamanan), pakai nilai default
  if (raw === null || raw === undefined || raw === '') {
    return PASSWORD_KDF_ITERATIONS_;
  }
  const iterations = Number(raw);
  if (!Number.isInteger(iterations) || iterations < 5000 || iterations > 1000000) {
    throw new Error('Konfigurasi hash kata sandi tidak valid.');
  }
  return iterations;
}

function constantTimeEqual_(left, right) {
  const first = String(left || '');
  const second = String(right || '');
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index++) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
    .map(function (byte) {
      const unsigned = (byte + 256) % 256;
      return ('0' + unsigned.toString(16)).slice(-2);
    }).join('');
}
