var NOTIFY_TO = 'mgkk6271@gmail.com';
var FORM_ID = '1Sf1Qs0uK0aYLk9h9jADdwAFrR_SbwcxvaHBzM7K0-qU';
var SIM_URL = 'https://sato-mgkk.github.io/mgkk-fee-sim/';

// 料金（シミュレーターと同じ）
var SYS = 10000, SOFT = 5000, KYUYO_BASE = 3000, KYUYO_PER = 1000, CCUS = 5000, TOKUTEI_RATE = 30000;
function ikuseiRate(n) { if (n <= 1) return 50000; if (n <= 2) return 40000; if (n <= 5) return 35000; if (n <= 10) return 33000; if (n <= 15) return 31000; return 30000; }
function yen(n) { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
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
  var d = { company: 'テスト株式会社', person: 'テスト太郎', tel: '000-0000-0000', email: NOTIFY_TO, ikusei: 2, tokutei: 5, soft: true, kyuyo: true, ccus: false, note: '' };
  MailApp.sendEmail({ to: NOTIFY_TO, subject: '【テスト】月額お見積書PDF', body: 'テスト用の見積書PDFです。', attachments: [makePdf(d, new Date())] });
}

function onFormSubmit(e) {
  var d = { company: '', person: '', tel: '', email: '', ikusei: 0, tokutei: 0, soft: false, kyuyo: false, ccus: false, note: '', options: '' };
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
    else if (t === 'ご要望・備考') d.note = v;
  });
  d.soft = d.options.indexOf('在留申請書類ソフト') >= 0;
  d.kyuyo = d.options.indexOf('給与計算') >= 0;
  d.ccus = d.options.indexOf('CCUS') >= 0 || d.options.indexOf('キャリアアップ') >= 0;

  var now = e.response.getTimestamp();
  var c = calc(d);
  var pdf = makePdf(d, now);
  var when = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');

  // 1) 組合への通知（PDF付き）
  var body = '料金シミュレーターからお申し込みが届きました。\n申込者には受付メールと見積書PDFを自動送信済みです。\n\n' +
    lines.join('\n\n') + '\n\n■組合側で再計算した月額（税別）\n' + yen(c.total) +
    '\n\n受付日時：' + when + '\n\n※ 全件はスプレッドシート「MGKK 申し込み控え」に記録されています。';
  var opt = { attachments: [pdf] };
  if (d.email) opt.replyTo = d.email;
  MailApp.sendEmail(NOTIFY_TO, '【申し込み】' + (d.company || '（会社名なし）') + ' 様（月額 ' + yen(c.total) + '）', body, opt);

  // 2) 申込者への受付メール（PDF付き）
  if (d.email) {
    var cbody = (d.company ? d.company + '\n' : '') + (d.person ? d.person + ' 様\n' : '') + '\n' +
      'このたびはお申し込みいただき、誠にありがとうございます。\n以下の内容で受け付けました。月額お見積書（PDF）を添付いたします。\n\n' +
      '・育成就労：' + d.ikusei + '名\n・特定技能：' + d.tokutei + '名\n・オプション：' + (c.optNames.length ? c.optNames.join('、') : 'なし') + '\n' +
      '・月額（概算・税別）：' + yen(c.total) + '\n\n' +
      '内容を確認のうえ、組合よりあらためてご連絡いたします。\nご不明な点は、このメールにご返信ください。\n\n' +
      '――――――――――\nMGKK協同組合\n' + NOTIFY_TO + '\n' + SIM_URL + '\n';
    MailApp.sendEmail(d.email, '【MGKK協同組合】お申し込み受付・月額お見積書', cbody, { attachments: [pdf], replyTo: NOTIFY_TO, name: 'MGKK協同組合' });
  }
}

function calc(d) {
  var n = d.ikusei + d.tokutei, rate = ikuseiRate(n), tkRate = Math.min(TOKUTEI_RATE, rate);
  var kanri = d.ikusei * rate + d.tokutei * tkRate;
  var fixed = SYS + (d.ccus ? CCUS : 0);
  var opt = (d.soft ? SOFT * n : 0) + (d.kyuyo ? KYUYO_BASE + KYUYO_PER * n : 0);
  var names = [];
  if (d.soft) names.push('在留申請書類ソフト');
  if (d.kyuyo) names.push('給与計算サポート');
  if (d.ccus) names.push('CCUS月次運用サポート');
  return { n: n, rate: rate, tkRate: tkRate, kanri: kanri, fixed: fixed, opt: opt, total: kanri + fixed + opt, optNames: names };
}

