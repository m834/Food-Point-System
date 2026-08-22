'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { useApp } from '@/components/AppContext';
import { Card, Field, Modal, Notice } from '@/components/ui';
import { ImagePicker } from '@/components/ImagePicker';
import { SlipPreview } from '@/components/SlipPreview';
import { StaffManager } from '@/components/StaffManager';
import { ExtrasManager } from '@/components/ExtrasManager';
import { IconPrint } from '@/components/icons';
import { api, imageUrl } from '@/lib/api';
import { strings } from '@/lib/strings';
import { bytes, dateTime } from '@/lib/format';
import { SETTING_KEYS, type BackupRecord, type SettingsMap } from '../../../shared/types';

export default function SettingsPage() {
  const { toast, license, refreshSettings } = useApp();

  const [values, setValues] = useState<SettingsMap>({});
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string }>>([]);
  const [last, setLast] = useState<BackupRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, printerList, lastBackup] = await Promise.all([
        api.settings.all(),
        api.printing.listPrinters().catch(() => []),
        api.backup.last().catch(() => null),
      ]);
      setValues(all);
      setPrinters(printerList);
      setLast(lastBackup);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not load settings.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    try {
      await api.settings.save(values);
      // The sidebar and every money label read from here.
      await refreshSettings();
      toast(strings.settings.saved, 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    try {
      const record = await api.backup.now();
      setLast(record);
      toast(`Backed up to ${record.path}`, 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup failed.';
      // "Backup cancelled" is a choice, not an error worth a red toast.
      toast(message, message.includes('cancelled') ? 'info' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await api.backup.restore();
      toast('Backup restored.', 'ok');
      await load();
      await refreshSettings();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Restore failed.';
      toast(message, message.includes('cancelled') ? 'info' : 'error');
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    try {
      await api.printing.testPrint();
      toast('Test sent to the printer.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The test did not print.', 'error');
    }
  };

  if (loading) {
    return (
      <AppShell title={strings.settings.title}>
        <div className="empty">{strings.common.loading}</div>
      </AppShell>
    );
  }

  const pinSet = values.manager_pin_set === '1';

  return (
    <AppShell
      title={strings.settings.title}
      actions={
        <button className="btn primary" onClick={save} disabled={busy}>
          {strings.settings.save}
        </button>
      }
    >
      <div className="grid" style={{ gap: 18, maxWidth: 820 }}>
        {/* --- business, printed on every bill --- */}
        <Card>
          <h2 style={{ marginBottom: 14 }}>{strings.settings.business}</h2>
          <div className="grid" style={{ gap: 14 }}>
            <Field label={strings.settings.businessName}>
              <input
                className="input"
                value={values[SETTING_KEYS.businessName] ?? ''}
                onChange={(event) => set(SETTING_KEYS.businessName, event.target.value)}
              />
            </Field>
            <div className="field-row">
              <Field label={strings.settings.address}>
                <input
                  className="input"
                  value={values[SETTING_KEYS.businessAddress] ?? ''}
                  onChange={(event) => set(SETTING_KEYS.businessAddress, event.target.value)}
                />
              </Field>
              <Field label={strings.settings.phone}>
                <input
                  className="input"
                  value={values[SETTING_KEYS.businessPhone] ?? ''}
                  onChange={(event) => set(SETTING_KEYS.businessPhone, event.target.value)}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* --- the shop's mark and closing line, both printed on the bill --- */}
        <Card>
          <h2 style={{ marginBottom: 4 }}>{strings.settings.slip}</h2>
          <p className="tiny muted" style={{ marginBottom: 14 }}>
            {strings.settings.slipHint}
          </p>

          <div className="slip-settings">
            <div>
              <Field label={strings.settings.shopLogo} hint={strings.settings.shopLogoHint}>
                <ImagePicker
                  kind="logo"
                  value={values[SETTING_KEYS.shopLogo] || null}
                  onChange={(file) => set(SETTING_KEYS.shopLogo, file ?? '')}
                />
              </Field>

              <Field label={strings.settings.receiptFooter} hint={strings.settings.receiptFooterHint}>
                <input
                  className="input"
                  value={values[SETTING_KEYS.receiptFooter] ?? ''}
                  onChange={(event) => set(SETTING_KEYS.receiptFooter, event.target.value)}
                  placeholder={strings.settings.receiptFooterPlaceholder}
                />
              </Field>
            </div>

            {/* What the slip will look like, updating as the fields change. */}
            <SlipPreview
              logoFile={values[SETTING_KEYS.shopLogo] || null}
              name={values[SETTING_KEYS.businessName] ?? ''}
              address={values[SETTING_KEYS.businessAddress] ?? ''}
              phone={values[SETTING_KEYS.businessPhone] ?? ''}
              footer={values[SETTING_KEYS.receiptFooter] ?? ''}
            />
          </div>
        </Card>

        {/* --- packaging the counter can add to any order --- */}
        <Card>
          <h2 style={{ marginBottom: 4 }}>{strings.extras.title}</h2>
          <p className="tiny muted" style={{ marginBottom: 14 }}>
            {strings.extras.subtitle}
          </p>
          <ExtrasManager />
        </Card>

        {/* --- who works the counter --- */}
        <Card>
          <h2 style={{ marginBottom: 4 }}>{strings.staff.title}</h2>
          <p className="tiny muted" style={{ marginBottom: 14 }}>
            {strings.staff.subtitle}
          </p>
          <StaffManager onChanged={load} />
        </Card>

        {/* --- printing: two printers, degrading to one --- */}
        <Card>
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2>{strings.settings.printing}</h2>
            <button className="btn sm" onClick={testPrint}>
              <IconPrint size={15} />
              {strings.settings.testPrint}
            </button>
          </div>

          <div className="field-row">
            <Field label={strings.settings.customerPrinter}>
              <select
                className="input"
                value={values[SETTING_KEYS.printerCustomer] ?? ''}
                onChange={(event) => set(SETTING_KEYS.printerCustomer, event.target.value)}
              >
                <option value="">System default</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={strings.settings.kitchenPrinter} hint={strings.settings.kitchenPrinterHint}>
              <select
                className="input"
                value={values[SETTING_KEYS.printerKitchen] ?? ''}
                onChange={(event) => set(SETTING_KEYS.printerKitchen, event.target.value)}
              >
                <option value="">Same as customer printer</option>
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <label className="check" style={{ marginTop: 14 }}>
            <input
              type="checkbox"
              checked={values[SETTING_KEYS.enableKitchenPrint] !== '0'}
              onChange={(event) =>
                set(SETTING_KEYS.enableKitchenPrint, event.target.checked ? '1' : '0')
              }
            />
            {strings.settings.enableKitchenPrint}
          </label>
        </Card>

        {/* --- dine-in toggle: hides the Tables screen entirely --- */}
        <Card>
          <h2 style={{ marginBottom: 14 }}>{strings.settings.dineIn}</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={values[SETTING_KEYS.enableTables] !== '0'}
              onChange={(event) => set(SETTING_KEYS.enableTables, event.target.checked ? '1' : '0')}
            />
            {strings.settings.enableTables}
          </label>
          <div className="tiny muted" style={{ marginTop: 6 }}>
            {strings.settings.enableTablesHint}
          </div>
        </Card>

        {/* --- charges --- */}
        <Card>
          <h2 style={{ marginBottom: 14 }}>{strings.settings.service}</h2>
          <div className="field-row">
            <Field label={strings.settings.serviceCharge}>
              <input
                className="input num"
                type="number"
                min={0}
                max={100}
                step="0.5"
                value={values[SETTING_KEYS.serviceChargePercent] ?? '0'}
                onChange={(event) => set(SETTING_KEYS.serviceChargePercent, event.target.value)}
              />
            </Field>
            <Field label={strings.settings.currency}>
              <input
                className="input"
                value={values[SETTING_KEYS.currencySymbol] ?? ''}
                onChange={(event) => set(SETTING_KEYS.currencySymbol, event.target.value)}
              />
            </Field>
          </div>
        </Card>

        {/* --- the one permission in v1 --- */}
        <Card>
          <h2 style={{ marginBottom: 6 }}>{strings.settings.security}</h2>
          <div className="tiny muted" style={{ marginBottom: 14 }}>
            {strings.settings.managerPinHint}
          </div>
          <div className="row">
            <span className={`badge ${pinSet ? 'success' : 'neutral'}`}>
              {pinSet ? 'PIN is set' : 'No PIN — voids are open'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => setPinOpen(true)}>
              {pinSet ? strings.settings.changePin : strings.settings.setPin}
            </button>
          </div>
        </Card>

        {/* --- backup: reputation insurance --- */}
        <Card>
          <h2 style={{ marginBottom: 6 }}>{strings.settings.backup}</h2>
          <div className="tiny muted" style={{ marginBottom: 14 }}>
            {last
              ? `${strings.settings.lastBackup}: ${dateTime(last.created_at)} (${bytes(last.size_bytes)})`
              : strings.settings.neverBackedUp}
          </div>
          <div className="row">
            <button className="btn primary" onClick={backup} disabled={busy}>
              {strings.settings.backupNow}
            </button>
            <button className="btn" onClick={restore} disabled={busy}>
              {strings.settings.restore}
            </button>
          </div>
          {!last ? (
            <div style={{ marginTop: 12 }}>
              <Notice kind="warn">
                Your sales live only on this computer. Copy a backup to a USB stick regularly.
              </Notice>
            </div>
          ) : null}
        </Card>

        {/* --- license --- */}
        <Card>
          <h2 style={{ marginBottom: 10 }}>{strings.settings.license}</h2>
          <div className="row-between small">
            <span className="muted">Machine ID</span>
            <span className="num">{license?.machineId}</span>
          </div>
          <div className="row-between small" style={{ marginTop: 6 }}>
            <span className="muted">Status</span>
            <span>{license?.message}</span>
          </div>
        </Card>
      </div>

      {pinOpen ? (
        <PinModal
          pinSet={pinSet}
          onClose={() => setPinOpen(false)}
          onDone={async (message) => {
            setPinOpen(false);
            await load();
            toast(message, 'ok');
          }}
        />
      ) : null}
    </AppShell>
  );
}

function PinModal({
  pinSet,
  onClose,
  onDone,
}: {
  pinSet: boolean;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value: string, message: string) => {
    setBusy(true);
    setError('');
    try {
      await api.settings.setManagerPin(value);
      await onDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the PIN.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={strings.settings.managerPin}
      onClose={onClose}
      footer={
        <>
          {pinSet ? (
            <button
              className="btn danger"
              onClick={() => submit('', 'PIN removed — voids are open again.')}
              disabled={busy}
            >
              {strings.settings.clearPin}
            </button>
          ) : null}
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={busy}>
            {strings.common.cancel}
          </button>
          <button
            className="btn primary"
            onClick={() => submit(pin, 'PIN saved.')}
            disabled={busy || pin.length < 4}
          >
            {strings.common.save}
          </button>
        </>
      }
    >
      <Field label="New PIN" hint="4 to 8 digits. Voids will ask for this.">
        <input
          className="input num"
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
          maxLength={8}
          autoFocus
        />
      </Field>
      {error ? <Notice>{error}</Notice> : null}
    </Modal>
  );
}
