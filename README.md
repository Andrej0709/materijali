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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (fajlovi) | — |
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
lib/config.js          Podešavanja iz env promenljivih
server.js              Lokalni server
vercel.json            Podešavanje za Vercel
public/                Sve što vidi korisnik (HTML, CSS, JS, ikonice, manifest)
public/js/vendor/      Vercel Blob klijent (npm run build:vendor)
scripts/               Pravljenje ikonica i Blob klijenta
```