function makePdf(d, date) {
  var c = calc(d);
  var T = '#0f6e6a', INK = '#0a4f4c', TL = '#d7ebe9', Z = '#f0f6f5', LINE = '#cfd9dd', FONT = 'Noto Sans JP';
  var W = 515; // A4幅(595pt) − 左右余白40pt×2
  var name = '月額お見積書_' + (d.company || 'MGKK') + '_' + Utilities.formatDate(date, 'Asia/Tokyo', 'yyyyMMdd');
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
  function table(rows, head) {
    var data = head ? [head].concat(rows) : rows;
    var t = body.appendTable(data); t.setBorderColor(LINE).setBorderWidth(1).setColumnWidth(0, W * 0.55).setColumnWidth(1, W * 0.45);
    for (var r = 0; r < data.length; r++) {
      var isHead = head && r === 0, zebra = (head ? r : r + 1) % 2 === 0;
      for (var k = 0; k < 2; k++) {
        var cell = pad(t.getCell(r, k), 1, 10);
        cell.setBackgroundColor(isHead ? T : (zebra ? Z : '#ffffff'));
        txt(cell, isHead ? 9 : 10, isHead ? '#ffffff' : '#111111', isHead || k === 1);
        if (k === 1) cell.getChild(0).asParagraph().setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
      }
    }
  }

  // ヘッダー（緑の帯）
  var h = body.appendTable([['MGKK協同組合']]); h.setColumnWidth(0, W).setBorderWidth(0).setBorderColor(T);
  var hc = pad(h.getCell(0, 0), 6, 14); hc.setBackgroundColor(T);
  txt(hc.getChild(0).asParagraph(), 11, '#ffffff', true);
  txt(hc.appendParagraph('月額お見積り（概算・税別）'), 18, '#ffffff', true);
  txt(hc.appendParagraph(d.company ? d.company + '　御中' : ''), 12, '#ffffff', true);
  var dp = txt(hc.appendParagraph('発行日：' + Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy/M/d')), 10, '#ffffff', false);
  dp.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  gap(4);
  txt(body.appendParagraph('本見積書は単価表です。受け入れ人数が変わっても再発行は不要で、下表A（監理費）の単価でその都度ご確認いただけます。表示はすべて税別・月額。'), 8, '#555555', false);

  section('A. 監理費（育成就労＋特定技能の合算人数で単価が決まります）');
  table([['1名', '50,000円'], ['2名', '40,000円'], ['3〜5名', '35,000円'], ['6〜10名', '33,000円'], ['11〜15名', '31,000円'], ['16名以上', '30,000円'], ['特定技能', '30,000円（据置）']],
    ['合算人数', '育成就労 単価（1名・月）']);

  section('B. 固定費（人数に関係なく定額）');
  var B = [['システム管理料', '10,000円/社・月']];
  if (d.ccus) B.push(['建設キャリアアップシステム（CCUS）月次運用サポート', '5,000円/社・月']);
  table(B);

  section('C. お申込みオプション（単価）');
  var C = [];
  if (d.soft) C.push(['在留申請書類ソフト 使用料', '5,000円/人・月（従量）']);
  if (d.kyuyo) C.push(['給与計算サポート', '基本3,000円/社＋1,000円/人']);
  if (!C.length) C.push(['お申込みなし', '—']);
  table(C);

  section('D. 月額の計算方法');
  box('月額 ＝ 監理費（表A 単価 × 人数）＋ 固定費（B）＋ お申込みオプション（C）', TL, INK, 10, true);
  gap(3);
  var rc = box('参考試算（お申込み時：育成就労 ' + d.ikusei + '名・特定技能 ' + d.tokutei + '名／合算 ' + c.n + '名）', '#ffffff', '#111111', 10, false, T);
  var rp = rc.appendParagraph('監理費 ' + yen(c.kanri) + ' ＋ 固定費 ' + yen(c.fixed) + ' ＋ オプション ' + yen(c.opt) + ' ＝ ');
  txt(rp, 11, '#111111', false);
  var tail = '月額 ' + yen(c.total);
  rp.appendText(tail).setFontSize(16).setBold(true).setForegroundColor(INK);
  rp.appendText('（税別）').setFontSize(10).setBold(false).setForegroundColor('#111111');

  gap(2);
  txt(body.appendParagraph('表示は税別・予定価格です。送り出し機関の管理費は含みません。正式な料金は組合より改めてご案内いたします。'), 8, '#777777', false);

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
