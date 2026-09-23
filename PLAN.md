# Bestandskluis — plan en structuur

Opgesteld op basis van de bouwopdracht uit `prompt-generator/`. Dit document gaat vooraf aan de
code: het legt de architectuur, de mappenstructuur en een aantal beslissingen vast.

---

## 1. Het uitgangspunt

Alles in dit plan draait om één regel:

> Een mapweergave wacht nooit op Microsoft.

De VPS houdt een eigen index bij van alle bestandsnamen, mappen, groottes en datums. Bladeren,
sorteren en zoeken komen volledig uit die index en raken het netwerk niet. De Graph API wordt maar
voor drie dingen gebruikt: de index bijwerken, de bytes ophalen van een bestand dat écht geopend
wordt, en uploads doorzetten.

Concreet doel: een map met duizenden bestanden staat binnen 200 ms op het scherm.

---

## 2. Hoe het in elkaar zit

```
Browser  ──►  Caddy  ──►  Fastify  ──►  SQLite        (bladeren, zoeken: ~5 ms, geen netwerk)
                                   └──►  cache op schijf (miniaturen, recente bestanden)

Achtergrond (los van verzoeken):
   delta-sync      elke paar minuten: wat is er in OneDrive veranderd → index bijwerken
   miniaturen      nieuwe afbeelding gezien → miniatuur maken en bewaren
   OCR + tekst     nieuw document of foto → tekst eruit halen → zoekindex
   uploadwachtrij  mislukte uploads opnieuw proberen

Grote upload:  Browser ──────────────────────────────► OneDrive   (rechtstreeks, buiten de VPS om)
Kleine upload: Browser ──► Fastify ──► OneDrive
```

De achtergrondtaken zijn bewust gescheiden van het afhandelen van verzoeken. Niets wat traag kan
zijn, zit in het pad tussen een klik en wat je op het scherm ziet.

---

## 3. Mappenstructuur

```
bestandskluis/
├── docker-compose.yml          naast Jake.Lift en de maintenance-app, eigen netwerk
├── Caddyfile                   HTTPS via Let's Encrypt
├── .env.example                alle instellingen, zonder echte waarden
│
├── server/
│   ├── src/
│   │   ├── index.js            Fastify opstarten
│   │   ├── config.js           omgevingsvariabelen inlezen en controleren bij opstarten
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   └── migraties/
│   │   ├── graph/
│   │   │   ├── auth.js         token verversen, één keer gekoppeld blijft gekoppeld
│   │   │   ├── client.js       aanroepen met herhaalpogingen en throttling
│   │   │   ├── delta.js        index bijwerken
│   │   │   └── upload.js       upload-sessies aanmaken
│   │   ├── routes/
│   │   │   ├── auth.js         inloggen, TOTP, sessies
│   │   │   ├── bestanden.js    bladeren, hernoemen, verplaatsen, prullenbak, versies
│   │   │   ├── zoeken.js       naam, documentinhoud, OCR
│   │   │   ├── uploads.js      sessie aanvragen, kleine uploads, wachtrij
│   │   │   ├── media.js        miniaturen, previews, streamen
│   │   │   └── delen.js        deellinks, inlevermap
│   │   ├── taken/              achtergrondwerk, elk met eigen tempo
│   │   │   ├── deltaSync.js
│   │   │   ├── miniaturen.js
│   │   │   ├── ocr.js
│   │   │   └── uploadWachtrij.js
│   │   └── lib/
│   │       ├── sessies.js
│   │       ├── wachtwoorden.js  Argon2
│   │       └── cache.js         schijfcache met maximum, oudste vervalt
│   └── test/
│
├── web/
│   ├── index.html
│   ├── public/manifest.json    PWA
│   └── src/
│       ├── main.js
│       ├── api.js
│       ├── state.js            actieve ruimte, weergave, selectie
│       ├── schermen/           inloggen, bladeren, camera, zoeken, delen
│       ├── componenten/        raster, lijst, tijdlijn, uploadzone, viewer
│       └── stijl/              twee accentkleuren: werk en privé
│
└── data/                       NIET in git
    ├── kluis.db
    ├── miniaturen/
    └── cache/
```

De interface is in het Nederlands, en de code ook — mapnamen, functienamen en tabelnamen. Dat
scheelt heen en weer vertalen bij het lezen van je eigen code.

---

## 4. Datamodel

SQLite met FTS5 voor het zoeken. De belangrijkste tabellen:

| Tabel | Waarvoor |
|---|---|
| `gebruikers` | inloggegevens, TOTP-geheim |
| `sessies` | actieve sessies, intrekbaar |
| `items` | de index: naam, pad, ouder, grootte, gewijzigd, hash, type, ruimte |
| `delta_status` | per ruimte de deltaLink van Microsoft |
| `tekst` | FTS5-tabel met de tekst uit documenten en OCR |
| `deellinks` | token, vervaldatum, rechten, doelmap |
| `deellink_bezoeken` | wanneer geopend, vanaf welk IP |
| `upload_wachtrij` | wat nog doorgezet moet worden |
| `favorieten`, `notities` | de extra's |

`items` is de kern. Die tabel krijgt een index op `(ruimte, ouder_id, naam)` — dat is precies de
vraag die een mapweergave stelt, en daarmee is hij in één opzoekactie beantwoord.

