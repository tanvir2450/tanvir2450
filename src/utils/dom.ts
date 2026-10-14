export const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const item = document.getElementById(id);
  if (!item) throw new Error(`Missing UI element #${id}`);
  return item as T;
};
