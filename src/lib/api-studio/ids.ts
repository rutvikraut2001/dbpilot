export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function newKV(key = '', value = '', enabled = true) {
  return { id: newId('kv'), enabled, key, value };
}
