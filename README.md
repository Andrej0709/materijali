# Odeljenje — materijali za razred

Web aplikacija na kojoj učenici iz odeljenja kače materijale za odgovaranje, urađene domaće, slike table, beleške i pripreme za kontrolne. Kad neko objavi materijal, padaju konfete 🎉

Pravljena prvenstveno za telefon: može da se doda na početni ekran kao aplikacija, ima dugme za slikanje table i "povuci za osvežavanje".

## Postavljanje na Vercel

Vercel nema trajni disk, pa aplikacija tamo čuva **fajlove u Vercel Blob**, a **podatke u Upstash Redis**. Oba imaju besplatan plan.

1. Na [vercel.com](https://vercel.com) → **Add New… → Project** → izaberi ovaj GitHub repo → **Deploy**.
   (Framework Preset ostavi na *Other*; sve je već podešeno u `vercel.json`.)
2. U projektu otvori **Storage** → **Create Database** → **Blob** → poveži sa projektom.
   Ovo automatski dodaje `BLOB_STORE_ID` (noviji način) ili `BLOB_READ_WRITE_TOKEN` (stariji); aplikacija radi sa oba.
3. Opet **Storage** → **Create Database** → **Upstash for Redis** (Marketplace) → poveži sa projektom.
   Ovo automatski dodaje `KV_REST_API_URL` i `KV_REST_API_TOKEN`.
4. **Settings → Environment Variables** → dodaj:
   - `CLASS_NAME` — ime odeljenja, npr. `III-2`
   - `CLASS_CODE` — šifra koju učenici unesu jednom (preporučeno, da materijale vidi samo odeljenje)
   - `SESSION_SECRET` — bilo koji dugačak nasumičan tekst
5. **Deployments** → poslednji deploy → **Redeploy**, da bi nove promenljive počele da važe.

Ako nešto od ovoga fali, aplikacija na ekranu napiše šta nije povezano.

**Napomena:** fajlovi u Blobu imaju javne, ali nepogodive linkove (nasumičan deo od 32 znaka). Linkove vide samo oni koji znaju šifru odeljenja.

## Više prostora: Backblaze B2 (10 GB besplatno, bez kartice)

Vercel Blob ima samo 1 GB. Kad postaviš B2, **novi** fajlovi idu u B2, a stari ostaju u Blobu i rade normalno. Fajlovi u B2 su privatni: otvaraju se samo preko kratkotrajnih potpisanih linkova koje aplikacija daje ulogovanima.

1. Napravi nalog na [backblaze.com](https://www.backblaze.com/sign-up/cloud-storage) (B2 Cloud Storage). Za **Region** izaberi **EU Central** (najbliže Srbiji; kasnije ne može da se menja).
2. **Buckets → Create a Bucket**
   - Bucket Unique Name: npr. `materijali-34-tvojenime` (mora biti jedinstveno na celom B2)
   - Files in Bucket are: **Private**
   - Ostalo ostavi kako jeste → **Create a Bucket**
   - Prepiši **Endpoint** sa kartice bucketa, npr. `s3.eu-central-003.backblazeb2.com`
3. **Application Keys → Add a New Application Key**
   - Name: `materijali`
   - Allow access to Bucket(s): **All** (potrebno da aplikacija sama podesi CORS)
   - Type of Access: **Read and Write**
   - Prepiši **keyID** i **applicationKey** — applicationKey se prikazuje samo jednom!
4. Na Vercelu, **Settings → Environment Variables**, dodaj:
   - `S3_ENDPOINT` = `https://` + Endpoint, npr. `https://s3.eu-central-003.backblazeb2.com`
   - `S3_BUCKET` = ime bucketa
   - `S3_ACCESS_KEY_ID` = keyID
   - `S3_SECRET_ACCESS_KEY` = applicationKey
5. **Redeploy**. Pri prvom slanju aplikacija sama podesi CORS na bucketu.

Besplatno: 10 GB prostora; preuzimanja su besplatna do 3× količine sačuvanih podataka mesečno. Bez kartice B2 ne može ništa da naplati — ako se pređe limit, samo privremeno stane.

**Cloudflare R2** (10 GB, neograničeno preuzimanje, ali traži karticu) radi sa istim promenljivim: `S3_ENDPOINT` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, ključ napravi u **R2 → Manage API Tokens** (Object Read & Write). Tom ključu nije dozvoljeno da menja CORS, pa u bucketu → **Settings → CORS Policy** nalepi:

```json
[{ "AllowedOrigins": ["*"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedHeaders": ["content-type", "range"], "MaxAgeSeconds": 86400 }]
```

## Lokalno pokretanje

Potreban je [Node.js](https://nodejs.org) 20 ili noviji.

```bash
npm install
npm start
```

Otvori http://localhost:3000. Lokalno se fajlovi i baza čuvaju u folderu `data/`. Ako lokalno postaviš `BLOB_READ_WRITE_TOKEN` i Redis promenljive (npr. preko `vercel env pull`), koristiće se isto što i na Vercelu.

## Podešavanja

| Promenljiva | Šta radi | Podrazumevano |
| --- | --- | --- |
| `CLASS_NAME` | Ime odeljenja u zaglavlju | `Naše odeljenje` |
| `CLASS_CODE` | Šifra za ulaz. Prazno = bez šifre. | prazno |
| `SESSION_SECRET` | Tajna za kolačić prijave | `odeljenje` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Backblaze B2 ili Cloudflare R2 (fajlovi, 10 GB). Ako su postavljeni, imaju prednost nad Blobom. | — |
| `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` | Vercel Blob (fajlovi, 1 GB) | — |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis (podaci). Rade i `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. | — |
| `PORT`, `DATA_DIR` | Samo lokalno | `3000`, `./data` |

Predmeti i vrste materijala menjaju se u `public/js/config.js`.

## Šta aplikacija radi

- **Objavljivanje:** naslov, predmet, vrsta (odgovaranje / domaći / kontrolni / beleške), opis i do 10 fajlova od po 25 MB. Na telefonu postoji dugme **Slikaj tablu ili svesku**, a slike se pre slanja same smanje (fotka od 8 MB postane ~1 MB).
- **Pretraga:** po naslovu, opisu, autoru i imenima fajlova, radi i bez kvačica (`resenja` nalazi `rešenja`).
- **Podeli:** šalje link do materijala u Viber/WhatsApp grupu; link otvara baš taj materijal.
- **Hvala (srce)**, i **brisanje** svojih materijala (samo sa uređaja sa kog su objavljeni).
- **Na telefonu:** dodavanje na početni ekran (PWA), povuci za osvežavanje, dugme nazad zatvara prozor, mali naslov u traci kad se skroluje, veće mete za prst.

## Animacije

Pravljene po principima iz Apple-ovog *Designing Fluid Interfaces*:

- Sve ide preko opruga (`public/js/spring.js`): damping + response, kao na iOS-u. Animacije se mogu prekinuti i preusmeriti u svakom trenutku.
- Na telefonu je forma donji sheet koji se vuče prstom: prati prst 1:1, ima meku granicu na vrhu, a pri puštanju koristi brzinu prsta da odluči da li se zatvara. Stranica iza se blago povuče unazad.
- Na računaru prozor izranja iz dugmeta koje ga je otvorilo.
- Kartice klize na nova mesta kad menjaš filtere (FLIP + opruga).
- Konfete i kvačica u istom frejmu kad se objava pošalje, plus vibracija na Android telefonima.
- Poštuje `prefers-reduced-motion` (umesto klizanja kratko pretapanje, bez konfeta), tamni režim i smanjenu providnost.

## Struktura

```
api/index.js           Vercel funkcija (sve /api/* rute)
lib/app.js             Express rute: objave, upload, šifra
lib/store.js           Podaci: Redis na Vercelu, JSON fajl lokalno
lib/s3.js              Fajlovi u Backblaze B2 / Cloudflare R2
lib/config.js          Podešavanja iz env promenljivih
server.js              Lokalni server
vercel.json            Podešavanje za Vercel
public/                Sve što vidi korisnik (HTML, CSS, JS, ikonice, manifest)
public/js/vendor/      Vercel Blob klijent (npm run build:vendor)
scripts/               Pravljenje ikonica i Blob klijenta
```
