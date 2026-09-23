-- Index van de bestandskluis.
-- Hier staan alleen gegevens OVER bestanden; de bestanden zelf blijven in OneDrive.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- De twee ruimtes: werk en prive.
CREATE TABLE IF NOT EXISTS ruimtes (
  id            INTEGER PRIMARY KEY,
  naam          TEXT    NOT NULL UNIQUE,   -- 'werk' of 'prive'
  pad           TEXT    NOT NULL,          -- pad in OneDrive, bv. Bestandskluis/Werk
  delta_link    TEXT,                      -- waar de volgende sync verder gaat
  laatste_sync  INTEGER                    -- unix-seconden
);

-- De index zelf. Eén regel per bestand of map.
CREATE TABLE IF NOT EXISTS items (
  id              INTEGER PRIMARY KEY,
  ruimte_id       INTEGER NOT NULL REFERENCES ruimtes(id) ON DELETE CASCADE,
  graph_id        TEXT    NOT NULL,        -- id bij Microsoft
  ouder_graph_id  TEXT,                    -- NULL voor de hoofdmap van een ruimte
  naam            TEXT    NOT NULL,
  pad             TEXT    NOT NULL,        -- pad binnen de ruimte, begint met /
  is_map          INTEGER NOT NULL DEFAULT 0,
  grootte         INTEGER NOT NULL DEFAULT 0,
  gewijzigd       INTEGER,
  gemaakt         INTEGER,
  mimetype        TEXT,
  hash            TEXT,                    -- van Microsoft; voor het opsporen van dubbele bestanden
  verwijderd      INTEGER NOT NULL DEFAULT 0,
  bijgewerkt      INTEGER NOT NULL,
  UNIQUE (ruimte_id, graph_id)
);

-- Dit is de vraag die een mapweergave stelt. Eén index, één opzoekactie.
CREATE INDEX IF NOT EXISTS idx_items_map
  ON items (ruimte_id, ouder_graph_id, verwijderd, naam);

-- Voor 'recent gewijzigd' en de tijdlijnweergave.
CREATE INDEX IF NOT EXISTS idx_items_gewijzigd
  ON items (ruimte_id, verwijderd, gewijzigd DESC);

-- Voor het opsporen van dubbele bestanden, zonder ze te hoeven downloaden.
CREATE INDEX IF NOT EXISTS idx_items_hash
  ON items (hash) WHERE hash IS NOT NULL;

-- Zoeken op naam, direct uit de index.
CREATE INDEX IF NOT EXISTS idx_items_naam
  ON items (ruimte_id, verwijderd, naam);

-- De koppeling met Microsoft. Eén regel, want er is één gekoppeld account.
CREATE TABLE IF NOT EXISTS koppeling (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token  TEXT    NOT NULL,
  access_token   TEXT,
  verloopt       INTEGER,                  -- unix-seconden
  account        TEXT,                     -- ter herkenning, bv. het e-mailadres
  bijgewerkt     INTEGER NOT NULL
);

-- Verslag van elke synchronisatie, om te kunnen zien of het goed gaat.
CREATE TABLE IF NOT EXISTS sync_verslag (
  id           INTEGER PRIMARY KEY,
  ruimte_id    INTEGER REFERENCES ruimtes(id) ON DELETE CASCADE,
  gestart      INTEGER NOT NULL,
  geeindigd    INTEGER,
  nieuw        INTEGER NOT NULL DEFAULT 0,
  gewijzigd    INTEGER NOT NULL DEFAULT 0,
  verwijderd   INTEGER NOT NULL DEFAULT 0,
  volledig     INTEGER NOT NULL DEFAULT 0,  -- 1 als de hele ruimte opnieuw is ingelezen
  fout         TEXT
);
