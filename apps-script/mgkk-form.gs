var NOTIFY_TO = 'info@mgkk-navi.com';
// 組合の窓口（通知の送り先・お客様の返信先・見積書の問い合わせ先）。Apps Script は mgkk6271@gmail.com のアカウントで動くが、このGmailは誰も見ていないため使わない
var FORM_ID = '1Sf1Qs0uK0aYLk9h9jADdwAFrR_SbwcxvaHBzM7K0-qU';
var SIM_URL = 'https://sato-mgkk.github.io/mgkk-fee-sim/';

// 料金（シミュレーターと同じ）
var SYS = 10000, SOFT = 5000, KYUYO_BASE = 3000, KYUYO_PER = 1000, TOKUTEI_RATE = 30000, OKURI = 5000;
// 入国時の初期費用（1名あたり。[下限, 上限]）
var PRE = 15000, POST = { A: [160000, 260000], B: [100000, 160000] }, AIR = [70000, 100000], TRAVEL = 30000, INS = [20000, 33000], NINTEI = 6100,
  GYOSEI = [55000, 200000], A2KOSHU = [100000, 200000], A2HOSHO = 60000;
// 特定技能の支援委託：一括契約（1名・月）と、業務ごとの個別依頼の単価（支援委託手数料に係る説明書）
var SHIEN_PKG = 30000, SHIEN_ITEMS = [
  ['（入国前）事前ガイダンスの実施代行', 2500], ['出入国時の送迎1回（2人まで）', 2500], ['（入国後）生活ガイダンスの実施代行', 5500],
  ['日本語学習の実施支援', 11000], ['預貯金口座の開設手続き', 5500], ['住居調査、契約、入居手続き', 5500],
  ['携帯電話契約・購入手続き', 5500], ['行政機関への手続き', 5500], ['苦情受付／定期面談', 11000], ['非自発的離職時の転職支援', 5500]];
