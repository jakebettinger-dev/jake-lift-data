import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SCHEMA = join(import.meta.dirname, "schema.sql");

/**
 * Opent de database en zorgt dat het schema klopt.
 * Pad ':memory:' geeft een database die alleen in het geheugen bestaat — voor tests.
 */
export function openDb(pad) {
  if (pad !== ":memory:") mkdirSync(dirname(pad), { recursive: true });
  const db = new DatabaseSync(pad);
  db.exec(readFileSync(SCHEMA, "utf8"));
  return db;
}

/** Zorgt dat beide ruimtes bestaan en geeft ze terug. */
export function zorgVoorRuimtes(db, ruimtes) {
  const invoegen = db.prepare(
    "INSERT INTO ruimtes (naam, pad) VALUES (?, ?) ON CONFLICT(naam) DO UPDATE SET pad = excluded.pad",
  );
  for (const r of ruimtes) invoegen.run(r.naam, r.pad);
  return db.prepare("SELECT * FROM ruimtes ORDER BY id").all();
}

export function haalRuimte(db, naam) {
  return db.prepare("SELECT * FROM ruimtes WHERE naam = ?").get(naam);
}

/** Aantallen per ruimte, voor het statusoverzicht. */
export function tellen(db, ruimteId) {
  return db
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE is_map = 0 AND verwijderd = 0) AS bestanden,
         COUNT(*) FILTER (WHERE is_map = 1 AND verwijderd = 0) AS mappen,
         COUNT(*) FILTER (WHERE verwijderd = 1)                AS verwijderd,
         COALESCE(SUM(grootte) FILTER (WHERE is_map = 0 AND verwijderd = 0), 0) AS bytes
       FROM items WHERE ruimte_id = ?`,
    )
    .get(ruimteId);
}

/** Inhoud van één map — de vraag die de app straks het vaakst stelt. */
export function mapInhoud(db, ruimteId, ouderGraphId) {
  return db
    .prepare(
      `SELECT naam, pad, is_map, grootte, gewijzigd, mimetype
         FROM items
        WHERE ruimte_id = ? AND ouder_graph_id IS ? AND verwijderd = 0
        ORDER BY is_map DESC, naam COLLATE NOCASE`,
    )
    .all(ruimteId, ouderGraphId);
}

/** Zoeken op naam. Komt volledig uit de index; raakt het netwerk niet. */
export function zoekOpNaam(db, ruimteId, term, limiet = 50) {
  return db
    .prepare(
      `SELECT naam, pad, is_map, grootte, gewijzigd
         FROM items
        WHERE ruimte_id = ? AND verwijderd = 0 AND naam LIKE ? ESCAPE '\\'
        ORDER BY is_map DESC, gewijzigd DESC
        LIMIT ?`,
    )
    .all(ruimteId, "%" + term.replace(/[%_\\]/g, "\\$&") + "%", limiet);
}

/** Bestanden met dezelfde inhoud, gevonden via de hash van Microsoft. */
export function dubbeleBestanden(db) {
  return db
    .prepare(
      `SELECT hash, COUNT(*) AS aantal, SUM(grootte) AS bytes,
              GROUP_CONCAT(pad, char(10)) AS paden
         FROM items
        WHERE hash IS NOT NULL AND is_map = 0 AND verwijderd = 0
        GROUP BY hash HAVING COUNT(*) > 1
        ORDER BY bytes DESC`,
    )
    .all();
}
