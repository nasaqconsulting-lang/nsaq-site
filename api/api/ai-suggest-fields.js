// ============================================================
// Vercel Serverless Function — اقتراح تعبئة معطيات الأداة عبر Claude (نفس الوسيط الآمن)
// ============================================================

function extractJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) { /* تابع للمحاولة التالية */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e2) {
      return null;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'استخدم POST لإرسال طلب اقتراح.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body) {
    res.status(400).json({ error: 'صيغة الطلب غير صحيحة.' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'لم يتم إعداد مفتاح Anthropic API بعد في إعدادات Vercel (ANTHROPIC_API_KEY).' });
    return;
  }

  if (process.env.SITE_SHARED_SECRET && body.siteToken !== process.env.SITE_SHARED_SECRET) {
    res.status(403).json({ error: 'طلب غير مصرح به.' });
    return;
  }

  const toolKey = body.toolKey;
  const scopeText = body.scopeText;
  const fields = body.fields;
  if (!toolKey || !scopeText || !Array.isArray(fields) || fields.length === 0) {
    res.status(400).json({ error: 'بيانات الطلب غير مكتملة.' });
    return;
  }

  const safeScopeText = String(scopeText).slice(0, 4000);
  const safeFields = fields.slice(0, 60).map(function (f) {
    return { id: String(f.id || '').slice(0, 80), label: String(f.label || '').slice(0, 200), type: f.type || 'text', hint: f.hint ? String(f.hint).slice(0, 300) : undefined };
  });

  const fieldsListText = safeFields.map(function (f) {
    let line = '- المعرّف: "' + f.id + '" — التسمية: "' + f.label + '"';
    if (f.type === 'number') line += ' (القيمة المطلوبة رقم فقط بدون فواصل أو رموز)';
    if (f.hint) line += ' — ملاحظة: ' + f.hint;
    return line;
  }).join('\n');

  const prompt = 'أنت مستشار إداري أول في مكتب "نَسَق للأعمال" للاستشارات الإدارية في السعودية. ' +
    'مستخدم يستخدم إحدى أدوات الموقع التفاعلية وكتب وصفاً مختصراً لنطاق عمل مؤسسته أو مشروعه. ' +
    'مهمتك: اقتراح قيم أولية واقعية ومحددة (وليست عامة أو نمطية) لكل حقل من حقول الأداة التالية، ' +
    'بناءً على هذا الوصف فقط، لتكون نقطة انطلاق يراجعها المستخدم ويعدّلها بحرية كاملة قبل الاعتماد عليها.\n\n' +
    'وصف نطاق العمل الذي كتبه المستخدم:\n"' + safeScopeText + '"\n\n' +
    'حقول الأداة المطلوب اقتراح قيم لها:\n' + fieldsListText + '\n\n' +
    'أجب حصرياً بكائن JSON صالح واحد فقط (بدون أي شرح أو نص إضافي قبله أو بعده، وبدون أسوار كود)، ' +
    'مفاتيحه هي معرّفات الحقول بالضبط كما وردت أعلاه، وقيمه هي الاقتراحات المكتوبة باللغة العربية ' +
    '(أو رقماً فقط للحقول الرقمية). إن لم يكن لديك اقتراح مناسب لحقل معيّن يمكنك حذفه من الكائن بدل تخمين عشوائي.';

  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (e) {
    res.status(502).json({ error: 'تعذر الاتصال بواجهة Claude API.' });
    return;
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    console.error('Anthropic API error:', anthropicRes.status, errText);
    let hint = 'تعذر الحصول على رد من Claude (خطأ ' + anthropicRes.status + ').';
    if (anthropicRes.status === 401) hint += ' تأكد من صحة مفتاح API.';
    else if (anthropicRes.status === 429) hint += ' تم تجاوز حد الاستخدام المسموح به مؤقتاً أو انتهى الرصيد.';
    res.status(502).json({ error: hint });
    return;
  }

  const data = await anthropicRes.json();
  const rawText = (data.content && data.content[0] && data.content[0].text) || '';
  const suggestions = extractJsonObject(rawText);

  if (!suggestions || typeof suggestions !== 'object') {
    res.status(502).json({ error: 'تعذر فهم اقتراحات الذكاء الاصطناعي. حاول مرة أخرى أو أكمل التعبئة يدوياً.' });
    return;
  }

  res.status(200).json({ suggestions: suggestions });
}
