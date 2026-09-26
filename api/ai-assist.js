// ============================================================
// Vercel Serverless Function — وسيط آمن بين موقع نسق للأعمال وواجهة Anthropic (Claude) API
// ============================================================
module.exports = async (req, res) => {
if (req.method !== 'POST') {
    res.status(405).json({ error: 'استخدم POST لإرسال طلب تحليل.' });
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

  const title = body.title;
  const sections = body.sections;
  if (!title || !Array.isArray(sections)) {
    res.status(400).json({ error: 'بيانات الطلب غير مكتملة.' });
    return;
  }

  let contextText = 'عنوان التقرير: ' + title + '\n\n';
  sections.forEach(function (sec) {
    contextText += '## ' + (sec.heading || '') + '\n';
    (sec.rows || []).forEach(function (row) {
      contextText += '- ' + row[0] + ': ' + (row[1] || '-') + '\n';
    });
    contextText += '\n';
  });
  if (contextText.length > 12000) contextText = contextText.slice(0, 12000) + '\n...(تم اختصار الباقي)';

  const prompt = 'أنت مستشار إداري أول في مكتب "نَسَق للأعمال" للاستشارات الإدارية في السعودية. ' +
    'بناءً على البيانات الفعلية التالية التي أدخلها المستخدم في إحدى أدوات الموقع، قدّم تحليلاً استشارياً ' +
    'مخصصاً ودقيقاً باللغة العربية (وليس نصائح عامة) يشمل: (١) قراءة موجزة للوضع الحالي مبنية تحديداً على ' +
    'الأرقام والمعطيات المذكورة أدناه، (٢) من ثلاث إلى خمس توصيات عملية قابلة للتنفيذ فوراً ومبنية على هذه ' +
    'المعطيات بالذات لا على عموميات، (٣) أهم نقطة يجب الانتباه لها أو خطر يجب تفاديه بناءً على هذه البيانات. ' +
    'اجعل الأسلوب مهنياً ومباشراً، بصيغة نثرية أو نقاط قصيرة، وبحد أقصى نحو ٣٠٠ كلمة.\n\n' +
    'بيانات الأداة:\n' + contextText;

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
        max_tokens: 1024,
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
  const analysis = (data.content && data.content[0] && data.content[0].text) || '';

  res.status(200).json({ analysis: analysis });
}
