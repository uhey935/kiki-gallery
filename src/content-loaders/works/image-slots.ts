export type WorkImageSlot = { src: string; jaAlt: string; enAlt: string };
export const reorderImageSlots = (slots: WorkImageSlot[], order: number[]) => {
  if (
    order.length !== slots.length ||
    new Set(order).size !== slots.length ||
    order.some((i) => !slots[i])
  )
    throw new Error("Invalid image slot reorder");
  return order.map((i) => structuredClone(slots[i]));
};
export const replaceImageSource = (
  slots: WorkImageSlot[],
  index: number,
  src: string,
) => slots.map((slot, i) => (i === index ? { ...slot, src } : { ...slot }));
