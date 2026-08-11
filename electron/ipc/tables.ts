import { handle, asId, asNumber, asOptionalId, asString } from './util';
import { listTables, removeTable, saveTable } from '../db/repositories/tables';

export function registerTableHandlers(): void {
  /** Status and running total come from one derived query — never a stored flag. */
  handle('tables:list', () => listTables());

  handle('tables:save', (_e, input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return saveTable({
      id: asOptionalId(raw.id, 'Table') ?? undefined,
      name: asString(raw.name, 'Table name', { max: 40 }),
      area: raw.area ? asString(raw.area, 'Area', { required: false, max: 40 }) : null,
      seats:
        raw.seats === undefined || raw.seats === null || raw.seats === ''
          ? null
          : asNumber(raw.seats, 'Seats', { min: 1, max: 100 }),
    });
  });

  handle('tables:remove', (_e, id) => {
    removeTable(asId(id, 'Table'));
    return null;
  });
}
