import { codeerPad, GraphFout } from "./client.js";
import { log as standaardLog } from "../lib/log.js";

const nuSec = () => Math.floor(Date.now() / 1000);
const naarSec = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) || null : null);

/** Microsoft levert per soort schijf een andere hash. Eén ervan is genoeg. */
function haalHash(item) {
  const h = item.file?.hashes;
  if (!h) return null;
  return h.sha256Hash ?? h.sha1Hash ?? h.quickXorHash ?? null;
}

/**
 * Leest één ruimte in en werkt de index bij.
 *
 * De eerste keer wordt alles opgehaald; daarna vraagt Microsoft via de deltaLink
 * alleen nog wat er veranderd is. Dat laatste is meestal een handvol regels,
 * ook bij tienduizenden bestanden.
 */
export async function syncRuimte(db, client, ruimte, { log = standaardLog, nu = nuSec } = {}) {
  const gestart = nu();
  const verslag = db
    .prepare("INSERT INTO sync_verslag (ruimte_id, gestart, volledig) VALUES (?, ?, ?)")
    .run(ruimte.id, gestart, ruimte.delta_link ? 0 : 1);
  const verslagId = verslag.lastInsertRowid;

  try {
    const tellers = await leesDelta(db, client, ruimte, { log, nu });
    db.prepare(
      `UPDATE sync_verslag SET geeindigd = ?, nieuw = ?, gewijzigd = ?, verwijderd = ?, volledig = ?
        WHERE id = ?`,
    ).run(nu(), tellers.nieuw, tellers.gewijzigd, tellers.verwijderd, tellers.volledig ? 1 : 0, verslagId);
    return tellers;
  } catch (fout) {
    db.prepare("UPDATE sync_verslag SET geeindigd = ?, fout = ? WHERE id = ?")
      .run(nu(), String(fout.message ?? fout), verslagId);
    throw fout;
  }
}

async function leesDelta(db, client, ruimte, { log, nu }, alVolledigGeprobeerd = false) {
  const volledig = !ruimte.delta_link;
  let url = ruimte.delta_link ?? `/me/drive/root:/${codeerPad(ruimte.pad)}:/delta`;

  const tellers = { nieuw: 0, gewijzigd: 0, verwijderd: 0, paginas: 0, volledig };
  const ctx = maakContext(db, ruimte, nu);

  try {
    while (url) {
      const pagina = await client.get(url);
      tellers.paginas++;

      db.exec("BEGIN");
      try {
        for (const item of pagina.value ?? []) verwerkItem(ctx, item, tellers);
        db.exec("COMMIT");
      } catch (fout) {
        db.exec("ROLLBACK");
        throw fout;
      }

      if (pagina["@odata.nextLink"]) {
        url = pagina["@odata.nextLink"];
        log.stil(`  ${ruimte.naam}: pagina ${tellers.paginas} verwerkt`);
      } else {
        rondAf(db, ruimte, ctx, pagina["@odata.deltaLink"] ?? null, nu());
        url = null;
      }
    }
  } catch (fout) {
    // Een verlopen deltaLink is normaal na een lange stilte: opnieuw beginnen.
    if (fout instanceof GraphFout && fout.vraagtOmVolledigeSync && !alVolledigGeprobeerd) {
      log.waarschuwing(`  ${ruimte.naam}: deltaLink verlopen, ruimte wordt opnieuw ingelezen`);
      db.prepare("UPDATE ruimtes SET delta_link = NULL WHERE id = ?").run(ruimte.id);
      return leesDelta(db, client, { ...ruimte, delta_link: null }, { log, nu }, true);
    }
    throw fout;
  }

  return tellers;
}

