import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb, zorgVoorRuimtes, haalRuimte, mapInhoud, zoekOpNaam, dubbeleBestanden, tellen } from "../src/db/index.js";
import { GraphClient } from "../src/graph/client.js";
import { syncRuimte } from "../src/graph/delta.js";
import { log } from "../src/lib/log.js";
import { NepGraph, nepItem, nepVerwijderd } from "./nepGraph.js";

const BASIS = "https://nep.test/v1.0";
const START = `${BASIS}/me/drive/root:/Bestandskluis/Werk:/delta`;
const RUIMTES = [{ naam: "werk", pad: "Bestandskluis/Werk" }];

function opstelling(nep) {
  const db = openDb(":memory:");
  zorgVoorRuimtes(db, RUIMTES);
  const client = new GraphClient({
    basis: BASIS,
    haalToken: async () => "nep-token",
    fetchImpl: nep.fetch,
    wacht: async () => {}, // niet echt wachten tijdens tests
  });
  return { db, client };
}

const sync = (db, client) => syncRuimte(db, client, haalRuimte(db, "werk"), { log: log.uit });

// De hoofdmap komt hier bewust als LAATSTE binnen, want Microsoft garandeert
// geen volgorde. De code moet daar tegen kunnen.
const PAGINA_1 = {
  value: [
    nepItem({ id: "F1", naam: "Facturen", ouderPad: "/Bestandskluis/Werk", ouderId: "ROOT", map: true }),
    nepItem({ id: "A1", naam: "offerte.pdf", ouderPad: "/Bestandskluis/Werk", ouderId: "ROOT", grootte: 1200, hash: "HASH-X" }),
  ],
  "@odata.nextLink": `${BASIS}/delta-pagina-2`,
};

const PAGINA_2 = {
  value: [
    nepItem({ id: "A2", naam: "factuur-01.pdf", ouderPad: "/Bestandskluis/Werk/Facturen", ouderId: "F1", grootte: 1200, hash: "HASH-X" }),
    nepItem({ id: "A3", naam: "notulen.pdf", ouderPad: "/Bestandskluis/Werk/Facturen", ouderId: "F1", grootte: 500, hash: "HASH-Y" }),
    nepItem({ id: "ROOT", naam: "Werk", ouderPad: "/Bestandskluis", ouderId: "BK", map: true }),
  ],
  "@odata.deltaLink": `${BASIS}/delta-vervolg`,
};

function nepMetTweePaginas() {
  return new NepGraph().zet(START, PAGINA_1).zet(`${BASIS}/delta-pagina-2`, PAGINA_2);
}

test("eerste sync leest alles in en zet de paden goed", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);

  const t = await sync(db, client);

  assert.equal(t.nieuw, 4, "vier items: één map en drie bestanden");
  assert.equal(t.verwijderd, 0);
  assert.equal(t.volledig, true);

  const ruimte = haalRuimte(db, "werk");
  assert.equal(ruimte.root_graph_id, "ROOT", "hoofdmap van de ruimte is onthouden");
  assert.equal(ruimte.delta_link, `${BASIS}/delta-vervolg`, "deltaLink bewaard voor de volgende keer");

  const alles = db.prepare("SELECT graph_id, pad, is_map FROM items ORDER BY pad").all();
  assert.deepEqual(alles.map((r) => r.pad), [
    "/Facturen",
    "/Facturen/factuur-01.pdf",
    "/Facturen/notulen.pdf",
    "/offerte.pdf",
  ]);

  // De hoofdmap zelf hoort geen regel te zijn.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM items WHERE graph_id = 'ROOT'").get().n, 0);
});

test("kinderen van de hoofdmap staan los, ook al kwam de hoofdmap als laatste", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);
  await sync(db, client);

  const ruimte = haalRuimte(db, "werk");
  const wortel = mapInhoud(db, ruimte.id, null);
  assert.deepEqual(wortel.map((r) => r.naam), ["Facturen", "offerte.pdf"], "mappen eerst, dan bestanden");

  const inFacturen = mapInhoud(db, ruimte.id, "F1");
  assert.deepEqual(inFacturen.map((r) => r.naam), ["factuur-01.pdf", "notulen.pdf"]);
});

