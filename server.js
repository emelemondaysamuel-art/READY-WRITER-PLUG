const path = require('path');
const express = require('express');
const multer = require('multer');
const mammoth = require('mammoth');
const { build } = require('./lib/build');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const strip = s => s.replace(/<[^>]+>/g, '');
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function htmlToText(html) {
  return decode(html
    .replace(/<img[^>]*src="ph:([^"]+)"[^>]*>/gi, '\n\n[image: $1]\n\n')
    .replace(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi, (m, t) => `\n\n# ${strip(t)}\n\n`)
    .replace(/<h[3-6][^>]*>([\s\S]*?)<\/h[3-6]>/gi, (m, t) => `\n\n**${strip(t)}**\n\n`)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|li|ul|ol)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\*\*\s*\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// Upload .docx / .txt / .md and return plain text (headings become "# Title")
app.post('/api/extract', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) throw new Error('No file received.');
    const name = req.file.originalname || 'file';
    const ext = path.extname(name).toLowerCase();
    if (ext === '.txt' || ext === '.md') {
      return res.json({ text: req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''), images: {} });
    }
    if (ext === '.docx') {
      const images = {};
      let n = 0;
      const out = await mammoth.convertToHtml({ buffer: req.file.buffer }, {
        convertImage: mammoth.images.imgElement(async img => {
          const data = await img.read('base64');
          const e = (img.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
          const key = `docx-${++n}.${e}`;
          images[key] = `data:${img.contentType};base64,${data}`;
          return { src: 'ph:' + key };
        })
      });
      return res.json({ text: htmlToText(out.value), images });
    }
    throw new Error('Please upload a .docx or .txt file (save old .doc files as .docx first).');
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Build the ebook package (zip: EPUB + PDF + covers)
app.post('/api/build', async (req, res) => {
  try {
    const r = await build(req.body || {});
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${r.slug}-kdp.zip"`,
      'X-Build-Stats': JSON.stringify(r.stats)
    });
    res.send(r.zip);
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('Ready-Writer running'));