function maakContext(db, ruimte, nu) {
  return {
    db,
    ruimte,
    nu,
    prefix: "/" + ruimte.pad.replace(/^\/+|\/+$/g, ""),
    rootId: ruimte.root_graph_id ?? null,
    zoek: db.prepare("SELECT id, pad, is_map FROM items WHERE ruimte_id = ? AND graph_id = ?"),
    zet: db.prepare(
      `INSERT INTO items
         (ruimte_id, graph_id, ouder_graph_id, naam, pad, is_map, grootte,
          gewijzigd, gemaakt, mimetype, hash, verwijderd, bijgewerkt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(ruimte_id, graph_id) DO UPDATE SET
         ouder_graph_id = excluded.ouder_graph_id,
         naam           = excluded.naam,
         pad            = excluded.pad,
         is_map         = excluded.is_map,
         grootte        = excluded.grootte,
         gewijzigd      = excluded.gewijzigd,
         gemaakt        = excluded.gemaakt,
         mimetype       = excluded.mimetype,
         hash           = excluded.hash,
         verwijderd     = 0,
         bijgewerkt     = excluded.bijgewerkt`,
    ),
    wis: db.prepare("UPDATE items SET verwijderd = 1, bijgewerkt = ? WHERE ruimte_id = ? AND graph_id = ?"),
    wisOnder: db.prepare(
      "UPDATE items SET verwijderd = 1, bijgewerkt = ? WHERE ruimte_id = ? AND pad LIKE ? ESCAPE '\\'",
    ),
  };
}

function verwerkItem(ctx, item, tellers) {
  if (item.deleted) {
    const bestaand = ctx.zoek.get(ctx.ruimte.id, item.id);
    if (!bestaand) return; // nooit gezien, dus niets te verwijderen
    ctx.wis.run(ctx.nu(), ctx.ruimte.id, item.id);
    tellers.verwijderd++;
    if (bestaand.is_map) {
      // Alles onder een verwijderde map is ook weg.
      const patroon = bestaand.pad.replace(/[%_\\]/g, "\\$&") + "/%";
      const res = ctx.wisOnder.run(ctx.nu(), ctx.ruimte.id, patroon);
      tellers.verwijderd += res.changes ?? 0;
    }
    return;
  }

  const ouderPad = item.parentReference?.path;
  if (!ouderPad) return; // de schijf zelf, geen bestand

  const basis = decodeURIComponent(ouderPad).replace(/^\/drive(s\/[^/]+)?\/root:/, "");
  const absoluut = `${basis}/${item.name}`.replace(/\/{2,}/g, "/");

  // De hoofdmap van de ruimte zelf: onthouden waar hij staat, niet opslaan als bestand.
  if (absoluut === ctx.prefix) {
    ctx.rootId = item.id;
    ctx.db.prepare("UPDATE ruimtes SET root_graph_id = ? WHERE id = ?").run(item.id, ctx.ruimte.id);
    return;
  }
  if (!absoluut.startsWith(ctx.prefix + "/")) return; // valt buiten deze ruimte

  const relatief = absoluut.slice(ctx.prefix.length);
  const ouderId = item.parentReference.id === ctx.rootId ? null : (item.parentReference.id ?? null);
  const bestaand = ctx.zoek.get(ctx.ruimte.id, item.id);

  ctx.zet.run(
    ctx.ruimte.id,
    item.id,
    ouderId,
    item.name,
    relatief,
    item.folder ? 1 : 0,
    item.size ?? 0,
    naarSec(item.lastModifiedDateTime),
    naarSec(item.createdDateTime),
    item.file?.mimeType ?? null,
    haalHash(item),
    ctx.nu(),
  );

  if (bestaand) tellers.gewijzigd++;
  else tellers.nieuw++;
}

/**
 * Na afloop: de deltaLink bewaren, en kinderen van de hoofdmap losmaken.
 * Dat laatste is nodig omdat de hoofdmap niet altijd als eerste binnenkomt.
 */
function rondAf(db, ruimte, ctx, deltaLink, tijd) {
  if (ctx.rootId) {
    db.prepare(
      "UPDATE items SET ouder_graph_id = NULL WHERE ruimte_id = ? AND ouder_graph_id = ?",
    ).run(ruimte.id, ctx.rootId);
  }
  db.prepare("UPDATE ruimtes SET delta_link = ?, laatste_sync = ? WHERE id = ?")
    .run(deltaLink, tijd, ruimte.id);
}
