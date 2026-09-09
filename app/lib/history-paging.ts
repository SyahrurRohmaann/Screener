export const HISTORY_PAGE_SIZES = [25, 50, 100, 200] as const;
export const HISTORY_PAGE_SIZE_KEY = "screener.history.pageSize";

export function paginate(total: number, rawPage: unknown = 1, rawPageSize: unknown = 50) {
  const requestedPage = Number(rawPage);
  const requestedSize = Number(rawPageSize);
  const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1;
  const pageSize = HISTORY_PAGE_SIZES.some((size) => size === requestedSize) ? requestedSize : 50;
  const total_pages = Math.ceil(total / pageSize);
  const start = page > total_pages ? total : (page - 1) * pageSize;
  return { page, pageSize, total, total_pages, start, end: Math.min(total, start + pageSize) };
}
