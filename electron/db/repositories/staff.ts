import { getDb } from '../connection';
import { nowIso } from '../money';
import { assertPinShape, encodePin, isEncoded, verifyPin } from '../../services/pinHash';
import type { StaffMember } from '../../../shared/types';

/**
 * The staff roster — the lightest identity that makes the cancellations
 * report mean anything.
 *
 * This is not a login system and must not grow into one: no roles, no
 * permissions, no per-screen access control. Its single job is to put a name
 * on a cancellation. The PIN exists for one reason — without it a dishonest
 * hand would simply pick a colleague's name from a list before voiding a
 * sale, and the owner's per-staff breakdown would be worse than useless,
 * because it would look like evidence.
 */

const SELECT = `
  SELECT id, name, is_active, created_at,
         CASE WHEN pin_hash != '' THEN 1 ELSE 0 END AS has_pin_int
  FROM staff
`;

type Row = Omit<StaffMember, 'has_pin'> & { has_pin_int: number };

function shape(row: Row): StaffMember {
  const { has_pin_int, ...rest } = row;
  return { ...rest, has_pin: has_pin_int === 1 };
}

export function listStaff(activeOnly = false): StaffMember[] {
  const rows = getDb()
    .prepare(`${SELECT}${activeOnly ? ' WHERE is_active = 1' : ''} ORDER BY is_active DESC, name`)
    .all() as Row[];
  return rows.map(shape);
}

export function getStaff(id: number): StaffMember | null {
  const row = getDb().prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return row ? shape(row) : null;
}

/**
 * Whether the roster is in use at all.
 *
 * An existing customer upgrading into this version has no staff yet, and the
 * app must keep taking orders on the morning of the update. Until the owner
 * adds someone, cancellations are recorded with no name rather than being
 * blocked — see `orders.voidOrder`.
 */
export function anyActiveStaff(): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM staff WHERE is_active = 1")
    .get() as { n: number };
  return row.n > 0;
}

export interface StaffInput {
  id?: number;
  name: string;
  is_active: boolean;
  /** Undefined leaves an existing PIN alone; '' clears it. */
  pin?: string;
}

export function saveStaff(input: StaffInput): StaffMember {
  const db = getDb();

  const run = db.transaction(() => {
    let id = input.id ?? 0;

    if (id) {
      db.prepare('UPDATE staff SET name = ?, is_active = ? WHERE id = ?').run(
        input.name,
        input.is_active ? 1 : 0,
        id,
      );
    } else {
      const info = db
        .prepare('INSERT INTO staff (name, pin_hash, is_active, created_at) VALUES (?, ?, ?, ?)')
        .run(input.name, '', input.is_active ? 1 : 0, nowIso());
      id = Number(info.lastInsertRowid);
    }

    if (input.pin !== undefined) {
      const trimmed = input.pin.trim();
      if (!trimmed) {
        db.prepare("UPDATE staff SET pin_hash = '' WHERE id = ?").run(id);
      } else {
        assertPinShape(trimmed);
        db.prepare('UPDATE staff SET pin_hash = ? WHERE id = ?').run(encodePin(trimmed), id);
      }
    }

    return id;
  });

  return getStaff(run())!;
}

/**
 * Staff are deactivated, not deleted, whenever they have history.
 *
 * Deleting someone who has cancellations against their name would quietly
 * erase exactly the record this feature exists to keep. Only a person who has
 * never cancelled anything can be removed outright.
 */
export function removeStaff(id: number): { deleted: boolean } {
  const db = getDb();
  const used = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM orders WHERE voided_by_staff_id = ?)
            + (SELECT COUNT(*) FROM order_items WHERE voided_by_staff_id = ?) AS n`,
    )
    .get(id, id) as { n: number };

  if (used.n > 0) {
    db.prepare('UPDATE staff SET is_active = 0 WHERE id = ?').run(id);
    return { deleted: false };
  }

  db.prepare('DELETE FROM staff WHERE id = ?').run(id);
  return { deleted: true };
}

/**
 * Check a staff PIN. Verified here, in the main process — the renderer never
 * sees a hash and never gets to report that a check passed.
 */
export function checkStaffPin(id: number, pin: unknown): boolean {
  const row = getDb().prepare('SELECT pin_hash, is_active FROM staff WHERE id = ?').get(id) as
    | { pin_hash: string; is_active: number }
    | undefined;

  if (!row || row.is_active !== 1) return false;
  // A staff member with no PIN set can sign in without one. The owner decides
  // whether to bother; the roster is still what stamps the cancellation.
  if (!isEncoded(row.pin_hash)) return true;
  return verifyPin(pin, row.pin_hash);
}
