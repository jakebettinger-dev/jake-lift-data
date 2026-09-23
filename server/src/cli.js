#!/usr/bin/env node
import { createServer } from "node:http";
import { leesConfig, controleerConfig } from "./config.js";
import { openDb, zorgVoorRuimtes, tellen, zoekOpNaam, dubbeleBestanden } from "./db/index.js";
import { Koppeling, KoppelingVerlopen } from "./graph/auth.js";
import { GraphClient } from "./graph/client.js";
import { syncRuimte } from "./graph/delta.js";
import { log } from "./lib/log.js";

const config = leesConfig();

function maakOnderdelen({ eisKoppeling = true } = {}) {
  const db = openDb(config.dbPad);
  const ruimtes = zorgVoorRuimtes(db, config.ruimtes);
  const koppeling = new Koppeling(db, config);
  if (eisKoppeling && !koppeling.status().gekoppeld) {
    throw new Error("Nog niet gekoppeld met OneDrive. Draai eerst: npm run koppelen");
  }
  const client = new GraphClient({
    basis: config.graphBasis,
    haalToken: (forceer) => koppeling.accessToken(forceer),
  });
  return { db, ruimtes, koppeling, client };
}

const leesbaar = (bytes) => {
  const eenheden = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = Number(bytes) || 0;
  while (n >= 1024 && i < eenheden.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${eenheden[i]}`;
};

// ---------------------------------------------------------------- koppelen
async function koppelen() {
  controleerConfig(config);
  const db = openDb(config.dbPad);
  zorgVoorRuimtes(db, config.ruimtes);
  const koppeling = new Koppeling(db, config);

  const url = new URL(config.redirectUri);
  const poort = Number(url.port || 80);
  const state = Math.random().toString(36).slice(2);

  log.info("");
  log.info("Open deze link in je browser en log in met het account van je OneDrive:");
  log.info("");
  log.goed(koppeling.autorisatieUrl(state));
  log.info("");
  log.stil(`Ik wacht op ${config.redirectUri} ...`);

  const code = await wachtOpCode(poort, url.pathname, state);
  await koppeling.wisselCode(code);

  // Ter bevestiging ophalen wiens OneDrive dit is.
  const client = new GraphClient({
    basis: config.graphBasis,
    haalToken: (f) => koppeling.accessToken(f),
  });
  try {
    const drive = await client.get("/me/drive");
    const wie = drive.owner?.user?.displayName ?? drive.owner?.user?.email ?? "onbekend";
    koppeling.zetAccount(wie);
    log.goed(`Gekoppeld met de OneDrive van ${wie}.`);
    if (drive.quota) {
      log.stil(`Gebruikt: ${leesbaar(drive.quota.used)} van ${leesbaar(drive.quota.total)}`);
    }
  } catch {
    log.goed("Gekoppeld.");
  }
  log.info("Volgende stap: npm run sync");
}

function wachtOpCode(poort, pad, state) {
  return new Promise((klaar, mislukt) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname !== pad) { res.writeHead(404).end(); return; }

      const fout = u.searchParams.get("error_description") ?? u.searchParams.get("error");
      const code = u.searchParams.get("code");
      const antwoord = (tekst) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<meta charset="utf-8"><body style="font-family:system-ui;padding:3rem;max-width:32rem">
                 <h2>${tekst}</h2><p>Je kunt dit tabblad sluiten.</p></body>`);
      };

      if (fout) { antwoord("Koppelen mislukt"); server.close(); mislukt(new Error(fout)); return; }
      if (u.searchParams.get("state") !== state) {
        antwoord("Koppelen mislukt"); server.close();
        mislukt(new Error("state klopt niet — mogelijk een ander tabblad")); return;
      }
      if (!code) { res.writeHead(400).end(); return; }

      antwoord("Gelukt — de bestandskluis is gekoppeld");
      server.close();
      klaar(code);
    });
    server.on("error", mislukt);
    server.listen(poort);
  });
}

