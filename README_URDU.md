# PSX سٹاک تجزیہ کار — مکمل سیٹ اپ (زیرو سے، ترتیب وار)

ہر قدم ترتیب سے کریں، کوئی قدم نہ چھوڑیں۔ ہر حصے کے آخر میں "✅ تصدیق" ہے — جب تک وہ پاس نہ ہو، اگلے قدم پر نہ جائیں۔

---

## حصہ A — GitHub (فائلیں رکھنے کی جگہ)

1. ZIP کو Extract کریں۔ اندر `psx-netlify` فولڈر کھولیں۔ وہاں یہ نظر آنا چاہیے: `index.html`, `auth.js`, `netlify.toml`, `package.json` اور ایک فولڈر `netlify`۔
2. `github.com/Masterjaved/psx-analyzer` کھولیں → **Settings** → سب سے نیچے **Danger Zone → Delete this repository** (پرانی ملی جلی فائلوں سے مکمل چھٹکارا)۔
3. نئی ریپو بنائیں: **New repository** → نام `psx-analyzer` → **Private** → README/gitignore کچھ بھی tick نہ کریں → **Create**۔
4. نئی خالی ریپو میں **"uploading an existing file"** پر کلک کریں۔ `psx-netlify` فولڈر کے **اندر** کی تمام چیزیں (Ctrl+A) کھینچ کر ڈالیں — `netlify` فولڈر سمیت۔ نیچے **Commit changes** دبائیں۔

✅ تصدیق: ریپو کے سب سے اوپر کے صفحے پر `index.html` اور `netlify/functions` نظر آئیں (کسی اضافی فولڈر کے اندر نہیں)۔ `netlify/functions` کھولیں تو اندر `analyze.js`, `portfolio.js`, `market-scan.js`, `payouts.js`, `track-record.js`, `ping.js` وغیرہ اور `lib` فولڈر ہو۔

---

## حصہ B — Netlify (سائٹ چلانے کی جگہ)

**اپنا موجودہ Netlify پروجیکٹ `psx-analyzer` ہی رکھیں** (نیا نہ بنائیں) — اس میں Identity کے صارف پہلے سے بنے ہوئے ہیں۔

5. **GitHub سے جوڑنا:** `app.netlify.com` → اپنا پروجیکٹ → **Project configuration → Build & deploy → Continuous deployment** (Repository کا حصہ)۔ پرانی ریپو کا لنک ہٹا کر نئی `Masterjaved/psx-analyzer` جوڑیں۔ Branch: `main`۔ Build command اور Publish directory **خالی** رہنے دیں (سب `netlify.toml` میں لکھا ہے)۔
6. **Environment variables** (Project configuration → Environment variables):
   - پرانی تمام فالتو (خاص طور پر `SUPABASE_URL`, `SUPABASE_ANON_KEY`) **حذف** کریں — اس ورژن کو ان کی ضرورت نہیں۔
   - یہ شامل کریں (نئی keys استعمال کریں، پرانی جو کبھی اسکرین شاٹ میں آئیں وہ نہ ڈالیں):

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Claude کی key (کم از کم ایک AI key ضروری ہے) |
| `GEMINI_API_KEY` | Gemini کی key |
| `GROQ_API_KEY` | Groq کی key |
| `PROVIDER_ORDER` | `claude,gemini,groq` |
| `RESEND_API_KEY` | (اختیاری) ای میل الرٹس کے لیے |
| `RESEND_FROM_EMAIL` | (اختیاری) مثلاً `PSX <alerts@آپ-کا-ڈومین>` |
| `PROFIT_ALERT_PCT` | (اختیاری) `10` |

   ⚠️ **Blobs کے لیے اب کوئی token نہیں چاہیے** — پہلے والی خرابی کا اصل حل کوڈ میں کر دیا ہے (`connectLambda`)۔ پہلے جو `NETLIFY_BLOBS_TOKEN` بنایا تھا وہ حذف کر سکتے ہیں۔
7. **Identity** (Project configuration → Identity): **Enable** ہو۔ Registration = **Invite only**۔
8. **ایڈمن:** Identity → Users → اپنی ای میل کھولیں → App metadata میں `{ "roles": ["admin"] }` (اگر پہلے سے ہے تو رہنے دیں)۔
9. **Deploy:** Deploys ٹیب → **Trigger deploy → Clear cache and deploy site**۔ انتظار کریں جب تک سب سے اوپر والا ڈیپلائے **Published** نہ ہو اور اس کا commit نمبر GitHub کے تازہ ترین commit سے مل جائے۔

