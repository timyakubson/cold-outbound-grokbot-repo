#!/usr/bin/env tsx
/**
 * Minimal website scraper for ICP onboarding.
 *
 * Fetches the homepage and follows links to /about, /pricing, /customers,
 * /case-studies, and a few others. Strips HTML to text. Outputs JSON.
 *
 * Usage:
 *   npx tsx scripts/scrape-website.ts --url=https://example.com --out=/tmp/scrape.json
 */

import { writeFileSync } from "fs";

const PAGES_TO_TRY = [
  "/",
  "/about",
  "/about-us",
  "/pricing",
  "/customers",
  "/case-studies",
  "/who-we-serve",
  "/solutions",
  "/product",
];

interface Page {
  url: string;
  status: number;
  text: string;
  title: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const arg = args.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  };
  const url = get("--url");
  const out = get("--out") ?? "/tmp/scrape.json";
  if (!url) {
    console.error("Usage: scrape-website.ts --url=https://example.com [--out=path]");
    process.exit(1);
  }
  return { url, out };
}

function stripHtml(html: string): { text: string; title: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, title };
}

async function fetchPage(url: string): Promise<Page> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      redirect: "follow",
    });
    const html = await resp.text();
    const { text, title } = stripHtml(html);
    return { url, status: resp.status, text: text.slice(0, 8000), title };
  } catch (err) {
    return { url, status: 0, text: `ERROR: ${String(err)}`, title: "" };
  }
}

async function main() {
  const { url, out } = parseArgs();
  const base = new URL(url);
  const pages: Page[] = [];

  for (const path of PAGES_TO_TRY) {
    const full = new URL(path, base).toString();
    const page = await fetchPage(full);
    if (page.status === 200 && page.text.length > 200) {
      pages.push(page);
      console.error(`✓ ${full} (${page.text.length} chars)`);
    } else {
      console.error(`✗ ${full} (${page.status})`);
    }
  }

  const result = { domain: base.hostname, pages };
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.error(`\nWrote ${out} — ${pages.length} pages, ${JSON.stringify(result).length} chars`);
}

main();
