import type { City } from "@/lib/cities";
export type { City } from "@/lib/cities";

/**
 * REGIONS — Aviation hubs for Mercosul + South America.
 *
 * Replaces the global CITIES preset list. Each entry follows the same
 * City shape so every existing consumer works without type changes.
 *
 * Ordered by traffic volume (busiest first within each country).
 */
export const REGIONS: City[] = [
    // ── Brasil ───────────────────────────────────────────────────────────────
    {
        id: "gru",
        name: "São Paulo",
        country: "BR",
        iata: "GRU",
        coordinates: [-46.4731, -23.4356],
        radius: 2.49,
    },
    {
        id: "gig",
        name: "Rio de Janeiro",
        country: "BR",
        iata: "GIG",
        coordinates: [-43.2436, -22.8099],
        radius: 2.49,
    },
    {
        id: "bsb",
        name: "Brasília",
        country: "BR",
        iata: "BSB",
        coordinates: [-47.9208, -15.8711],
        radius: 2.49,
    },
    {
        id: "cnf",
        name: "Belo Horizonte",
        country: "BR",
        iata: "CNF",
        coordinates: [-43.9719, -19.6243],
        radius: 2.49,
    },
    {
        id: "ssa",
        name: "Salvador",
        country: "BR",
        iata: "SSA",
        coordinates: [-38.3324, -12.9086],
        radius: 2.49,
    },
    {
        id: "rec",
        name: "Recife",
        country: "BR",
        iata: "REC",
        coordinates: [-34.9236, -8.1265],
        radius: 2.49,
    },
    {
        id: "for",
        name: "Fortaleza",
        country: "BR",
        iata: "FOR",
        coordinates: [-38.5326, -3.775],
        radius: 2.49,
    },
    {
        id: "mao",
        name: "Manaus",
        country: "BR",
        iata: "MAO",
        coordinates: [-60.0497, -3.0386],
        radius: 2.49,
    },
    {
        id: "poa",
        name: "Porto Alegre",
        country: "BR",
        iata: "POA",
        coordinates: [-51.1771, -29.9944],
        radius: 2.49,
    },
    {
        id: "cwb",
        name: "Curitiba",
        country: "BR",
        iata: "CWB",
        coordinates: [-49.1758, -25.5285],
        radius: 2.49,
    },
    {
        id: "bel",
        name: "Belém",
        country: "BR",
        iata: "BEL",
        coordinates: [-48.4762, -1.3792],
        radius: 2.49,
    },
    // ── Argentina ─────────────────────────────────────────────────────────────
    {
        id: "eze",
        name: "Buenos Aires",
        country: "AR",
        iata: "EZE",
        coordinates: [-58.5358, -34.8222],
        radius: 2.49,
    },
    {
        id: "aep",
        name: "Buenos Aires (Aeroparque)",
        country: "AR",
        iata: "AEP",
        coordinates: [-58.4156, -34.559],
        radius: 2.49,
    },
    {
        id: "cor",
        name: "Córdoba",
        country: "AR",
        iata: "COR",
        coordinates: [-64.208, -31.3236],
        radius: 2.49,
    },
    {
        id: "mdz",
        name: "Mendoza",
        country: "AR",
        iata: "MDZ",
        coordinates: [-68.7929, -32.8317],
        radius: 2.49,
    },
    // ── Uruguai ───────────────────────────────────────────────────────────────
    {
        id: "mvd",
        name: "Montevidéu",
        country: "UY",
        iata: "MVD",
        coordinates: [-56.0308, -34.838],
        radius: 2.49,
    },
    // ── Paraguai ──────────────────────────────────────────────────────────────
    {
        id: "asu",
        name: "Assunção",
        country: "PY",
        iata: "ASU",
        coordinates: [-57.5192, -25.2399],
        radius: 2.49,
    },
    // ── Chile ─────────────────────────────────────────────────────────────────
    {
        id: "scl",
        name: "Santiago",
        country: "CL",
        iata: "SCL",
        coordinates: [-70.7858, -33.3929],
        radius: 2.49,
    },
    // ── Peru ──────────────────────────────────────────────────────────────────
    {
        id: "lim",
        name: "Lima",
        country: "PE",
        iata: "LIM",
        coordinates: [-77.1143, -12.0219],
        radius: 2.49,
    },
    // ── Bolívia ───────────────────────────────────────────────────────────────
    {
        id: "vvi",
        name: "Santa Cruz",
        country: "BO",
        iata: "VVI",
        coordinates: [-63.1354, -17.6448],
        radius: 2.49,
    },
];
