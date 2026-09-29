export const InventoryState = {
  EMPTY: 'EMPTY',
  HAS_ITEM: 'HAS_ITEM',
};

/** Un solo slot: se puede tener como máximo un power-up. */
export class PlayerInventory {
  constructor() {
    this.item = null;
  }

  get state() {
    return this.item ? InventoryState.HAS_ITEM : InventoryState.EMPTY;
  }

  /** Guarda el objeto si el slot está vacío. Devuelve si lo pudo guardar. */
  give(type) {
    if (this.item) return false;
    this.item = type;
    return true;
  }

  /** Saca el objeto para usarlo (queda EMPTY). */
  take() {
    const item = this.item;
    this.item = null;
    return item;
  }

  clear() {
    this.item = null;
  }
}