test("tweede sync gebruikt de deltaLink en verwerkt wijziging en verwijdering", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);
  await sync(db, client);

  // Microsoft meldt: offerte gewijzigd, map Facturen verwijderd.
  nep.zet(`${BASIS}/delta-vervolg`, {
    value: [
      nepItem({ id: "A1", naam: "offerte.pdf", ouderPad: "/Bestandskluis/Werk", ouderId: "ROOT", grootte: 9999, hash: "HASH-X" }),
      nepVerwijderd("F1"),
    ],
    "@odata.deltaLink": `${BASIS}/delta-vervolg-2`,
  });

  const t = await sync(db, client);

  assert.equal(t.nieuw, 0);
  assert.equal(t.gewijzigd, 1);
  assert.equal(t.volledig, false, "dit was een bijwerking, geen volledige inlezing");
  assert.equal(t.verwijderd, 3, "de map plus de twee bestanden eronder");

  const offerte = db.prepare("SELECT grootte FROM items WHERE graph_id = 'A1'").get();
  assert.equal(offerte.grootte, 9999);

  const ruimte = haalRuimte(db, "werk");
  assert.deepEqual(mapInhoud(db, ruimte.id, null).map((r) => r.naam), ["offerte.pdf"]);
  assert.equal(tellen(db, ruimte.id).bestanden, 1);
});

test("een verlopen deltaLink leidt tot opnieuw inlezen in plaats van een fout", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);
  await sync(db, client);

  // Microsoft: deze deltaLink is te oud.
  nep.zet(`${BASIS}/delta-vervolg`, {
    status: 410,
    body: { error: { code: "resyncRequired", message: "deltaLink verlopen" } },
  });
  // En dus wordt de startpagina opnieuw opgehaald.
  nep.zet(START, PAGINA_1).zet(`${BASIS}/delta-pagina-2`, PAGINA_2);

  const t = await sync(db, client);

  assert.equal(t.volledig, true, "valt terug op een volledige inlezing");
  const ruimte = haalRuimte(db, "werk");
  assert.equal(ruimte.delta_link, `${BASIS}/delta-vervolg`);
  assert.equal(tellen(db, ruimte.id).bestanden, 3, "de index is weer compleet");
});

test("wacht en probeert opnieuw als Microsoft afknijpt (429)", async () => {
  const nep = new NepGraph()
    .zet(START, [
      { status: 429, body: {}, headers: { "Retry-After": "1" } },
      PAGINA_1,
    ])
    .zet(`${BASIS}/delta-pagina-2`, PAGINA_2);
  const { db, client } = opstelling(nep);

  const t = await sync(db, client);

  assert.equal(t.nieuw, 4);
  assert.equal(nep.verzoeken.filter((u) => u === START).length, 2, "startpagina twee keer opgehaald");
});

test("een map die niet bestaat geeft een nette fout, geen crash", async () => {
  const nep = new NepGraph().zet(START, {
    status: 404,
    body: { error: { code: "itemNotFound", message: "Item not found" } },
  });
  const { db, client } = opstelling(nep);

  await assert.rejects(() => sync(db, client), (fout) => {
    assert.equal(fout.status, 404);
    assert.match(fout.message, /itemNotFound/);
    return true;
  });

  // De mislukking moet wel in het verslag staan.
  const verslag = db.prepare("SELECT fout FROM sync_verslag ORDER BY id DESC LIMIT 1").get();
  assert.ok(verslag.fout, "mislukte sync is vastgelegd");
});

test("zoeken en dubbele bestanden werken uit de index", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);
  await sync(db, client);
  const ruimte = haalRuimte(db, "werk");

  const treffers = zoekOpNaam(db, ruimte.id, "factuur");
  assert.deepEqual(treffers.map((r) => r.naam), ["factuur-01.pdf"]);

  // offerte.pdf en factuur-01.pdf hebben dezelfde hash: dat zijn dubbele bestanden.
  const groepen = dubbeleBestanden(db);
  assert.equal(groepen.length, 1);
  assert.equal(groepen[0].aantal, 2);
  assert.equal(groepen[0].hash, "HASH-X");
});

test("zoeken laat jokertekens niet ontsnappen", async () => {
  const nep = nepMetTweePaginas();
  const { db, client } = opstelling(nep);
  await sync(db, client);
  const ruimte = haalRuimte(db, "werk");

  // '%' hoort als gewoon teken behandeld te worden, niet als 'alles'.
  assert.equal(zoekOpNaam(db, ruimte.id, "%").length, 0);
});
