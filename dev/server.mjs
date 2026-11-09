// 로컬 테스트용 서버: `ADMIN_CODE=test npm run dev` → http://localhost:3000
// (Vercel에서는 이 파일을 쓰지 않는다. api/*.js가 그대로 서버리스 함수가 된다.)
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '200kb' }));

app.all('/api/:name', async (req, res) => {
  const file = path.join(root, 'api', `${req.params.name}.js`);
  try {
    const mod = await import(pathToFileURL(file).href);
    await mod.default(req, res);
  } catch (e) {
    if (!res.headersSent) res.status(404).json({ error: String(e.message || e) });
  }
});

app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`doc-analysis-lab dev server on http://localhost:${port}`));
