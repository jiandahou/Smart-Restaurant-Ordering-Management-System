export type PaginationPresentation = {
  start: number | null
  end: number | null
  currentPage: number
  totalPages: number
}

/** Keeps API pagination maths out of the UI: an empty collection is still the first stable view. */
export function getPaginationPresentation(
  page: number,
  pageSize: number,
  totalItems: number,
  totalPages: number,
): PaginationPresentation {
  const displayTotalPages = Math.max(1, totalPages)
  const currentPage = Math.min(Math.max(1, page), displayTotalPages)

  if (totalItems <= 0) {
    return { start: null, end: null, currentPage: 1, totalPages: 1 }
  }

  return {
    start: (currentPage - 1) * pageSize + 1,
    end: Math.min(currentPage * pageSize, totalItems),
    currentPage,
    totalPages: displayTotalPages,
  }
}
