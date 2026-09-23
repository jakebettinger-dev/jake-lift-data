const KLEUREN = { info: "", goed: "\x1b[32m", waarschuwing: "\x1b[33m", fout: "\x1b[31m", stil: "\x1b[90m" };
const EINDE = "\x1b[0m";

function schrijf(soort, bericht) {
  const kleur = process.stdout.isTTY ? (KLEUREN[soort] ?? "") : "";
  const einde = kleur ? EINDE : "";
  // Alleen enkele regels krijgen een tijdstip; bij lege regels en blokken
  // tekst is dat alleen maar rommelig.
  const enkeleRegel = bericht && !bericht.includes("\n");
  const tijd = enkeleRegel ? new Date().toISOString().slice(11, 19) + "  " : "";
  process.stdout.write(`${kleur}${tijd}${bericht}${einde}\n`);
}

export const log = {
  info: (b) => schrijf("info", b),
  goed: (b) => schrijf("goed", b),
  waarschuwing: (b) => schrijf("waarschuwing", b),
  fout: (b) => schrijf("fout", b),
  stil: (b) => schrijf("stil", b),
  // Stille variant voor tests: niets naar het scherm.
  uit: {
    info() {}, goed() {}, waarschuwing() {}, fout() {}, stil() {},
  },
};