// -------------------------------------------------------------------- sync
async function sync() {
  controleerConfig(config);
  const { db, ruimtes, client } = maakOnderdelen();

  for (const ruimte of ruimtes) {
    log.info(`${ruimte.naam} (${ruimte.pad}) ...`);
    const begin = Date.now();
    try {
      const t = await syncRuimte(db, client, ruimte, { log });
      const duur = ((Date.now() - begin) / 1000).toFixed(1);
      log.goed(
        `  ${t.nieuw} nieuw, ${t.gewijzigd} gewijzigd, ${t.verwijderd} verwijderd ` +
          `(${t.volledig ? "volledig ingelezen" : "bijgewerkt"}, ${duur}s)`,
      );
    } catch (fout) {
      if (fout instanceof KoppelingVerlopen) throw fout;
      if (fout.status === 404) {
        log.waarschuwing(`  map niet gevonden in OneDrive: ${ruimte.pad}`);
        log.stil("  maak hem aan, of pas RUIMTE_WERK / RUIMTE_PRIVE aan in .env");
      } else {
        log.fout(`  mislukt: ${fout.message}`);
      }
    }
  }
  status();
}

// ------------------------------------------------------------------ status
function status() {
  const { db, ruimtes, koppeling } = maakOnderdelen({ eisKoppeling: false });
  const k = koppeling.status();

  log.info("");
  if (!k.gekoppeld) log.waarschuwing("Niet gekoppeld. Draai: npm run koppelen");
  else log.info(`Gekoppeld met: ${k.account ?? "onbekend account"}`);

  for (const r of ruimtes) {
    const t = tellen(db, r.id);
    const wanneer = r.laatste_sync
      ? new Date(r.laatste_sync * 1000).toLocaleString("nl-NL")
      : "nog nooit";
    log.info("");
    log.info(`${r.naam}  (${r.pad})`);
    log.stil(`  ${t.bestanden} bestanden in ${t.mappen} mappen, samen ${leesbaar(t.bytes)}`);
    if (t.verwijderd) log.stil(`  ${t.verwijderd} verwijderd`);
    log.stil(`  laatste sync: ${wanneer}`);
  }

  const mislukt = db
    .prepare("SELECT COUNT(*) AS n FROM sync_verslag WHERE fout IS NOT NULL AND gestart > ?")
    .get(Math.floor(Date.now() / 1000) - 86400);
  if (mislukt.n) log.waarschuwing(`\n${mislukt.n} mislukte synchronisatie(s) in de afgelopen dag.`);
  log.info("");
}

// -------------------------------------------------------------------- zoek
function zoek(term) {
  if (!term) throw new Error("Geef een zoekterm mee: npm run zoek -- factuur");
  const { db, ruimtes } = maakOnderdelen({ eisKoppeling: false });
  const begin = process.hrtime.bigint();
  let totaal = 0;

  for (const r of ruimtes) {
    const treffers = zoekOpNaam(db, r.id, term);
    if (!treffers.length) continue;
    totaal += treffers.length;
    log.info(`\n${r.naam}`);
    for (const t of treffers) {
      log.stil(`  ${t.is_map ? "[map] " : ""}${t.pad}${t.is_map ? "" : "  " + leesbaar(t.grootte)}`);
    }
  }
  const ms = Number(process.hrtime.bigint() - begin) / 1e6;
  log.info(`\n${totaal} treffers in ${ms.toFixed(1)} ms — volledig uit de index, zonder netwerk.\n`);
}

// ------------------------------------------------------------------ dubbel
function dubbel() {
  const { db } = maakOnderdelen({ eisKoppeling: false });
  const groepen = dubbeleBestanden(db);
  if (!groepen.length) { log.info("\nGeen dubbele bestanden gevonden.\n"); return; }

  let teWinnen = 0;
  for (const g of groepen) {
    const perStuk = g.bytes / g.aantal;
    teWinnen += g.bytes - perStuk;
    log.info(`\n${g.aantal}x  ${leesbaar(perStuk)}`);
    for (const p of g.paden.split("\n")) log.stil(`  ${p}`);
  }
  log.info(`\nDoor telkens één kopie te bewaren win je ${leesbaar(teWinnen)}.\n`);
}

// -------------------------------------------------------------------- main
const OPDRACHTEN = { koppelen, sync, status, zoek, dubbel };

const [opdracht, ...rest] = process.argv.slice(2);
if (!opdracht || !OPDRACHTEN[opdracht]) {
  log.info(`
Bestandskluis — index en OneDrive-koppeling

  npm run koppelen        eenmalig inloggen bij Microsoft
  npm run sync            index bijwerken
  npm run status          wat er in de index staat
  npm run zoek -- <term>  zoeken op naam
  node src/cli.js dubbel  dubbele bestanden opsporen
`);
  process.exit(opdracht ? 1 : 0);
}

try {
  await OPDRACHTEN[opdracht](...rest);
} catch (fout) {
  log.fout(`\n${fout.message}\n`);
  process.exit(1);
}
