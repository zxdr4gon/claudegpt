import { useEffect, useRef, useState } from 'react';
import { useOpenStore } from '../app/StoreContext';
import type { Clock } from '../model/items';
import { dateIn } from '../parser/time';
import {
  BackupFormatError,
  StalePreviewError,
  checkBackupSize,
  exportBackup,
  importBackup,
  parseBackupFile,
  previewImport,
  type ImportPreview,
  type ImportResult,
} from '../store/backup';
import { formatDay } from './format';

/** `refreshed`: the preview was recomputed at confirm because something changed. */
type Pending = { fileName: string; data: unknown; preview: ImportPreview; refreshed?: boolean };

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sentence per count that isn't zero. */
function describeResult(r: ImportResult, future: boolean): string[] {
  const lines: string[] = [];
  const verb = (now: string, later: string) => (future ? later : now);
  if (r.added) lines.push(`${verb('Added', 'Adds')} ${plural(r.added, 'new item')}.`);
  if (r.updated) lines.push(`${verb('Replaced', 'Replaces')} ${plural(r.updated, 'item')} with a newer version from the file.`);
  if (r.unchanged) {
    const state = r.unchanged === 1 ? 'as it is' : 'as they are';
    lines.push(`${verb('Left', 'Leaves')} ${plural(r.unchanged, 'item')} ${state} (already up to date here).`);
  }
  if (r.invalid) lines.push(`${verb('Skipped', 'Skips')} ${plural(r.invalid, 'entry', 'entries')} that couldn’t be read.`);
  if (r.duplicates) lines.push(`${verb('Ignored', 'Ignores')} ${plural(r.duplicates, 'duplicate entry', 'duplicate entries')}.`);
  if (lines.length === 0) lines.push('The file has no items.');
  return lines;
}

function download(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const buttonClass =
  'rounded-lg border border-rule bg-raised px-3 py-1.5 text-[15px] font-medium hover:bg-rule/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-muted';
const primaryClass =
  'rounded-lg bg-ink px-3 py-1.5 text-[15px] font-medium text-paper hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50';

/**
 * Export and import (DECISIONS #4, #22). Importing always shows what it will
 * do first and waits for a confirm; nothing is written before that.
 */
export function BackupPanel({ clock, onClose }: { clock: Clock; onClose: () => void }) {
  const store = useOpenStore();
  const [lastExport, setLastExport] = useState<number | undefined>();
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; lines: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (store) void store.lastExportAt().then(setLastExport);
  }, [store]);

  async function onExport() {
    if (!store) return;
    setBusy(true);
    try {
      const at = Date.now();
      const backup = await exportBackup(store, at);
      download(`capture-backup-${dateIn(at, clock.tz)}.json`, JSON.stringify(backup, null, 2));
      setLastExport(at);
      setMessage({ tone: 'ok', lines: [`Exported ${plural(backup.items.length, 'item')}.`] });
    } catch {
      setMessage({ tone: 'error', lines: ['Couldn’t create the backup file. Try again.'] });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    if (!store) return;
    setMessage(null);
    setPending(null);
    setBusy(true);
    try {
      // Refuse oversized files by their byte size, before reading them at all.
      checkBackupSize(file.size);
      const data = parseBackupFile(await file.text());
      setPending({ fileName: file.name, data, preview: await previewImport(store, data) });
    } catch (error) {
      const text = error instanceof BackupFormatError ? error.message : 'Couldn’t read that file.';
      setMessage({ tone: 'error', lines: [text] });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onConfirm() {
    if (!store || !pending) return;
    setBusy(true);
    try {
      const result = await importBackup(store, pending.data, pending.preview);
      setPending(null);
      setMessage({ tone: 'ok', lines: ['Import finished.', ...describeResult(result, false)] });
    } catch (error) {
      if (error instanceof StalePreviewError) {
        // Nothing was written. Show what would happen now and ask again.
        setPending({ ...pending, preview: error.preview, refreshed: true });
        return;
      }
      const text =
        error instanceof BackupFormatError
          ? error.message
          : 'The import didn’t finish, so nothing was changed. Try again.';
      setMessage({ tone: 'error', lines: [text] });
    } finally {
      setBusy(false);
    }
  }

  const lastExportText = lastExport
    ? `Last exported ${formatDay(dateIn(lastExport, clock.tz), clock).toLowerCase()}.`
    : 'You haven’t exported a backup yet.';

  return (
    <section aria-labelledby="backup-heading" className="flex flex-col gap-8 pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="backup-heading" className="text-lg font-semibold">
          Backup and restore
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[15px] font-medium text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Export</h3>
        <p className="max-w-prose text-[15px] leading-6 text-muted">
          Everything lives only in this browser. A backup file is how you keep it safe or move it to another browser.{' '}
          {lastExportText}
        </p>
        <div>
          <button type="button" className={buttonClass} disabled={!store || busy} onClick={() => void onExport()}>
            Export backup
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Import</h3>
        <p className="max-w-prose text-[15px] leading-6 text-muted">
          Merges a backup file into what’s here. For each item, the newer version wins; nothing newer here is replaced.
          You’ll see what will change before anything happens.
        </p>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            id="backup-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
          <label htmlFor="backup-file" className={`${buttonClass} inline-block cursor-pointer`}>
            Choose backup file…
          </label>
        </div>

        {pending && (
          <div className="mt-2 flex flex-col gap-3 rounded-lg border border-rule bg-raised p-4" role="region" aria-label="Import preview">
            {pending.refreshed && (
              <p role="alert" className="text-[15px] leading-6">
                Something changed since you chose this file, perhaps in another tab, so nothing was imported. The summary
                below is up to date. Check it and import again.
              </p>
            )}
            <p className="text-[15px] font-medium [overflow-wrap:anywhere]">Importing “{pending.fileName}”:</p>
            <ul className="list-disc pl-5 text-[15px] leading-6">
              {describeResult(pending.preview, true).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {pending.preview.updated > 0 && (
              <p className="text-[14px] leading-6 text-muted">
                Replaced items can be recovered only from a backup.{' '}
                <button type="button" className="font-medium text-focus underline-offset-2 hover:underline" onClick={() => void onExport()}>
                  Export a backup of this browser first
                </button>
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className={primaryClass}
                disabled={busy || pending.preview.added + pending.preview.updated === 0}
                onClick={() => void onConfirm()}
              >
                Import
              </button>
              <button type="button" className={buttonClass} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {message && (
        <div
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 text-[15px] leading-6 ${message.tone === 'error' ? 'border-mark-priority bg-mark-priority/40' : 'border-rule bg-raised'}`}
        >
          {message.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}