var SHIEN_EACH = SHIEN_ITEMS.reduce(function (a, x) { return a + x[1]; }, 0);
function ikuseiRate(n) { if (n <= 1) return 50000; if (n <= 2) return 40000; if (n <= 5) return 35000; if (n <= 10) return 33000; if (n <= 15) return 31000; return 30000; }
function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
function rng(lo, hi) { return lo === hi ? yen(lo) : yen(lo) + '〜' + yen(hi); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** 1回だけ実行：フォームの題名・説明を「申し込み」用に変更 */
function updateForm() {
  var form = FormApp.openById(FORM_ID);
  form.setTitle('MGKK お申し込み');
  form.setDescription('料金シミュレーターの内容が自動で入っています。ご担当者・連絡先をご入力のうえ送信してください。\n送信後、ご入力のメールアドレスに「お申し込み受付」と月額お見積書（PDF）を自動でお送りします。');
  form.setConfirmationMessage('お申し込みを受け付けました。ご入力のメールアドレスに受付メールと月額お見積書（PDF）をお送りしました。内容を確認のうえ、組合よりご連絡いたします。');
  Logger.log('フォームを更新しました');
}

/** テスト用：サンプルの見積書PDFを組合のGmailに送る */
function testPdf() {
  var d = { company: 'テスト株式会社', person: 'テスト太郎', tel: '000-0000-0000', email: NOTIFY_TO, ikusei: 2, tokutei: 5, soft: true, kyuyo: true,
    ny: 2, pat: 'B', a2: true, a2koshu: false, note: '' };
  MailApp.sendEmail({ to: NOTIFY_TO, subject: '【テスト】月額お見積書PDF', body: 'テスト用の見積書PDFです。', attachments: [makePdf(d, new Date())] });
}

/** テスト用：特定技能のサンプル見積書PDFを組合のGmailに送る */
function testPdfTokutei() {
  var d = { company: 'テスト株式会社', person: 'テスト太郎', tel: '000-0000-0000', email: NOTIFY_TO, ikusei: 0, tokutei: 2, soft: false, kyuyo: false,
    mode: 'tk', plan: 'pkg', items: SHIEN_ITEMS, note: '' };
  MailApp.sendEmail({ to: NOTIFY_TO, subject: '【テスト】特定技能 お見積書PDF', body: 'テスト用の見積書PDFです。', attachments: [makePdf(d, new Date())] });
}

function onFormSubmit(e) {
  var d = { company: '', person: '', tel: '', email: '', ikusei: 0, tokutei: 0, soft: false, kyuyo: false, note: '', options: '' };
  var lines = [];
  e.response.getItemResponses().forEach(function (r) {
    var t = r.getItem().getTitle(), v = String(r.getResponse());
    lines.push('■' + t + '\n' + v);
    if (t === '会社名') d.company = v;
    else if (t === 'ご担当者名') d.person = v;
    else if (t === '電話番号') d.tel = v;
    else if (t === 'メールアドレス') d.email = v.trim();
    else if (t.indexOf('育成就労') === 0) d.ikusei = Math.max(0, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0);
    else if (t.indexOf('特定技能') === 0) d.tokutei = Math.max(0, parseInt(v.replace(/[^0-9]/g, ''), 10) || 0);
    else if (t === '選択オプション') d.options = v;
    else if (t.indexOf('月額合計') === 0) d.total = v;
    else if (t === 'ご要望・備考') d.note = v;
  });
  d.soft = d.options.indexOf('在留申請書類ソフト') >= 0;
  d.kyuyo = d.options.indexOf('給与計算') >= 0;
  // 入国諸費用：シミュレーターが送る「【入国諸費用】新規入国 N名・日本語Bパターン・…」の行から読む
  var m = d.options.match(/新規入国\s*(\d+)\s*名/);
  d.ny = m ? parseInt(m[1], 10) : d.ikusei;
  d.a2 = d.options.indexOf('来日前A2') >= 0;
  d.pat = (!d.a2 && d.options.indexOf('日本語Aパターン') >= 0) ? 'A' : 'B';
  d.a2koshu = !d.a2 && d.options.indexOf('A2目標講習') >= 0;
  // 特定技能：シミュレーターが送る「【特定技能】一括契約」または「【特定技能】個別依頼：項目、項目…」の行から読む
  var tk = d.options.match(/【特定技能】([^\n]*)/);
  d.mode = tk ? 'tk' : 'ik';
  d.plan = tk && tk[1].indexOf('個別依頼') === 0 ? 'each' : 'pkg';
  d.items = d.plan === 'each' ? SHIEN_ITEMS.filter(function (x) { return tk[1].indexOf(x[0]) >= 0; }) : SHIEN_ITEMS;
  if (d.mode === 'tk') { d.ny = 0; d.a2 = false; d.a2koshu = false; }

  var now = e.response.getTimestamp();
  var c = calc(d), it = initCalc(d), on = onceCalc(d);
  var pdf = makePdf(d, now);
  var when = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // 1) 組合への通知（PDF付き）
  var isTk = d.mode === 'tk', kind = isTk ? '特定技能' : '育成就労';
  var checks = staffChecks(d, c);
  var body = '料金シミュレーターから' + kind + 'のお申し込みが届きました。\n申込者には受付メールと見積書PDFを自動送信済みです。\n\n' +
    '━━ 組合の対応 ━━\n' +
    '1. 内容を確認し、' + (d.person || 'ご担当者') + ' 様へ連絡（電話：' + (d.tel || '未記入') + '／メール：' + (d.email || '未記入') + '）\n' +
    '2. 控えシート「MGKK 申し込み控え」の「対応状況」を更新（未対応 → 連絡済み など）\n' +
    (checks.length ? '\n⚠ 確認が必要な点\n・' + checks.join('\n・') + '\n' : '\n確認が必要な点：なし（シミュレーターの金額と再計算が一致）\n') +
    '━━━━━━━━━━\n\n' +
    lines.join('\n\n') + '\n\n■組合側で再計算した月額（' + kind + '・税別）\n' + yen(c.total) +
    (isTk ? '' : '\n\n■組合側で再計算した入国諸費用（新規入国 ' + d.ny + '名・税別・一時金）\n' + rng(it.lo, it.hi)) +
    (on.rows.length ? '\n\n■一時金オプション（税別）\n' + rng(on.lo, on.hi) : '') +
    '\n\n受付日時：' + when + '\n\n※ 全件はスプレッドシート「MGKK 申し込み控え」に記録されています。';
  var opt = { attachments: [pdf] };
  if (d.email) opt.replyTo = d.email;
  MailApp.sendEmail(NOTIFY_TO, '【申し込み・' + kind + '】' + (checks.length ? '【要確認】' : '') + (d.company || '（会社名なし）') + ' 様（月額 ' + yen(c.total) + '）', body, opt);

  // 2) 申込者への受付メール（PDF付き）
  if (d.email) {
    var cbody = (d.company ? d.company + '\n' : '') + (d.person ? d.person + ' 様\n' : '') + '\n' +
      'このたびはお申し込みいただき、誠にありがとうございます。\n以下の内容で受け付けました。お見積書（PDF）を添付いたします。\n\n' +
      (isTk ? '・特定技能：' + d.tokutei + '名（支援委託：' + (d.plan === 'pkg' ? '一括契約' : '個別依頼 ' + d.items.length + '項目') + '）\n'
            : '・育成就労：' + d.ikusei + '名\n') +
      '・オプション：' + (c.optNames.length ? c.optNames.join('、') : 'なし') + '\n' +
      '・月額（概算・税別）：' + yen(c.total) + '\n' +
      (isTk ? '' : '・入国諸費用（新規入国 ' + d.ny + '名・概算・税別）：' + rng(it.lo, it.hi) + '\n') +
      (on.rows.length ? '・一時金オプション（概算・税別）：' + rng(on.lo, on.hi) + '\n' : '') + '\n' +
      '内容を確認のうえ、組合よりあらためてご連絡いたします。\nご不明な点は、このメールにご返信ください。\n\n' +
      '――――――――――\nMGKK協同組合\n' + NOTIFY_TO + '\n' + SIM_URL + '\n';
    MailApp.sendEmail(d.email, '【MGKK協同組合】お申し込み受付・お見積書', cbody, { attachments: [pdf], replyTo: NOTIFY_TO, name: 'MGKK協同組合' });
  }

  // 3) 控えシートに「対応状況」欄を付けて「未対応」を入れる（失敗してもメールは送信済み）
  try { markStatus(e.response.getTimestamp()); } catch (err) { Logger.log('対応状況の記入に失敗：' + err); }
}

// 組合職員が電話で確かめるべき点（フォームで数字を書き換えた・人数0など）
function staffChecks(d, c) {
  var w = [];
  var cnt = d.mode === 'tk' ? d.tokutei : d.ikusei;
  if (cnt <= 0) w.push((d.mode === 'tk' ? '特定技能' : '育成就労') + 'の人数が0名です。人数をお客様に確認してください。');
  var m = String(d.total || '').replace(/,/g, '').match(/¥\s*(\d+)/);
  if (!m) w.push('シミュレーターの月額がフォームに入っていません（フォームを直接開いた可能性）。内容をお客様に確認してください。');
  else if (parseInt(m[1], 10) !== c.total) w.push('フォームの月額 ' + yen(parseInt(m[1], 10)) + ' と組合の再計算 ' + yen(c.total) + ' が違います。フォームで人数等が書き換えられた可能性があります。見積書PDFは再計算の金額で作成済みです。');
  if (d.mode !== 'tk' && d.ny > d.ikusei) w.push('新規入国 ' + d.ny + '名 が育成就労 ' + d.ikusei + '名 より多くなっています。');
  if (d.mode === 'tk' && d.plan === 'each' && !d.items.length) w.push('個別依頼の支援業務が1つも選ばれていません。');
  if (d.note) w.push('ご要望・備考の記入があります：' + d.note);
  return w;
}

// 控えシートの回答行に「対応状況」（プルダウン）を付ける
function markStatus(ts) {
  var form = FormApp.openById(FORM_ID);
  var ss = SpreadsheetApp.openById(form.getDestinationId());
  var sh = ss.getSheets().filter(function (x) { var u = x.getFormUrl && x.getFormUrl(); return u && u.indexOf(FORM_ID) >= 0; })[0] || ss.getSheets()[0];
  var lastCol = sh.getLastColumn(), head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = head.indexOf('対応状況') + 1;
  if (!col) { col = lastCol + 1; sh.getRange(1, col).setValue('対応状況').setFontWeight('bold'); sh.getRange(1, col + 1).setValue('対応メモ').setFontWeight('bold'); }
  var row = sh.getLastRow();
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(['未対応', '連絡済み', '面談・説明済み', '契約', '見送り'], true).build();
  var cell = sh.getRange(row, col);
  if (!cell.getValue()) cell.setValue('未対応');
  cell.setDataValidation(rule);
}

// 月額（育成就労と特定技能は別の見積もり。育成就労の単価だけ合算人数で決まる）
function calc(d) {
  var n = d.ikusei + d.tokutei, rate = ikuseiRate(n), cnt, per, kanri;
  if (d.mode === 'tk') {
    cnt = d.tokutei;
    per = d.plan === 'each' ? d.items.reduce(function (a, x) { return a + x[1]; }, 0) : SHIEN_PKG;
    kanri = cnt * per;
  } else {
    cnt = d.ikusei; kanri = cnt * rate;
  }
  var fixed = cnt > 0 ? SYS + OKURI * cnt : 0;
  var opt = cnt > 0 ? (d.soft ? SOFT * cnt : 0) + (d.kyuyo ? KYUYO_BASE + KYUYO_PER * cnt : 0) : 0;
  var names = [];
  if (d.soft) names.push('在留申請書類ソフト');
  if (d.kyuyo) names.push('給与計算サポート');
  return { n: n, cnt: cnt, rate: rate, per: per, kanri: kanri, fixed: fixed, opt: opt, total: kanri + fixed + opt, optNames: names };
}

function sumRows(r) { var lo = 0, hi = 0; r.forEach(function (x) { lo += x[2]; hi += x[3]; }); return { rows: r, lo: lo, hi: hi }; }

// 入国諸費用：rows は [項目, 単価表示, 下限, 上限, オプションか]
function initCalc(d) {
  var ny = d.ny || 0, pat = d.a2 ? 'B' : (d.pat || 'B'), post = POST[pat], r = [];
  r.push(['入国前講習費', '15,000円/人', PRE * ny, PRE * ny, false]);
  r.push(['入国後講習費＋手当・施設（' + pat + 'パターン）', pat === 'A' ? '16〜26万円/人' : '10〜16万円/人', post[0] * ny, post[1] * ny, false]);
  r.push(['渡航費 航空券（片道・実費）', '実費 7〜10万円/人', AIR[0] * ny, AIR[1] * ny, false]);
  r.push(['渡航費 人件費（空港送迎等）', '30,000円/人', TRAVEL * ny, TRAVEL * ny, false]);
  r.push(['技能実習生総合保険（3年一括）', '約2〜3.3万円/人', INS[0] * ny, INS[1] * ny, false]);
  r.push(['育成就労計画 認定申請手数料（機構）', '6,100円/人', NINTEI * ny, NINTEI * ny, false]);
  if (!d.soft) r.push(['在留資格認定申請料（提携行政書士）※在留申請書類ソフト利用時は不要', '概ね5.5〜20万円/件', GYOSEI[0] * ny, GYOSEI[1] * ny, false]);
  if (d.a2) r.push(['来日前A2（N4相当）取得保証', '60,000円/人', A2HOSHO * ny, A2HOSHO * ny, true]);
  var res = sumRows(r); res.pat = pat;
  return res;
}

// 一時金オプション（入国諸費用とは別・必要な時だけ）
function onceCalc(d) {
  var n = d.ikusei + d.tokutei, r = [];
  if (d.a2koshu) r.push(['A2目標講習（就労開始後100時間・他社合同オンライン／育成就労' + d.ikusei + '名）', '約10〜20万円/人', A2KOSHU[0] * d.ikusei, A2KOSHU[1] * d.ikusei, true]);
  return sumRows(r);
}

function makePdf(d, date) {
  var c = calc(d);
  var T = '#0f6e6a', INK = '#0a4f4c', TL = '#d7ebe9', Z = '#f0f6f5', LINE = '#cfd9dd', FONT = 'Noto Sans JP';
  var W = 515; // A4幅(595pt) − 左右余白40pt×2
  var on = onceCalc(d);
  var name = 'お見積書_' + (d.company || 'MGKK') + '_' + Utilities.formatDate(date, 'Asia/Tokyo', 'yyyyMMdd');
  var doc = DocumentApp.create(name);
  var body = doc.getBody();
  body.setMarginTop(20).setMarginBottom(16).setMarginLeft(40).setMarginRight(40);
  var base = {}; base[DocumentApp.Attribute.FONT_FAMILY] = FONT; base[DocumentApp.Attribute.FONT_SIZE] = 10;
  body.setAttributes(base);

  function pad(cell, v, h) { cell.setPaddingTop(v).setPaddingBottom(v).setPaddingLeft(h).setPaddingRight(h); return cell; }
  function attrs(size, color, bold) { var a = {}; a[DocumentApp.Attribute.FONT_FAMILY] = FONT; a[DocumentApp.Attribute.FONT_SIZE] = size; if (color) a[DocumentApp.Attribute.FOREGROUND_COLOR] = color; a[DocumentApp.Attribute.BOLD] = !!bold; return a; }
  function txt(el, size, color, bold) {
    var t = el.editAsText();
    if (t.getText().length) t.setFontFamily(FONT).setFontSize(size).setForegroundColor(color).setBold(!!bold);
    else el.setAttributes(attrs(size, color, bold));
    return el;
  }
  function gap(size) { var p = body.appendParagraph(''); p.setAttributes(attrs(size || 4)); p.setSpacingBefore(0).setSpacingAfter(0); return p; }
  function box(text, bg, color, size, bold, border) {
    var t = body.appendTable([[text]]); t.setColumnWidth(0, W).setBorderWidth(border ? 2 : 0).setBorderColor(border || bg);
    var cell = pad(t.getCell(0, 0), 4, 10); cell.setBackgroundColor(bg); txt(cell, size, color, bold);
    return cell;
  }
  function section(title) { gap(3); box(title, TL, INK, 11, true); gap(1); }
  function table(rows, head, widths, size, sumRows) {
    widths = widths || [0.55, 0.45]; size = size || 10; sumRows = sumRows || 0;
    var data = head ? [head].concat(rows) : rows;
    var t = body.appendTable(data); t.setBorderColor(LINE).setBorderWidth(1);
    widths.forEach(function (w, k) { t.setColumnWidth(k, W * w); });
    for (var r = 0; r < data.length; r++) {
      var isHead = head && r === 0, isSum = r >= data.length - sumRows, zebra = (head ? r : r + 1) % 2 === 0;
      for (var k = 0; k < widths.length; k++) {
        var cell = pad(t.getCell(r, k), 1, widths.length > 2 ? 6 : 10);
        cell.setBackgroundColor(isHead ? T : (isSum ? TL : (zebra ? Z : '#ffffff')));
        txt(cell, isHead ? size - 1 : size, isHead ? '#ffffff' : '#111111', isHead || isSum || k > 0);
        if (k > 0) cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }
  }

  // ヘッダー（緑の帯）
  var h = body.appendTable([['MGKK協同組合']]); h.setColumnWidth(0, W).setBorderWidth(0).setBorderColor(T);
  var hc = pad(h.getCell(0, 0), 6, 14); hc.setBackgroundColor(T);
  txt(hc.getChild(0).asParagraph(), 11, '#ffffff', true);
  txt(hc.appendParagraph(d.mode === 'tk' ? 'お見積り（特定技能｜月額／概算・税別）' : 'お見積り（育成就労｜月額・入国諸費用／概算・税別）'), 18, '#ffffff', true);
  txt(hc.appendParagraph(d.company ? d.company + '　御中' : ''), 12, '#ffffff', true);
  var dp = txt(hc.appendParagraph('発行日：' + Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/M/d')), 10, '#ffffff', false);
  dp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  txt(hc.appendParagraph('お問い合わせ：MGKK協同組合　' + NOTIFY_TO), 9, '#ffffff', false);

  gap(4);
  if (d.mode === 'tk') { tokuteiPages(); return finish(); }
  txt(body.appendParagraph('本見積書は単価表です。受け入れ人数が変わっても再発行は不要で、下表A（監理費）の単価でその都度ご確認いただけます。表示はすべて税別。A〜Dは月額、Eは入国時の諸費用、Fは一時金オプション、G・Hは発生時のみの費用です。'), 8, '#555555', false);

  section('A. 監理費（育成就労＋特定技能の合算人数で単価が決まります）');
  table([['1名', '50,000円'], ['2名', '40,000円'], ['3〜5名', '35,000円'], ['6〜10名', '33,000円'], ['11〜15名', '31,000円'], ['16名以上', '30,000円']],
    ['合算人数', '育成就労 単価（1名・月）']);

  section('B. 必須費用（毎月）');
  var B = [['システム管理料', '10,000円/社・月'], ['送り出し機関 管理費', '5,000円/人・月']];
  table(B);

  section('C. お申込みオプション（単価）');
  table(optUnits());

  section('D. 月額の計算方法');
  box('月額 ＝ 監理費（表A 単価 × 人数）＋ 必須費用（B）＋ お申込みオプション（C）', TL, INK, 10, true);
  gap(3);
  refBox('参考試算（お申込み時：育成就労 ' + d.ikusei + '名／単価は特定技能 ' + d.tokutei + '名との合算 ' + c.n + '名で判定）', '監理費');

  // 2ページ目：入国諸費用（全パターン比較）
  body.appendPageBreak();
  section('E. 入国諸費用（育成就労・入国時の一時金）');
  var P = [{ pat: 'A', a2: false }, { pat: 'B', a2: false }, { pat: 'B', a2: true }].map(function (o) {
    var t = {}; for (var k in d) t[k] = d[k]; t.pat = o.pat; t.a2 = o.a2; t.ny = 1; return initCalc(t);
  });
  var E = [];
  for (var i = 0; i < P[0].rows.length; i++) {
    E.push([P[0].rows[i][0].replace(/（[AB]パターン）/, '')].concat(P.map(function (p) { return rng(p.rows[i][2], p.rows[i][3]); })));
  }
  E.push(['来日前A2（N4相当）取得保証（任意）', '—', '—', yen(A2HOSHO)]);
  E.push(['1名あたり 合計'].concat(P.map(function (p) { return rng(p.lo, p.hi); })));
  if (d.ny > 0) E.push(['新規入国 ' + d.ny + '名 合計'].concat(P.map(function (p) { return rng(p.lo * d.ny, p.hi * d.ny); })));
  table(E, ['項目（1名あたり）', 'Aパターン\nA1（N5）未合格', 'Bパターン\nA1（N5）合格済み', 'Bパターン＋\n来日前A2取得保証'],
    [0.34, 0.22, 0.22, 0.22], 9, d.ny > 0 ? 2 : 1);
  gap(3);
  box('Aパターン：入国後講習320時間以上（入国前160時間で160時間に短縮）／Bパターン：220時間以上（入国前110時間で110時間に短縮）。\n来日前A2取得保証を選ぶと、就労開始後のA2目標講習（約10〜20万円/人・オプション）が不要になります。', '#ffffff', '#111111', 9, false, T);

  // 3ページ目：オプション・発生時のみの費用・実費
  body.appendPageBreak();
  section('F. お申込みオプション（必要な時だけ・一時金）');
  table(on.rows.length ? on.rows.map(function (x) { return [x[0] + '（単価 ' + x[1] + '）', rng(x[2], x[3])]; }) : [['お申込みなし', '—']]);

  section('G. 発生時のみの費用（単価）');
  table([['休日・時間外の出動（会社都合・非緊急／1日分）', '30,000円/回＋交通費実費'],
    ['建設就労者 資格取得の引率・通訳（送迎含む）', '30,000円/回'],
    ['A2（N4相当）受験料：日本語能力試験 N4（国内）', '7,500円/回（税込）'],
    ['A2（N4相当）受験料：JFT-Basic（国内）', '10,000円/回'],
    ['在留資格の変更・更新 書類作成（提携行政書士へ依頼の場合）', '概ね5.5万〜20万円/件']]);

  section('H. 実費（企業さまご負担）');
  table([['技能検定・技能評価試験 受検料（職種・級で変動）', '実費'],
    ['在留資格の変更・更新 入管手数料（組合が納付し請求）', '実費'],
    ['送り出し機関の入国前手数料（本人負担 月給2か月分の超過分）', '実費'],
    ['住居・家電・備品等の準備費用', '実費']]);

  gap(2);
  txt(body.appendParagraph('表示は税別・予定価格です。入国後講習費・航空券・保険・A2目標講習は委託先・コースにより変動する目安です。緊急時の出動・組合発意の訪問は無料です。正式な料金は組合より改めてご案内いたします。'), 8, '#777777', false);
  return finish();

  function optUnits() {
    var C = [];
    if (d.soft) C.push(['在留申請書類ソフト 使用料', '5,000円/人・月（従量）']);
    if (d.kyuyo) C.push(['給与計算サポート', '基本3,000円/社＋1,000円/人']);
    if (!C.length) C.push(['お申込みなし', '—']);
    return C;
  }

  function refBox(title, label) {
    var rc = box(title, '#ffffff', '#111111', 10, false, T);
    var rp = rc.appendParagraph(label + ' ' + yen(c.kanri) + ' ＋ 必須費用 ' + yen(c.fixed) + ' ＋ オプション ' + yen(c.opt) + ' ＝ ');
    txt(rp, 11, '#111111', false);
    rp.appendText('月額 ' + yen(c.total)).setFontSize(16).setBold(true).setForegroundColor(INK);
    rp.appendText('（税別）').setFontSize(10).setBold(false).setForegroundColor('#111111');
  }

  // 特定技能の見積書（2ページ）
  function tokuteiPages() {
    var y = function (n) { return n.toLocaleString('ja-JP') + '円'; };
    txt(body.appendParagraph('本見積書は単価表です。受け入れ人数が変わっても再発行は不要で、下表の単価でその都度ご確認いただけます。表示はすべて税別。A〜Dは月額、Eは一括契約と個別依頼の比較、F・Gは発生時のみの費用です。'), 8, '#555555', false);
    section('A. 支援委託費（特定技能1名あたり・月額）');
    table(d.plan === 'each'
      ? d.items.map(function (x) { return ['個別依頼：' + x[0], y(x[1]) + '/人・月']; }).concat([['個別依頼 ' + d.items.length + '項目 合計', y(c.per) + '/人・月']])
      : [['一括契約（下記E の支援業務10項目すべてを含む）', y(SHIEN_PKG) + '/人・月']]);
    section('B. 必須費用（毎月）');
    table([['システム管理料（育成就労と同じ会社でご契約の場合は1社1回）', '10,000円/社・月'], ['送り出し機関 管理費', '5,000円/人・月']]);
    section('C. お申込みオプション（単価）');
    table(optUnits());
    section('D. 月額の計算方法');
    box('月額 ＝ 支援委託費（A × 人数）＋ 必須費用（B）＋ お申込みオプション（C）', TL, INK, 10, true);
    gap(3);
    refBox('参考試算（お申込み時：特定技能 ' + d.tokutei + '名・' + (d.plan === 'pkg' ? '一括契約' : '個別依頼' + d.items.length + '項目') + '）', '支援委託費');

    body.appendPageBreak();
    section('E. 一括契約と業務ごとの個別依頼の比較（1名あたり・月額）');
    var E = SHIEN_ITEMS.map(function (x, i) { return [(i + 1) + '. ' + x[0], y(x[1]), '含む']; });
    E.push(['1名あたり 合計（月額）', y(SHIEN_EACH), y(SHIEN_PKG)]);
    if (d.tokutei > 0) E.push(['特定技能 ' + d.tokutei + '名 合計（月額）', y(SHIEN_EACH * d.tokutei), y(SHIEN_PKG * d.tokutei)]);
    table(E, ['支援業務', '業務ごとの個別依頼', '一括契約'], [0.56, 0.22, 0.22], 9, d.tokutei > 0 ? 2 : 1);
    gap(3);
    box('一括契約は10項目すべての支援業務を含み、個別依頼の合計より1名あたり月30,000円お得です。個別依頼は必要な業務だけをご依頼いただけます。', '#ffffff', '#111111', 9, false, T);
    section('F. 発生時のみの費用（単価）');
    table([['休日・時間外の出動（会社都合・非緊急／1日分）', '30,000円/回＋交通費実費'],
      ['在留資格の変更・更新 書類作成（提携行政書士へ依頼の場合）', '概ね5.5万〜20万円/件']]);
    section('G. 実費');
    table([['在留資格の変更・更新 入管手数料（組合が納付し請求）', '実費'],
      ['技能評価試験 受検料（特定技能の方はご本人負担）', '実費'],
      ['住居・家電・備品等の準備費用', '実費']]);
    gap(2);
    txt(body.appendParagraph('表示は税別・予定価格です。緊急時の出動・組合発意の訪問は無料です。正式な料金は組合より改めてご案内いたします。'), 8, '#777777', false);
  }

  function finish() {
  // 先頭の空行を詰める
  for (var i = 0; i < body.getNumChildren(); i++) { var el = body.getChild(i); if (el.getType() === DocumentApp.ElementType.PARAGRAPH) el.asParagraph().setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1); }
  var first = body.getChild(0);
  if (first.getType() === DocumentApp.ElementType.PARAGRAPH && first.asParagraph().getText() === '') first.asParagraph().setAttributes(attrs(1));

  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  var pdf = file.getAs('application/pdf').setName(name + '.pdf');
  file.setTrashed(true);
  return pdf;
  }
}