✅ تصدیق: اگر ڈیپلائے "Failed" ہو تو اسے کھول کر لاگ کی آخری سرخ لائن بھیجیں۔ اگر "Exposed secrets" لکھا ہو تو وہ Variable حذف کریں جس کا نام لکھا ہے۔

---

## حصہ C — جانچ (اسی ترتیب سے)

10. `https://psx-analyzer.netlify.app/api/ping` کھولیں → `{"ok":true,...}` آنا چاہیے۔ (یہ ثابت کرتا ہے کہ بیک اینڈ فنکشنز چل رہے ہیں۔)
11. `https://psx-analyzer.netlify.app/auth.js` کھولیں → کوڈ نظر آئے۔ پھر مرکزی لنک `https://psx-analyzer.netlify.app/` → لاگ ان صفحہ۔
12. لاگ ان کریں۔ پاس ورڈ بھول گئے ہوں تو: Netlify → Identity → اپنی ای میل → **Send recovery email**، پھر ای میل کا **تازہ** لنک کھولیں (لنک ایک ہی بار چلتا ہے)۔
13. ہوم پر 3 سٹاک ڈال کر تجزیہ کریں۔
14. "میرا پورٹ فولیو" → ایک ہولڈنگ شامل کریں → صفحہ ریفریش کریں، ہولڈنگ موجود رہے۔ (یہ Blobs کی جانچ ہے۔)
15. `admin.html` (صرف ایڈمن) → سب کے پورٹ فولیو۔
16. "مارکیٹ اسکینر"، "ڈیویڈنڈ کیلنڈر"، "ٹریک ریکارڈ" کھولیں۔ ٹریک ریکارڈ شروع میں خالی ہو گا — جیسے جیسے تجزیے ہوں گے بھرتا جائے گا۔
17. (اختیاری) ای میل ٹیسٹ: `https://psx-analyzer.netlify.app/.netlify/functions/daily-alert-check`

---

## مسائل اور حل

| علامت | وجہ / حل |
|---|---|
| ہر جگہ "Page not found" | ڈیپلائے میں فائلیں نہیں پہنچیں — حصہ A کی تصدیق دوبارہ کریں، اور حصہ B قدم 5 (ریپو جڑی ہے؟) اور قدم 9 |
| `/api/ping` پر 404 | `netlify.toml` یا `netlify/functions` غلط جگہ پر ہے |
| 402 (Payment Required) | Netlify کی Usage/Credits کی حد — Team → Usage and billing دیکھیں |
| "Blobs ... not been configured" | اس ZIP میں ٹھیک ہے؛ اگر پھر بھی آئے تو `BLOBS_SITE_ID` (پروجیکٹ ID) اور `BLOBS_TOKEN` (Personal access token) Environment variables میں ڈال دیں |
| ڈیویڈنڈ کیلنڈر خالی | PSX کے Payouts صفحے کی ساخت کی تصدیق باقی ہے — Functions لاگ یا اسکرین شاٹ بھیجیں |
| تجزیے میں "PSX سے جواب نہیں ملا (status 404 / 403)" | موجودہ قیمت، نفع/نقصان اور ٹریک ریکارڈ سب اسی ڈیٹا پر چلتے ہیں۔ اس ZIP میں پہلے PSX کا JSON پتہ (`/timeseries/eod/`) اور وہ نہ چلے تو Yahoo Finance (`SYMBOL.KA`) خودکار آزمایا جاتا ہے۔ اگر پھر بھی 403/404 آئے تو ممکن ہے PSX نے Netlify کے سرور کو روکا ہو — اسکرین شاٹ بھیجیں |
| ٹریک ریکارڈ خالی | یہ تب بھرتا ہے جب تجزیہ کامیاب ہو اور اگلے دن اس کا موازنہ ہو سکے |
| لاگ ان کے بعد 401 | Identity میں صارف موجود/کنفرم ہے؟ لاگ آؤٹ کر کے دوبارہ لاگ ان کریں |

نوٹ: "Promoter/FII Holding" کی اسکریننگ شامل نہیں — PSX یہ ڈیٹا ایک جگہ منظم شکل میں نہیں دیتا۔ مارکیٹ کیپ والی شرط شامل ہے۔
