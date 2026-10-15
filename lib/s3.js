// Skladište kompatibilno sa S3: Backblaze B2 ili Cloudflare R2 (po 10 GB besplatno).
// Fajlovi su privatni; aplikacija izdaje kratkotrajne potpisane linkove samo ulogovanima.
import { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } from './config.js';

let clientPromise;
function getClient() {
  clientPromise ||= (async () => {
    const [{ S3Client }, presigner] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner')
    ]);
    const client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
      // Novije verzije SDK-a dodaju checksum zaglavlja koja B2 i R2 ne prihvataju u potpisanim linkovima
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
    return { client, getSignedUrl: presigner.getSignedUrl, s3: await import('@aws-sdk/client-s3') };
  })();
  return clientPromise;
}

export async function presignUpload(key, contentType, size) {
  const { client, getSignedUrl, s3 } = await getClient();
  const command = new s3.PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType, ContentLength: size });
  return getSignedUrl(client, command, { expiresIn: 30 * 60, signableHeaders: new Set(['content-type', 'content-length']) });
}

// Link važi do kraja sutrašnjeg dana i isti je ceo dan, pa browser može da ga zapamti (manje preuzimanja)
const DAY = 24 * 60 * 60 * 1000;
export async function presignDownload(key, { download, name } = {}) {
  const { client, getSignedUrl, s3 } = await getClient();
  const command = new s3.GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ...(download && name
      ? { ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` }
      : {})
  });
  const today = new Date(Math.floor(Date.now() / DAY) * DAY);
  return getSignedUrl(client, command, { signingDate: today, expiresIn: (2 * DAY) / 1000 });
}

export async function headObject(key) {
  const { client, s3 } = await getClient();
  try {
    return await client.send(new s3.HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch {
    return null;
  }
}

export async function deleteObjects(keys) {
  const { client, s3 } = await getClient();
  await Promise.all(keys.map((Key) => client.send(new s3.DeleteObjectCommand({ Bucket: S3_BUCKET, Key }))));
}

// ---------- CORS: bez ovoga browser ne sme da šalje fajl direktno u bucket ----------
let corsDone = false;

async function setB2Cors() {
  const auth = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: 'Basic ' + Buffer.from(`${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}`).toString('base64') }
  }).then((r) => r.json());
  if (!auth.authorizationToken) throw new Error(auth.message || 'B2 prijava nije uspela');

  const call = (name, body) =>
    fetch(`${auth.apiUrl}/b2api/v2/${name}`, {
      method: 'POST',
      headers: { Authorization: auth.authorizationToken },
      body: JSON.stringify(body)
    }).then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(json.message || `${name} nije uspeo`);
      return json;
    });

  const { buckets } = await call('b2_list_buckets', { accountId: auth.accountId, bucketName: S3_BUCKET });
  if (!buckets?.length) throw new Error(`Bucket ${S3_BUCKET} ne postoji`);
  await call('b2_update_bucket', {
    accountId: auth.accountId,
    bucketId: buckets[0].bucketId,
    corsRules: [
      {
        corsRuleName: 'materijali',
        allowedOrigins: ['*'],
        allowedOperations: ['s3_put', 's3_get', 's3_head'],
        allowedHeaders: ['content-type', 'range'],
        exposeHeaders: ['etag'],
        maxAgeSeconds: 86400
      }
    ]
  });
}

async function setS3Cors() {
  const { client, s3 } = await getClient();
  await client.send(
    new s3.PutBucketCorsCommand({
      Bucket: S3_BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ['*'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['content-type', 'range'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 86400
          }
        ]
      }
    })
  );
}

// Pokušava jednom po pokretanju funkcije. Ako ključ nema dozvolu, CORS se podešava ručno (vidi README).
export async function ensureCors() {
  if (corsDone) return;
  try {
    if (/backblazeb2\.com/.test(S3_ENDPOINT)) await setB2Cors();
    else await setS3Cors();
  } catch (err) {
    console.warn('CORS nije podešen automatski:', err.message);
  }
  corsDone = true;
}