---

## 5. Beslissingen die afwijken van de letterlijke opdracht

Vijf punten uit de opdracht botsen met elkaar of met de VPS. Hieronder wat ik ermee doe en waarom.

### 5.1 Versiegeschiedenis — niet zelf bouwen

De opdracht vraagt om versiegeschiedenis, en ook dat OneDrive de enige bewaarplaats is. Die twee
samen betekenen: oude versies zouden op de VPS moeten staan, terwijl de VPS juist geen bestanden
mag bewaren.

Dat hoeft niet, want **OneDrive houdt zelf al versies bij**. De app toont die via de Graph API en
kan een oude versie terugzetten. Geen eigen opslag, geen dubbele administratie, en je versies
blijven bestaan ook als deze app ooit verdwijnt.

### 5.2 Dubbele bestanden — hashes ophalen, niet downloaden

Dubbele bestanden opsporen "op basis van hun inhoud" lijkt te betekenen dat je elk bestand moet
downloaden om te hashen. Bij tientallen gigabytes is dat onbegonnen werk.

Niet nodig: **de Graph API geeft de hash van elk bestand gewoon mee** bij het ophalen van de
bestandslijst. Die wordt in de index opgeslagen, en dubbele bestanden zijn daarna een kwestie van
groeperen op hash. Kost nul extra netwerkverkeer.

### 5.3 OCR — in de wachtrij, nooit tijdens een upload

OCR is het zwaarste onderdeel van de hele app, en je VPS draait al twee andere apps. Als OCR
meeloopt tijdens het uploaden, merk je dat direct in Jake.Lift.

Daarom: OCR draait als achtergrondtaak, één bestand tegelijk, met een instelbaar maximum aan
CPU-gebruik, en bij voorkeur 's nachts. Een foto is direct zichtbaar en doorzoekbaar op naam;
de tekst erin komt later beschikbaar. Als het te zwaar blijkt, is dit het eerste onderdeel dat
we uitzetten zonder dat de rest eronder lijdt.

### 5.4 Inlevermap — dat is een openbaar uploadpunt

De opdracht staat toe dat ontvangers van een link ook bestanden uploaden. Dat betekent dat iemand
zonder account op je VPS kan schrijven. Bruikbaar, maar het moet dichtgetimmerd:

- alleen in een map die je expliciet als inlevermap aanwijst, nooit in de privéruimte;
- maximum per bestand en per link, en een maximum aantal bestanden;
- snelheidslimiet per IP;
- de link heeft altijd een vervaldatum, ook als je die voor gewone deellinks uitzet;
- uploads komen in een aparte submap, zodat je ze ziet voordat ze tussen je eigen bestanden staan.

### 5.5 Twee uploadroutes — bewust, maar het is extra werk

Je koos voor klein via de VPS en groot rechtstreeks. Dat is te verdedigen, maar het betekent twee
paden die allebei onderhouden en getest moeten worden. De grens leg ik op **4 MB** (de grens die
Microsoft zelf hanteert voor een upload in één keer). Onder die grens: via de VPS. Erboven: een
upload-sessie en de browser praat rechtstreeks met OneDrive.

---

## 6. De zeven stappen

Elke stap levert iets op dat draait en te testen is.

| # | Wat | Klaar als |
|---|---|---|
| 1 | Graph-koppeling en index | een opdracht op de VPS vult de database met al je bestanden en houdt hem bij; nog geen interface |
| 2 | Inloggen, werk/privé | je kunt inloggen, wisselen van ruimte, en ziet mappen als kale lijst |
| 3 | Bladeren, zoeken, previews | bruikbaar als vervanger van de OneDrive-website |
| 4 | Uploaden | slepen, mappen, plakken, grote bestanden hervatbaar |
| 5 | Camera | foto, video, spraakmemo vanaf de telefoon |
| 6 | Deellinks | inclusief inlevermap en overzicht |
| 7 | Extra's | favorieten, recent, notities, QR, zip, dubbele bestanden, opslagoverzicht |

Stap 1 en 2 zijn samen het fundament; daarna wordt elke stap losstaand bruikbaar.

---

## 7. Wat er van jou nodig is

Voordat stap 1 tegen je echte OneDrive kan draaien, is er een app-registratie in Microsoft Entra
nodig. De klikstappen staan in **[docs/entra-instellen.md](docs/entra-instellen.md)**.

Het levert drie waarden op — client ID, client secret en redirect-URI — die in `.env` op de VPS
komen, nooit in de code en nooit in deze repo.

Daarnaast heb je een domein of subdomein nodig dat naar je VPS wijst, voor het certificaat.

> **Let op — dit wijkt af van wat hierboven in §2 staat aangenomen.** Jouw OneDrive hangt aan een
> persoonlijk Microsoft-account. Daarvoor bestaan géén *application permissions*: een app kan niet
> volledig zelfstandig bij de bestanden. Je logt één keer zelf in, waarna de app met een refresh
> token blijft werken. Praktisch gevolg: er is geen tenant ID, de authority is `consumers`, en als
> het refresh token ooit ongeldig wordt (wachtwoordwijziging, ingetrokken toestemming, secret
> verlopen) moet je één keer opnieuw inloggen. De app moet dat netjes melden in plaats van stil te
> vallen.
