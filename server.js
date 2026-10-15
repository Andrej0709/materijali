// Lokalno pokretanje: `npm start`. Na Vercelu se umesto ovoga koristi api/index.js.
import express from 'express';
import path from 'node:path';
import app from './lib/app.js';
import { ROOT, CLASS_NAME, CLASS_CODE, UPLOAD_MODE } from './lib/config.js';

const PORT = Number(process.env.PORT) || 3000;

const server = express();
server.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
server.use(app);

server.listen(PORT, () => {
  console.log(`\n  ${CLASS_NAME} radi na http://localhost:${PORT}`);
  console.log(`  Fajlovi: ${UPLOAD_MODE === 'blob' ? 'Vercel Blob' : 'lokalni disk'}`);
  console.log(CLASS_CODE ? '  Šifra odeljenja je uključena.\n' : '  Bez šifre (postavi CLASS_CODE da je uključiš).\n');
});
