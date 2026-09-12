export const orderNoteMaxLength = 4_000

export function validateOrderNote(note: string) {
  return note.length > orderNoteMaxLength
    ? `Order note cannot exceed ${orderNoteMaxLength} characters.`
    : null
}
