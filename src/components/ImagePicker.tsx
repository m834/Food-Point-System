'use client';

import { useEffect, useState } from 'react';
import { api, imageUrl, type ImageKind } from '@/lib/api';
import { strings } from '@/lib/strings';

/**
 * Choose a photo for a menu item, a category or a deal.
 *
 * Two ways in, because shops arrive with photos in two different states:
 *
 *  - **Upload** opens the OS file picker and copies one photo in. This is the
 *    owner adding a picture to one dish.
 *  - **Pick existing** lists what is already in the upload folder. This is the
 *    case after a bulk drop-in, where fifty photos are already on disk named
 *    to match the menu and each item just needs pointing at one.
 *
 * The preview is deliberately the same size the order grid renders, so what
 * the owner approves here is what the counter sees.
 */
export function ImagePicker({
  kind,
  value,
  onChange,
}: {
  kind: ImageKind;
  value: string | null;
  onChange: (file: string | null) => void;
}) {
  const [existing, setExisting] = useState<string[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [value]);

  const loadExisting = async () => {
    try {
      setExisting(await api.images.list(kind));
      setBrowsing(true);
    } catch {
      setExisting([]);
      setBrowsing(true);
    }
  };

  const upload = async () => {
    setBusy(true);
    setError('');
    try {
      const picked = await api.images.choose(kind);
      // A cancelled dialog is not an error; it just changes nothing.
      if (picked) onChange(picked.file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that photo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-picker">
      {/* A logo must be shown whole. Food photos are cropped to fill the
          tile because that is how they appear on the order grid; a logo
          cropped is just a broken logo. */}
      <div className={`image-picker-preview${kind === 'logo' ? ' contain' : ''}`}>
        {value && !failed ? (
          <img src={imageUrl(kind, value)} alt="" onError={() => setFailed(true)} />
        ) : (
          <div className="image-picker-empty">
            {value ? strings.images.missingFile : strings.images.noPhoto}
          </div>
        )}
      </div>

      <div className="image-picker-actions">
        <button type="button" className="btn sm" onClick={upload} disabled={busy}>
          {value ? strings.images.replace : strings.images.upload}
        </button>
        <button type="button" className="btn sm" onClick={loadExisting} disabled={busy}>
          {strings.images.pickExisting}
        </button>
        {value ? (
          <button
            type="button"
            className="btn ghost sm"
            style={{ color: 'var(--danger)' }}
            onClick={() => onChange(null)}
          >
            {strings.images.remove}
          </button>
        ) : null}
      </div>

      {value ? <div className="tiny muted image-picker-name">{value}</div> : null}
      {error ? <div className="tiny" style={{ color: 'var(--danger)' }}>{error}</div> : null}

      {browsing ? (
        <div className="image-browse">
          <div className="row-between">
            <span className="tiny muted">
              {existing.length
                ? strings.images.pickOne
                : strings.images.folderEmpty}
            </span>
            <button type="button" className="btn ghost sm" onClick={() => setBrowsing(false)}>
              {strings.common.close}
            </button>
          </div>

          {existing.length ? (
            <div className="image-browse-grid">
              {existing.map((file) => (
                <button
                  type="button"
                  key={file}
                  className={`image-browse-tile${value === file ? ' active' : ''}`}
                  onClick={() => {
                    onChange(file);
                    setBrowsing(false);
                  }}
                  title={file}
                >
                  <img src={imageUrl(kind, file)} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="btn sm" onClick={() => void bulkImport(kind, setError)}>
              {strings.images.importFolder}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Bulk drop-in: point at the designer's folder and copy the lot in one go. */
async function bulkImport(kind: ImageKind, setError: (message: string) => void) {
  try {
    await api.images.importFolder(kind);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Could not import that folder.');
  }
}
