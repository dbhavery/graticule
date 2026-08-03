"""Build web/data/world_population.json — the dataset behind the WORLD tab.

Source: World Bank Open Data (no key, no rate limit, stable for a decade).
  SP.POP.TOTL  population, total
  SP.POP.GROW  population growth (annual %)
  /country     ISO2 code + region, used for flags and the continent rollup

Baked to a static file on purpose. The WORLD tab has to tick every 100ms; it
must not depend on a live API at render time, and Don asked for low latency.
Re-run this script when the World Bank publishes a new year.

Continent rollup: the World Bank's seven regions are lending regions, not
continents, so they are remapped to the six the dashboard shows. The two
ambiguous splits are handled by explicit ISO2 lists below rather than by
guessing at a region name:
  - Oceania is carved out of "East Asia & Pacific"
  - "Middle East, North Africa, Afghanistan & Pakistan" is split between
    Africa and Asia
The rollup is self-checking: run with --verify to compare the computed
continent totals against the reference figures observed in the source video,
which come from an independent estimator. A mapping error shows up as a
continent that is off by tens of millions.
"""
import argparse
import json
import pathlib
import sys
import urllib.request

WB = "https://api.worldbank.org/v2"
OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "data" / "world_population.json"

OCEANIA = {"AU", "NZ", "PG", "FJ", "SB", "VU", "WS", "TO", "KI", "FM",
           "MH", "NR", "PW", "TV"}
# "Middle East, North Africa, Afghanistan & Pakistan" -> the African half.
MENA_AFRICA = {"DZ", "EG", "LY", "MA", "TN", "DJ", "MT"}
# The World Bank files these under "Europe & Central Asia"; the UN geoscheme
# the dashboard follows counts them as Asia, and leaving them in Europe
# inflates it by ~80M.
CENTRAL_ASIA = {"KZ", "KG", "TJ", "TM", "UZ", "AZ", "AM", "GE", "TR", "CY"}

REGION_TO_CONTINENT = {
    "East Asia & Pacific": "Asia",           # minus OCEANIA, applied below
    "Europe & Central Asia": "Europe",
    "Latin America & Caribbean": "Latin America",
    "Middle East, North Africa, Afghanistan & Pakistan": "Asia",  # minus MENA_AFRICA
    "Middle East & North Africa": "Asia",    # older label, same treatment
    "North America": "North America",
    "South Asia": "Asia",
    "Sub-Saharan Africa": "Africa",
}

# Observed in LiveStream07 "World Population Reaches 8.3 Billion People!"
# at 2026-08-02 14:35:57 UTC. An independent estimator, used only as a control.
VIDEO_REFERENCE = {
    "Asia": 4_867_053_546, "Africa": 1_587_079_455, "Europe": 743_845_802,
    "Latin America": 672_904_475, "North America": 390_095_419,
    "Oceania": 47_186_193,
}


def fetch(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def indicator(code, year):
    payload = fetch(f"{WB}/country/all/indicator/{code}"
                    f"?format=json&date={year}&per_page=400")
    if not isinstance(payload, list) or len(payload) < 2:
        sys.exit(f"World Bank returned no rows for {code}: {payload!r:.200}")
    return {row["countryiso3code"]: row["value"]
            for row in payload[1] if row["value"] is not None}


def continent_of(iso2, region):
    if iso2 in OCEANIA:
        return "Oceania"
    if iso2 in MENA_AFRICA:
        return "Africa"
    if iso2 in CENTRAL_ASIA:
        return "Asia"
    # The World Bank ships these with a trailing space ("Sub-Saharan Africa ").
    return REGION_TO_CONTINENT.get(region.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", default="2024",
                    help="World Bank data year (latest complete)")
    ap.add_argument("--verify", action="store_true",
                    help="compare continent totals against the video reference")
    args = ap.parse_args()

    meta = fetch(f"{WB}/country?format=json&per_page=400")[1]
    pop = indicator("SP.POP.TOTL", args.year)
    grow = indicator("SP.POP.GROW", args.year)

    countries, unmapped = [], []
    for c in meta:
        if c["region"]["value"] == "Aggregates":
            continue
        iso3, iso2 = c["id"], c["iso2Code"]
        if iso3 not in pop:
            continue
        cont = continent_of(iso2, c["region"]["value"])
        if cont is None:
            unmapped.append((c["name"], c["region"]["value"]))
            continue
        countries.append({
            "name": c["name"],
            "iso2": iso2.lower(),          # flagcdn.com wants lowercase
            "pop": int(pop[iso3]),
            # annual % -> fraction; the client compounds it from the epoch
            "rate": round((grow.get(iso3) or 0.0) / 100.0, 6),
            "continent": cont,
        })

    if unmapped:
        print("UNMAPPED (excluded, fix REGION_TO_CONTINENT):", file=sys.stderr)
        for name, region in unmapped:
            print(f"  {name} <- {region}", file=sys.stderr)

    countries.sort(key=lambda c: -c["pop"])

    totals = {}
    for c in countries:
        totals[c["continent"]] = totals.get(c["continent"], 0) + c["pop"]

    if args.verify:
        print(f"\ncontinent rollup, World Bank {args.year} vs video reference "
              f"(a different estimator, and 2 years later — a few % is expected,"
              f" tens of % is a mapping bug):")
        ok = True
        for name, ref in sorted(VIDEO_REFERENCE.items(), key=lambda kv: -kv[1]):
            got = totals.get(name, 0)
            delta = (got - ref) / ref * 100
            flag = "" if abs(delta) < 12 else "   <-- CHECK"
            if abs(delta) >= 12:
                ok = False
            print(f"  {name:<15} {got:>15,}  ref {ref:>15,}  {delta:+6.1f}%{flag}")
        print(f"  {'WORLD':<15} {sum(totals.values()):>15,}  "
              f"ref {sum(VIDEO_REFERENCE.values()):>15,}")
        if not ok:
            sys.exit("continent mapping looks wrong")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "World Bank Open Data (SP.POP.TOTL, SP.POP.GROW)",
        "year": int(args.year),
        "countries": countries,
    }, indent=1), encoding="utf8")
    print(f"\nwrote {OUT}  ({len(countries)} countries, "
          f"{OUT.stat().st_size / 1024:.1f} KB)")


main()
