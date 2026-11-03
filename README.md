# claudegpt

A local-first quick-capture organizer: capture now, decide later.

- Product scope: [docs/PRODUCT.md](docs/PRODUCT.md)
- Decisions and item schema: [docs/DECISIONS.md](docs/DECISIONS.md)

## Development

```bash
npm install
npm run dev        # Vite dev server
npm test           # Vitest (runs under TZ=Pacific/Chatham)
npm run typecheck
npm run build
```

## Layout

- `src/parser/` — text → detected values (`parse.ts`), timezone helpers (`time.ts`), span tracking across edits (`track.ts`)
- `src/model/` — item schema (`item.ts`), capture/edit/correction rules (`items.ts`), Inbox rule (`inbox.ts`)
- `src/store/` — the only writer: Dexie-backed `ItemStore` (`store.ts`), JSON backup (`backup.ts`), persistent-storage request (`persist.ts`)
- `src/search/` — in-memory MiniSearch index (`index.ts`) and its 10k-item performance test
- `src/db.ts` — Dexie schema
